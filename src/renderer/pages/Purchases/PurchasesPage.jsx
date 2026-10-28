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
  const [supplierEditorOpen, setSupplierEditorOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState('');
  // The edit dialog keeps its own fields. Sharing them with the "Add supplier"
  // form meant a cancelled edit left a stale name behind, and posting a GRN
  // without picking a supplier then silently created a duplicate.
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNotes, setEditNotes] = useState('');
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
    setSupplierId(response.data.id);
    refresh();
  };

  const openSupplierEditor = (supplier) => {
    setEditingSupplierId(supplier.id);
    setEditName(supplier.name || '');
    setEditPhone(supplier.phone || '');
    setEditAddress(supplier.address || '');
    setEditNotes(supplier.notes || '');
    setError('');
    setSupplierEditorOpen(true);
  };

  const closeSupplierEditor = () => {
    setSupplierEditorOpen(false);
    setEditingSupplierId('');
    setEditName('');
    setEditPhone('');
    setEditAddress('');
    setEditNotes('');
  };

  const updateSupplier = async (event) => {
    event.preventDefault();
    setError('');
    const response = await invokeWithAuth('supplier:update', {
      id: editingSupplierId,
      name: editName.trim(),
      phone: editPhone.trim() || null,
      address: editAddress.trim() || null,
      notes: editNotes.trim() || null,
    });
    if (!response.success) {
      setError(response.error || 'Could not update supplier.');
      return;
    }
    closeSupplierEditor();
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
    setLines((prev) => {
      const existing = prev.find((line) => line.variantId === variantId);
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
      const ok = window.confirm(
        `After this purchase, margin will drop on: ${labels}.\n\nContinue anyway?`
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

  /**
   * Display-only running total for the unposted draft. Mirrors the backend's
   * per-line `quantity * unitCost` sum so the cashier sees a live figure before
   * posting; the posted receipt's authoritative total still comes from the
   * server response, which is what Recent GRNs renders.
   */
  const grnTotal = useMemo(
    () =>
      Math.round(
        (lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0) +
          Number.EPSILON) * 100
      ) / 100,
    [lines]
  );

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
      <div className="space-y-6">
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
          <Alert>
            <p className="mb-1 font-semibold">Low margin after this purchase</p>
            <AlertDescription>
              {grnWarnings.map((line) => `${line.label} (${formatMoney(line.marginAmount)} / ${line.marginPct.toFixed(1)}%)`).join(', ')}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr] xl:items-start">
          {/* ---------- New GRN (top left) ---------- */}
          <Card className="@container">
            <CardHeader>
              <CardTitle>New GRN</CardTitle>
              <CardDescription>Scan items, set cost, then post to stock.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="purchase-barcode">
                  Scan product
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id="purchase-barcode"
                    ref={barcodeRef}
                    className={`${inputClassName} h-12 min-w-0 flex-1`}
                    placeholder="Scan barcode or type SKU, then Enter"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addByBarcode())}
                    autoFocus
                  />
                  <Button type="button" className="h-12 px-5 font-bold" onClick={addByBarcode}>
                    Add
                  </Button>
                  <Button type="button" variant="outline" className="h-12 px-5 font-bold" onClick={() => setCatalogOpen(true)}>
                    Browse
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 @lg:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium mb-2" htmlFor="grn-supplier">Supplier</label>
                  <select
                    id="grn-supplier"
                    className={`${inputClassName} h-12`}
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">Select supplier</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" htmlFor="grn-invoice">Invoice number</label>
                  <input
                    id="grn-invoice"
                    className={`${inputClassName} h-12`}
                    placeholder="e.g. INV-1024"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" htmlFor="purchase-invoice-date">Invoice date</label>
                  <input
                    id="purchase-invoice-date"
                    className={`${inputClassName} h-12 tabular-nums`}
                    type="date"
                    max={today}
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* ----- Lines: cards when tight, table when the card is wide ----- */}
              {!lines.length ? (
                <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No items yet. Scan a barcode to start.
                </p>
              ) : (
                <>
                  <div className="space-y-3 @3xl:hidden">
                    {lines.map((line) => {
                      const nextWac = projectedWac(line.currentStock, line.currentWac, line.quantity, line.unitCost);
                      const { marginAmount, marginPct } = calculateMargin(line.sellingPrice, nextWac);
                      const lineTotal = Number(line.quantity || 0) * Number(line.unitCost || 0);
                      return (
                        <div key={line.id} className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-bold text-foreground leading-tight min-w-0">{line.label}</p>
                            <span className="font-bold tabular-nums shrink-0">{formatMoney(lineTotal)}</span>
                          </div>
                          <div className="flex flex-wrap items-end gap-3">
                            <div>
                              <label className="block text-xs font-medium mb-1 text-muted-foreground">Qty</label>
                              <input
                                className={`${inputClassName} h-11 w-24 tabular-nums !p-2 text-center`}
                                type="number"
                                min="0.001"
                                step={isMeasuredUnit(line.unit) ? '0.001' : '1'}
                                value={line.quantity}
                                onChange={(e) =>
                                  setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, quantity: e.target.value } : l)))
                                }
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium mb-1 text-muted-foreground">Unit cost</label>
                              <input
                                className={`${inputClassName} h-11 w-32 tabular-nums !p-2`}
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.unitCost}
                                onChange={(e) =>
                                  setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, unitCost: e.target.value } : l)))
                                }
                              />
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-11 ml-auto"
                              onClick={() => setLines((prev) => prev.filter((l) => l.id !== line.id))}
                            >
                              Remove
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            WAC after {formatMoney(nextWac)} ·{' '}
                            <span className={marginPct <= 10 ? 'font-semibold text-amber-600' : ''}>
                              margin {formatMoney(marginAmount)} ({marginPct.toFixed(1)}%)
                            </span>
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="hidden @3xl:block overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                        <tr>
                          <th className="text-left p-3 font-bold text-xs uppercase tracking-wider">Item</th>
                          <th className="text-left p-3 font-bold text-xs uppercase tracking-wider w-[7rem]">Qty</th>
                          <th className="text-left p-3 font-bold text-xs uppercase tracking-wider w-[9rem]">Unit cost</th>
                          <th className="text-right p-3 font-bold text-xs uppercase tracking-wider w-[8rem]">Line total</th>
                          <th className="text-left p-3 font-bold text-xs uppercase tracking-wider w-[13rem]">After GRN</th>
                          <th className="p-3 w-[6rem]" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {lines.map((line) => {
                          const nextWac = projectedWac(line.currentStock, line.currentWac, line.quantity, line.unitCost);
                          const { marginAmount, marginPct } = calculateMargin(line.sellingPrice, nextWac);
                          const lineTotal = Number(line.quantity || 0) * Number(line.unitCost || 0);
                          return (
                            <tr key={line.id}>
                              <td className="p-3 font-semibold">{line.label}</td>
                              <td className="p-3">
                                <input
                                  className={`${inputClassName} h-11 tabular-nums !p-2 text-center`}
                                  type="number"
                                  min="0.001"
                                  step={isMeasuredUnit(line.unit) ? '0.001' : '1'}
                                  value={line.quantity}
                                  onChange={(e) =>
                                    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, quantity: e.target.value } : l)))
                                  }
                                />
                              </td>
                              <td className="p-3">
                                <input
                                  className={`${inputClassName} h-11 tabular-nums !p-2`}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={line.unitCost}
                                  onChange={(e) =>
                                    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, unitCost: e.target.value } : l)))
                                  }
                                />
                              </td>
                              <td className="p-3 text-right font-bold tabular-nums">{formatMoney(lineTotal)}</td>
                              <td className="p-3 text-xs text-muted-foreground tabular-nums">
                                <p>WAC {formatMoney(nextWac)}</p>
                                <p className={marginPct <= 10 ? 'font-semibold text-amber-600' : ''}>
                                  {formatMoney(marginAmount)} ({marginPct.toFixed(1)}%)
                                </p>
                              </td>
                              <td className="p-3 text-right">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-11"
                                  onClick={() => setLines((prev) => prev.filter((l) => l.id !== line.id))}
                                >
                                  Remove
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <input
                className={`${inputClassName} h-12`}
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />

              <div className="rounded-2xl bg-primary-tint border border-primary/20 px-5 py-4 flex items-center justify-between gap-3">
                <span className="font-bold text-primary-dark">Total cost</span>
                <span
                  key={grnTotal}
                  className="zen-total-pulse text-3xl font-black tabular-nums text-primary-dark leading-none"
                >
                  {formatMoney(grnTotal)}
                </span>
              </div>

              <Button
                type="button"
                className="w-full h-14 rounded-2xl font-bold text-base"
                disabled={busy || !lines.length}
                onClick={createAndPost}
              >
                {busy ? 'Posting...' : 'Create & Post GRN'}
              </Button>
            </CardContent>
          </Card>

          {/* ---------- Suppliers (right) ---------- */}
          <Card>
            <CardHeader>
              <CardTitle>Suppliers</CardTitle>
              <CardDescription>Tap a supplier to use it on this GRN.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4">
                <p className="text-sm font-bold">Add supplier</p>
                <input
                  className={`${inputClassName} h-11`}
                  placeholder="Supplier name"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                />
                <input
                  className={`${inputClassName} h-11`}
                  placeholder="Phone (optional)"
                  value={supplierPhone}
                  onChange={(e) => setSupplierPhone(e.target.value)}
                />
                <input
                  className={`${inputClassName} h-11`}
                  placeholder="Address (optional)"
                  value={supplierAddress}
                  onChange={(e) => setSupplierAddress(e.target.value)}
                />
                <Button type="button" variant="outline" className="h-11 w-full font-bold" onClick={addSupplier}>
                  Add supplier
                </Button>
              </div>

              {!suppliers.length ? (
                <p className="text-sm text-muted-foreground">No suppliers yet.</p>
              ) : (
                <div className="max-h-96 space-y-2 overflow-y-auto">
                  {suppliers.map((supplier) => {
                    const isSelected = supplierId === supplier.id;
                    return (
                      <div
                        key={supplier.id}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${
                          isSelected ? 'border-primary bg-primary-tint' : 'border-border hover:bg-muted/30'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSupplierId(supplier.id)}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <p className={`font-bold truncate ${isSelected ? 'text-primary-dark' : 'text-foreground'}`}>
                            {supplier.name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {supplier.phone || 'No phone'}
                            {supplier.address ? ` · ${supplier.address}` : ''}
                          </p>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={`Edit ${supplier.name}`}
                          aria-label={`Edit ${supplier.name}`}
                          onClick={() => openSupplierEditor(supplier)}
                        >
                          <PencilLine className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ---------- Recent GRNs (bottom, full width) ---------- */}
        <Card>
          <CardHeader>
            <CardTitle>Recent GRNs</CardTitle>
            <CardDescription>Posted receipts. Select one to preview or reprint.</CardDescription>
          </CardHeader>
          <CardContent>
            {!receipts.length ? (
              <p className="text-sm text-muted-foreground">No receipts yet.</p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[20rem_1fr] lg:items-start">
                <div className="max-h-96 space-y-2 overflow-y-auto lg:pr-1">
                  {receipts.map((r) => {
                    const isSelected = selectedReceiptId === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`w-full rounded-xl border px-3 py-3 text-left transition-colors cursor-pointer ${
                          isSelected ? 'border-primary bg-primary-tint' : 'border-border hover:bg-muted/30'
                        }`}
                        onClick={() => setSelectedReceiptId(r.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-mono font-bold ${isSelected ? 'text-primary-dark' : ''}`}>
                            {r.grnNumber}
                          </span>
                          <span className="font-bold tabular-nums shrink-0">{formatMoney(r.totalCost)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {r.supplierName || 'No supplier'} · {r.items?.length || 0} line
                          {(r.items?.length || 0) === 1 ? '' : 's'} · {r.status}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {selectedReceipt && (
                  <div className="rounded-2xl border border-border bg-muted/20 p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-extrabold font-mono">{selectedReceipt.grnNumber}</h3>
                        <p className="text-sm text-muted-foreground">
                          {selectedReceipt.supplierName || 'No supplier'} · {selectedReceipt.status}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 font-bold"
                        disabled={busy}
                        onClick={() => reprintReceipt(selectedReceipt)}
                      >
                        Reprint
                      </Button>
                    </div>

                    <div className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                      <p className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Invoice</span>
                        <span className="font-semibold">{selectedReceipt.invoiceNumber || '—'}</span>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Invoice date</span>
                        <span className="font-semibold tabular-nums">{selectedReceipt.invoiceDate || '—'}</span>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Received</span>
                        <span className="font-semibold tabular-nums">{selectedReceipt.receivedDate || '—'}</span>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Total</span>
                        <span className="font-bold tabular-nums">{formatMoney(selectedReceipt.totalCost)}</span>
                      </p>
                    </div>

                    <div className="space-y-2">
                      {selectedReceipt.items?.map((item) => (
                        <div key={item.id} className="rounded-lg border border-border bg-card px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-semibold text-sm min-w-0">
                              {item.productName}
                              {item.variantName ? ` — ${item.variantName}` : ''}
                            </p>
                            <span className="text-sm font-bold tabular-nums shrink-0">{formatMoney(item.lineTotal)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                            {Number(item.quantity || 0)} × {formatMoney(item.unitCost)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Dialog open={supplierEditorOpen} onOpenChange={(open) => (open ? setSupplierEditorOpen(true) : closeSupplierEditor())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Supplier</DialogTitle>
            <DialogDescription>Update the supplier details used on future GRNs.</DialogDescription>
          </DialogHeader>
          <form onSubmit={updateSupplier} className="space-y-4">
            <input className={inputClassName} placeholder="Supplier name" value={editName} onChange={(event) => setEditName(event.target.value)} required />
            <input className={inputClassName} placeholder="Phone (optional)" value={editPhone} onChange={(event) => setEditPhone(event.target.value)} />
            <input className={inputClassName} placeholder="Address (optional)" value={editAddress} onChange={(event) => setEditAddress(event.target.value)} />
            <textarea className={inputClassName} placeholder="Notes (optional)" value={editNotes} onChange={(event) => setEditNotes(event.target.value)} rows={3} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeSupplierEditor}>Cancel</Button>
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
