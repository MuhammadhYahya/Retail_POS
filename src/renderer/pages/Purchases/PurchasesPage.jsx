import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PencilLine, Search } from 'lucide-react';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { invokeWithAuth } from '../../lib/ipc';
import { isMeasuredUnit } from '../../lib/productUnits';
import { formatVariantDetails } from '../Dashboard/products/productFormUtils';
import {
  buildThermalPurchaseReceiptHtml,
  openReceiptFallbackWindow,
} from '../../lib/receiptHtml';

const inputClassName =
  'w-full p-3 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function formatMoney(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function calculateMargin(sellingPrice, costPrice) {
  const selling = Number(sellingPrice || 0);
  const cost = Number(costPrice || 0);
  const marginAmount = Math.round(((selling - cost) + Number.EPSILON) * 100) / 100;
  const marginPct = selling > 0 ? Math.round((((marginAmount / selling) + Number.EPSILON) * 10000)) / 100 : 0;
  return { marginAmount, marginPct };
}

function projectedWac(currentStock, currentWac, receiptQty, receiptCost) {
  const stock = Number(currentStock || 0);
  const wac = Number(currentWac || 0);
  const qty = Number(receiptQty || 0);
  const cost = Number(receiptCost || 0);
  const nextStock = stock + qty;
  const nextValue = (stock * wac) + (qty * cost);
  const projected = nextStock > 0 ? nextValue / nextStock : cost;
  return Math.round((projected + Number.EPSILON) * 100) / 100;
}

function newLineId() {
  return window.crypto.randomUUID();
}

function todayInputValue() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

export default function PurchasesPage() {
  const today = todayInputValue();
  const barcodeRef = useRef(null);
  const [suppliers, setSuppliers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [supplierNotes, setSupplierNotes] = useState('');
  const [supplierEditorOpen, setSupplierEditorOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [variantPickerProduct, setVariantPickerProduct] = useState(null);
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [selectedReceiptId, setSelectedReceiptId] = useState('');
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [sRes, pRes] = await Promise.all([
      invokeWithAuth('supplier:list'),
      invokeWithAuth('purchase:list', { limit: 30 }),
    ]);
    if (sRes.success) setSuppliers(sRes.data || []);
    if (pRes.success) setReceipts(pRes.data || []);
  };

  useEffect(() => {
    if (!selectedReceiptId && receipts.length) {
      setSelectedReceiptId(receipts[0].id);
    }
  }, [receipts, selectedReceiptId]);

  useEffect(() => {
    refresh();
    invokeWithAuth('settings:get').then((response) => {
      if (response.success) setSettings(response.data);
    });
    invokeWithAuth('product:getAll').then((response) => {
      if (response.success) setCatalog(response.data || []);
    });
  }, []);

  const addSupplier = async () => {
    if (!supplierName.trim()) return;
    setError('');
    const response = await invokeWithAuth('supplier:create', {
      name: supplierName.trim(),
      phone: supplierPhone.trim() || null,
      address: supplierAddress.trim() || null,
    });
    if (!response.success) {
      setError(response.error || 'Could not create supplier.');
      return;
    }
    setSupplierName('');
    setSupplierPhone('');
    setSupplierAddress('');
    setSupplierNotes('');
    setSupplierId(response.data.id);
    refresh();
  };

  const openSupplierEditor = (supplier) => {
    setEditingSupplierId(supplier.id);
    setSupplierName(supplier.name || '');
    setSupplierPhone(supplier.phone || '');
    setSupplierAddress(supplier.address || '');
    setSupplierNotes(supplier.notes || '');
    setError('');
    setSupplierEditorOpen(true);
  };

  const updateSupplier = async (event) => {
    event.preventDefault();
    setError('');
    const response = await invokeWithAuth('supplier:update', {
      id: editingSupplierId,
      name: supplierName.trim(),
      phone: supplierPhone.trim() || null,
      address: supplierAddress.trim() || null,
      notes: supplierNotes.trim() || null,
    });
    if (!response.success) {
      setError(response.error || 'Could not update supplier.');
      return;
    }
    setSupplierEditorOpen(false);
    setSupplierName('');
    setSupplierPhone('');
    setSupplierAddress('');
    setSupplierNotes('');
    await refresh();
  };

  const addByBarcode = async () => {
    const code = barcode.trim();
    if (!code) return;
    setError('');
    const response = await invokeWithAuth('product:lookupBarcode', { barcode: code });
    if (!response.success) {
      setError(response.error || 'Could not look up the product.');
      return;
    }
    if (!response.data) {
      setError(`No product found for barcode "${code}". Check the barcode and try again.`);
      return;
    }
    addVariantToLines(response.data);
  };

  const addVariantToLines = (variant, costOverride = null) => {
    const variantId = variant.id || variant.variantId;
    const hasExpiry = Boolean(variant.product?.hasExpiry ?? variant.product?.has_expiry);
    setLines((prev) => {
      const existing = prev.find((line) => line.variantId === variantId && !line.hasExpiry);
      if (existing) {
        return prev.map((line) =>
          line.id === existing.id
            ? { ...line, quantity: Number(line.quantity) + 1 }
            : line
        );
      }
      return [
        ...prev,
        {
          id: newLineId(),
          variantId,
          label: `${variant.product?.name || variant.productName || 'Item'}${variant.name ? ` - ${variant.name}` : ''}`,
          barcode: variant.barcode,
          unit: variant.product?.unit || '',
          quantity: 1,
          unitCost: costOverride ?? variant.costPrice ?? variant.cost_price ?? 0,
          sellingPrice: Number(variant.sellingPrice ?? variant.selling_price ?? 0),
          currentStock: Number(variant.inventory?.onHand ?? variant.inventory?.on_hand ?? 0),
          currentWac: Number(variant.costPrice ?? variant.cost_price ?? 0),
          priceType: String(variant.priceType || variant.price_type || 'FREE').toUpperCase(),
          hasExpiry,
          batchNumber: '',
          expiryDate: '',
        },
      ];
    });
    setBarcode('');
    barcodeRef.current?.focus();
  };

  const catalogResults = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    const products = catalog || [];
    if (!query) return products.slice(0, 50);
    return products.filter((product) => {
      const haystack = [
        product.name,
        product.brand,
        product.category?.name,
        product.category?.path,
        ...(product.variants || []).flatMap((variant) => [variant.name, variant.sku, variant.barcode]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [catalog, catalogQuery]);

  const closeCatalog = () => {
    setCatalogOpen(false);
    setCatalogQuery('');
    setVariantPickerProduct(null);
  };

  const selectCatalogProduct = (product) => {
    const variants = product.variants || [];
    if (variants.length <= 1) {
      if (!variants.length) return;
      addVariantToLines({ ...variants[0], product });
      closeCatalog();
      return;
    }
    setVariantPickerProduct(product);
  };

  const selectCatalogVariant = (variant) => {
    addVariantToLines({ ...variant, product: variantPickerProduct });
    closeCatalog();
  };

  const createAndPost = async () => {
    setBusy(true);
    setError('');
    setMessage('');

    const supplierLabel = supplierName.trim();
    const invoiceLabel = invoiceNumber.trim();
    const invoiceDateLabel = invoiceDate.trim();

    if (!supplierId && !supplierLabel) {
      setBusy(false);
      setError('Supplier is required.');
      return;
    }
    if (!invoiceLabel) {
      setBusy(false);
      setError('Invoice number is required.');
      return;
    }
    if (!invoiceDateLabel) {
      setBusy(false);
      setError('Invoice date is required.');
      return;
    }

    let nextSupplierId = supplierId;
    if (!nextSupplierId && supplierLabel) {
      const supplierResponse = await invokeWithAuth('supplier:create', {
        name: supplierLabel,
        phone: supplierPhone.trim() || null,
        address: supplierAddress.trim() || null,
      });
      if (!supplierResponse.success) {
        setBusy(false);
        setError(supplierResponse.error || 'Could not create supplier.');
        return;
      }
      nextSupplierId = supplierResponse.data.id;
      setSupplierId(nextSupplierId);
      await refresh();
    }

    const warnings = lines
      .map((line) => {
        const receiptQty = Number(line.quantity);
        const receiptCost = Number(line.unitCost);
        const sellingPrice = Number(line.sellingPrice);
        const nextWac = projectedWac(line.currentStock, line.currentWac, receiptQty, receiptCost);
        const { marginAmount, marginPct } = calculateMargin(sellingPrice, nextWac);
        return { ...line, nextWac, marginAmount, marginPct };
      })
      .filter((line) => Number.isFinite(line.marginAmount) && line.marginPct <= 10);

    if (warnings.length) {
      const labels = warnings.map((line) => line.label).join(', ');
      const hasMrp = warnings.some((line) => line.priceType === 'MRP');
      const ok = window.confirm(
        hasMrp
          ? `MRP item(s) will end up with low or negative margin after this GRN: ${labels}.\n\nContinue anyway?`
          : `After this purchase, margin will drop on: ${labels}.\n\nContinue anyway?`
      );
      if (!ok) {
        setBusy(false);
        return;
      }
    }

    const createRes = await invokeWithAuth('purchase:create', {
      supplierId: nextSupplierId,
      invoiceNumber: invoiceLabel,
      invoiceDate: invoiceDateLabel,
      receivedDate: new Date().toISOString().slice(0, 10),
      notes: notes || null,
      items: lines.map((line) => ({
        variantId: line.variantId,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        priceType: line.priceType,
        batchNumber: line.batchNumber || null,
        expiryDate: line.hasExpiry ? line.expiryDate || null : null,
        receivedMrp: line.priceType === 'MRP' ? Number(line.sellingPrice) : null,
      })),
    });
    if (!createRes.success) {
      setBusy(false);
      setError(createRes.error || 'Could not create GRN.');
      return;
    }
    const postRes = await invokeWithAuth('purchase:post', { receiptId: createRes.data.id });
    setBusy(false);
    if (!postRes.success) {
      setError(postRes.error || 'GRN created but post failed.');
      refresh();
      return;
    }
    setMessage(`Posted ${postRes.data.grnNumber}. Stock updated.`);
    setSelectedReceiptId(postRes.data.id || createRes.data.id);
    setLines([]);
    setNotes('');
    setInvoiceNumber('');
    setInvoiceDate('');
    refresh();
  };

  const grnWarnings = lines
    .map((line) => {
      const nextWac = projectedWac(line.currentStock, line.currentWac, line.quantity, line.unitCost);
      const { marginAmount, marginPct } = calculateMargin(line.sellingPrice, nextWac);
      return {
        ...line,
        nextWac,
        marginAmount,
        marginPct,
      };
    })
    .filter((line) => Number.isFinite(line.marginAmount) && line.marginPct <= 10);

  const selectedReceipt = receipts.find((receipt) => receipt.id === selectedReceiptId) || receipts[0] || null;

  const reprintReceipt = async (receipt) => {
    if (!receipt) return;
    setBusy(true);
    setError('');
    setMessage('');
    const response = await invokeWithAuth('printer:reprintPurchaseReceipt', { receiptId: receipt.id });
    setBusy(false);
    if (!response.success || !response.data?.success) {
      const shop = settings || (await invokeWithAuth('settings:get')).data || {};
      if (shop && !settings) setSettings(shop);
      const fallback = openReceiptFallbackWindow(
        buildThermalPurchaseReceiptHtml({
          shop,
          receipt,
          paperWidth: shop.paperWidth || 80,
          autoPrint: false,
          reprint: true,
        }),
        { title: `GRN ${receipt?.grnNumber || ''}`.trim() || 'GRN preview' }
      );
      setError(
        fallback.ok
          ? `${response.error || response.data?.error || 'Could not reprint GRN receipt.'} Opened receipt preview on screen.`
          : `${response.error || response.data?.error || 'Could not reprint GRN receipt.'} ${fallback.error || 'Use Print Again.'}`
      );
      return;
    }
    setMessage(`Reprinted ${receipt.grnNumber}.`);
  };

  return (
    <AppShell title="Purchases / GRN" description="Receive supplier stock into inventory.">
      <div className="space-y-6 max-w-5xl">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {message && (
          <Alert>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        {grnWarnings.length > 0 && (
          <Alert variant={grnWarnings.some((line) => line.priceType === 'MRP') ? 'destructive' : undefined}>
            <p className="mb-1 font-semibold">
              {grnWarnings.some((line) => line.priceType === 'MRP')
                ? 'MRP items will keep their price, but margin is getting tight.'
                : 'Projected margin is low on one or more GRN lines.'}
            </p>
            <AlertDescription>
              {grnWarnings.map((line) => `${line.label} (${formatMoney(line.marginAmount)} / ${line.marginPct.toFixed(1)}%)`).join(', ')}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Suppliers</CardTitle>
            <CardDescription>Click a supplier row to use it for this GRN.</CardDescription>
          </CardHeader>
          <CardContent>
            {!suppliers.length ? (
              <p className="text-sm text-muted-foreground">No suppliers yet. Add one below.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Phone</th>
                      <th className="px-3 py-2">Address</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((supplier) => (
                      <tr
                        key={supplier.id}
                        tabIndex={0}
                        role="button"
                        onClick={() => setSupplierId(supplier.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSupplierId(supplier.id);
                          }
                        }}
                        className={`cursor-pointer border-b border-border/60 transition-colors ${
                          supplierId === supplier.id ? 'bg-primary/10' : 'hover:bg-muted/30'
                        }`}
                      >
                        <td className="px-3 py-3 font-medium">{supplier.name}</td>
                        <td className="px-3 py-3">{supplier.phone || '-'}</td>
                        <td className="px-3 py-3">{supplier.address || '-'}</td>
                        <td className="px-3 py-3">{supplier.isActive ? 'Active' : 'Inactive'}</td>
                        <td className="px-3 py-3 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title={`Edit ${supplier.name}`}
                            aria-label={`Edit ${supplier.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openSupplierEditor(supplier);
                            }}
                          >
                            <PencilLine className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>New GRN</CardTitle>
              <CardDescription>Scan barcodes, set cost, then post to stock.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="purchase-barcode">Scan product barcode</label>
                <div className="flex gap-2">
                  <input
                    id="purchase-barcode"
                    ref={barcodeRef}
                    className={inputClassName}
                    placeholder="Scan barcode or enter SKU, then Enter"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addByBarcode())}
                    autoFocus
                  />
                  <Button type="button" onClick={addByBarcode}>
                    Add
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setCatalogOpen(true)}>
                    Browse
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  className={inputClassName}
                  placeholder="New supplier name"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                />
                <input
                  className={inputClassName}
                  placeholder="Phone (optional)"
                  value={supplierPhone}
                  onChange={(e) => setSupplierPhone(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={addSupplier}>
                  Add supplier
                </Button>
              </div>
              <input
                className={inputClassName}
                placeholder="Supplier address (optional)"
                value={supplierAddress}
                onChange={(e) => setSupplierAddress(e.target.value)}
              />
              <div>
                <label className="block text-sm font-medium mb-2">Supplier</label>
                <select
                  className={inputClassName}
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Optional</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose an existing supplier, or type a new one above and press Add.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input className={inputClassName} placeholder="Supplier invoice number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
                <div>
                  <label className="sr-only" htmlFor="purchase-invoice-date">Supplier invoice date</label>
                  <input
                    id="purchase-invoice-date"
                    className={inputClassName}
                    type="date"
                    max={today}
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    required
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Today or an earlier date only.</p>
                </div>
              </div>
              <div className="space-y-2">
                {!lines.length && <p className="text-sm text-muted-foreground">No lines yet.</p>}
                {lines.map((line) => (
                  <div key={line.id} className="grid grid-cols-12 gap-2 items-center text-sm">
                    <div className="col-span-5 font-semibold truncate">{line.label}</div>
                    <input
                      className={`${inputClassName} col-span-2 !p-2`}
                      type="number"
                      min="0.001"
                      step={isMeasuredUnit(line.unit) ? '0.001' : '1'}
                      value={line.quantity}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l) =>
                            l.id === line.id ? { ...l, quantity: e.target.value } : l
                          )
                        )
                      }
                    />
                    <input
                      className={`${inputClassName} col-span-3 !p-2`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitCost}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l) =>
                            l.id === line.id ? { ...l, unitCost: e.target.value } : l
                          )
                          )
                        }
                      />
                    {line.priceType === 'MRP' ? (
                      <input
                        className={`${inputClassName} col-span-2 !p-2`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={line.sellingPrice}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.id === line.id ? { ...l, sellingPrice: e.target.value } : l
                            )
                          )
                        }
                        placeholder="MRP"
                      />
                    ) : (
                      <div className="col-span-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        Free price
                      </div>
                    )}
                    <div className="col-span-12 grid gap-2 md:grid-cols-3">
                      {line.hasExpiry ? (
                        <>
                          <input
                            className={`${inputClassName} !p-2`}
                            placeholder="Batch number (optional)"
                            value={line.batchNumber}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) => (
                                  l.id === line.id ? { ...l, batchNumber: e.target.value } : l
                                ))
                              )
                            }
                          />
                          <input
                            className={`${inputClassName} !p-2`}
                            type="date"
                            value={line.expiryDate}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) => (
                                  l.id === line.id ? { ...l, expiryDate: e.target.value } : l
                                ))
                              )
                            }
                            required
                          />
                        </>
                      ) : (
                        <div className="md:col-span-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                          No expiry tracking for this product.
                        </div>
                      )}
                      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
                        {(() => {
                          const nextWac = projectedWac(line.currentStock, line.currentWac, line.quantity, line.unitCost);
                          const { marginAmount, marginPct } = calculateMargin(line.sellingPrice, nextWac);
                          return (
                            <>
                              <p className="font-semibold">Projected margin</p>
                              <p className={marginAmount < 0 ? 'text-destructive font-semibold' : 'text-foreground'}>
                                {formatMoney(marginAmount)} - {marginPct.toFixed(1)}%
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                WAC after GRN: {formatMoney(nextWac)}
                              </p>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="col-span-2"
                      onClick={() => setLines((prev) => prev.filter((l) => l.id !== line.id))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <input
                className={inputClassName}
                placeholder="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button type="button" disabled={busy || !lines.length} onClick={createAndPost}>
                {busy ? 'Posting...' : 'Create & post GRN'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent GRNs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!receipts.length && <p className="text-sm text-muted-foreground">No receipts yet.</p>}
              {receipts.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                    selectedReceiptId === r.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/30'
                  }`}
                  onClick={() => setSelectedReceiptId(r.id)}
                >
                  <div className="font-semibold font-mono">{r.grnNumber}</div>
                  <div className="text-muted-foreground text-sm">
                    {r.supplierName || 'No supplier'} - {r.status} - {formatMoney(r.totalCost)} - {r.items?.length || 0} lines
                  </div>
                </button>
              ))}

              {selectedReceipt && (
                <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Receipt preview</p>
                      <h3 className="text-lg font-semibold">{selectedReceipt.grnNumber}</h3>
                      <p className="text-sm text-muted-foreground">
                        {selectedReceipt.supplierName || 'No supplier'} - {selectedReceipt.status}
                      </p>
                    </div>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => reprintReceipt(selectedReceipt)}>
                      Reprint
                    </Button>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Invoice:</span> {selectedReceipt.invoiceNumber || '-'}</p>
                    <p><span className="text-muted-foreground">Date:</span> {selectedReceipt.invoiceDate || '-'}</p>
                    <p><span className="text-muted-foreground">Received:</span> {selectedReceipt.receivedDate || '-'}</p>
                    <p><span className="text-muted-foreground">Total:</span> {formatMoney(selectedReceipt.totalCost)}</p>
                  </div>
                  <div className="space-y-2">
                    {selectedReceipt.items?.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                        <p className="font-medium">{item.productName}{item.variantName ? ` - ${item.variantName}` : ''}</p>
                        <p className="text-xs text-muted-foreground">
                          Qty {Number(item.quantity || 0)} - Cost {formatMoney(item.unitCost)} - Line {formatMoney(item.lineTotal)}
                        </p>
                        {(item.batchNumber || item.expiryDate) && (
                          <p className="text-xs text-muted-foreground">
                            {item.batchNumber ? `Batch ${item.batchNumber}` : 'No batch'}{item.expiryDate ? ` - Expiry ${item.expiryDate}` : ''}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={supplierEditorOpen} onOpenChange={setSupplierEditorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Supplier</DialogTitle>
            <DialogDescription>Update the supplier details used on future GRNs.</DialogDescription>
          </DialogHeader>
          <form onSubmit={updateSupplier} className="space-y-4">
            <input className={inputClassName} placeholder="Supplier name" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} required />
            <input className={inputClassName} placeholder="Phone (optional)" value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} />
            <input className={inputClassName} placeholder="Address (optional)" value={supplierAddress} onChange={(event) => setSupplierAddress(event.target.value)} />
            <textarea className={inputClassName} placeholder="Notes (optional)" value={supplierNotes} onChange={(event) => setSupplierNotes(event.target.value)} rows={3} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSupplierEditorOpen(false)}>Cancel</Button>
              <Button type="submit">Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={catalogOpen} onOpenChange={(open) => (open ? setCatalogOpen(true) : closeCatalog())}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Browse Products</DialogTitle>
            <DialogDescription>Search by name, brand, SKU, or barcode, then pick a product to receive.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                className={`${inputClassName} pl-10`}
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder="Search products..."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              {!catalogResults.length && (
                <p className="text-sm text-muted-foreground">No matching products found.</p>
              )}
              {catalogResults.map((product) => {
                const variantCount = product.variants?.length || 0;
                const thumb = product.imageUrls?.[0];
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => selectCatalogProduct(product)}
                    disabled={!variantCount}
                    className="w-full text-left rounded-xl border border-border bg-card p-3 hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
                  >
                    {thumb ? (
                      <img src={thumb} alt="" className="h-10 w-10 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-muted flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{product.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {product.brand || ''}{product.brand ? ' · ' : ''}
                        {variantCount === 1 ? formatVariantDetails(product.variants[0]) : `${variantCount} variants`}
                      </p>
                    </div>
                    {variantCount === 1 && (
                      <div className="text-sm font-bold text-foreground flex-shrink-0">
                        {formatMoney(product.variants[0].sellingPrice)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(variantPickerProduct)} onOpenChange={(open) => !open && setVariantPickerProduct(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Select variant{variantPickerProduct ? ` — ${variantPickerProduct.name}` : ''}</DialogTitle>
            <DialogDescription>Choose the specific variant to receive on this GRN.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {variantPickerProduct?.variants?.map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => selectCatalogVariant(variant)}
                className="w-full text-left rounded-xl border border-border bg-card p-3 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{formatVariantDetails(variant)}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-1">
                      {variant.barcode || 'No barcode'} · {variant.sku || 'No SKU'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Stock on hand: {Number(variant.inventory?.onHand ?? 0)}
                    </p>
                  </div>
                  <div className="text-sm font-bold text-foreground flex-shrink-0">
                    {formatMoney(variant.costPrice)}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVariantPickerProduct(null)}>
              Back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
