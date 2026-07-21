import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Trash2, Plus, Minus, Printer } from 'lucide-react';
import AppShell from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { invokeWithAuth, notifyLowStockUpdated } from '../../lib/ipc';
import { useCartStore } from '../../store/cartStore';
import { cn } from '../../lib/utils';

const inputClassName =
  'w-full p-3.5 rounded-xl bg-input border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-100 font-semibold';

function formatMoney(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

export default function BillingPage() {
  const navigate = useNavigate();
  const barcodeRef = useRef(null);
  const [barcode, setBarcode] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState(null);
  const [receiptSeconds, setReceiptSeconds] = useState(120);

  const items = useCartStore((state) => state.items);
  const addItem = useCartStore((state) => state.addItem);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQty = useCartStore((state) => state.updateQty);
  const applyDiscount = useCartStore((state) => state.applyDiscount);
  const clear = useCartStore((state) => state.clear);
  const getTotals = useCartStore((state) => state.getTotals);
  const setLastSale = useCartStore((state) => state.setLastSale);

  const totals = useMemo(() => getTotals(), [items, getTotals]);
  const change = useMemo(() => {
    if (paymentMethod !== 'cash') return 0;
    return Math.max(0, Number(tendered || 0) - totals.total);
  }, [paymentMethod, tendered, totals.total]);

  useEffect(() => {
    barcodeRef.current?.focus();
    Promise.all([invokeWithAuth('settings:get'), invokeWithAuth('product:getAll')]).then(([settingsResponse, productsResponse]) => {
      if (settingsResponse.success) setSettings(settingsResponse.data);
      if (productsResponse.success) setCatalog(productsResponse.data || []);
    });
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'F1') {
        event.preventDefault();
        barcodeRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setError('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleLookup = async (event) => {
    event?.preventDefault();
    const code = barcode.trim();
    if (!code) return;

    setError('');
    const response = await invokeWithAuth('product:lookupBarcode', { barcode: code });
    if (!response.success) {
      setError(response.error || 'Lookup failed.');
      return;
    }
    if (!response.data) {
      setError('No product found with this barcode.');
      setBarcode('');
      return;
    }

    const variant = response.data;
    addItem({
      id: variant.id,
      variantId: variant.id,
      productId: variant.productId || variant.product?.id,
      productName: variant.product?.name,
      variantName: variant.name,
      sku: variant.sku,
      barcode: variant.barcode,
      sellingPrice: variant.sellingPrice,
      taxRate: variant.product?.taxRate ?? 0,
    });
    setBarcode('');
    barcodeRef.current?.focus();
  };

  const addVariantToSale = (variant) => {
    if (!variant?.barcode) {
      setError('Only barcode-enabled variants can be added to a sale.');
      return;
    }

    addItem({
      id: variant.id,
      variantId: variant.id,
      productId: variant.productId || variant.product?.id,
      productName: variant.product?.name || variant.productName || variant.name,
      variantName: variant.name,
      sku: variant.sku,
      barcode: variant.barcode,
      sellingPrice: variant.sellingPrice,
      taxRate: variant.product?.taxRate ?? 0,
    });
    setCatalogOpen(false);
    setCatalogQuery('');
    barcodeRef.current?.focus();
  };

  const catalogResults = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    const products = catalog || [];

    const variants = products.flatMap((product) =>
      (product.variants || [])
        .filter((variant) => variant.barcode)
        .map((variant) => ({
          ...variant,
          product,
        }))
    );

    if (!query) {
      return variants.slice(0, 50);
    }

    return variants.filter((variant) => {
      const haystack = [
        variant.product?.name,
        variant.product?.brand,
        variant.product?.category?.name,
        variant.product?.category?.path,
        variant.name,
        variant.sku,
        variant.barcode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [catalog, catalogQuery]);

  const handleCompleteSale = async () => {
    setError('');
    if (!items.length) {
      setError('Cart is empty.');
      return;
    }
    if (paymentMethod === 'cash' && Number(tendered || 0) + 0.001 < totals.total) {
      setError('Tendered amount is less than the total.');
      return;
    }

    setSaving(true);
    const response = await invokeWithAuth('sale:create', {
      cartItems: items.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount,
        taxRate: item.taxRate,
      })),
      payment: {
        method: paymentMethod,
        amountTendered: paymentMethod === 'cash' ? Number(tendered || 0) : totals.total,
      },
    });
    setSaving(false);

    if (!response.success) {
      setError(response.error || 'Failed to complete sale.');
      return;
    }

    setCompletedSale(response.data);
    setReceiptSeconds(120);
    setLastSale(response.data);
    notifyLowStockUpdated();
    clear();
    setTendered('');
    setPaymentMethod('cash');
    setSuccessOpen(true);
  };

  const handlePrintReceipt = () => {
    if (!completedSale) return;
    const shopName = settings?.shopName || 'POSLY Store';
    const win = window.open('', '_blank', 'width=400,height=700');
    if (!win) {
      setError('Pop-up blocked. Allow pop-ups to print the receipt.');
      return;
    }

    const lines = (completedSale.items || [])
      .map(
        (item) =>
          `<tr><td>${item.productName}</td><td>${item.quantity}</td><td>${formatMoney(item.unitPrice)}</td><td>${formatMoney(item.lineTotal)}</td></tr>`
      )
      .join('');

    const qrImg = completedSale.ird?.qrData
      ? `<img src="${completedSale.ird.qrData}" alt="QR" style="width:140px;height:140px;margin:12px auto;display:block;" />`
      : '';

    win.document.write(`
      <html><head><title>${completedSale.invoiceNumber}</title>
      <style>
        body { font-family: monospace; padding: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        td, th { text-align: left; padding: 4px 0; }
        h1 { font-size: 16px; margin: 0 0 8px; }
        .muted { color: #555; font-size: 12px; }
      </style></head><body>
        <h1>${shopName}</h1>
        <p class="muted">${settings?.shopAddress || ''}</p>
        <p><strong>${completedSale.invoiceNumber}</strong></p>
        <p class="muted">${new Date(completedSale.saleDate).toLocaleString()}</p>
        <hr />
        <table>
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>
        <hr />
        <p>Subtotal: ${formatMoney(completedSale.subtotal)}</p>
        <p>Discount: ${formatMoney(completedSale.discountTotal)}</p>
        <p>VAT: ${formatMoney(completedSale.vatTotal)}</p>
        <p><strong>Total: ${formatMoney(completedSale.total)}</strong></p>
        <p>Paid (${completedSale.paymentMethod}): ${formatMoney(completedSale.amountTendered)}</p>
        <p>Change: ${formatMoney(completedSale.changeGiven)}</p>
        ${qrImg}
        <p class="muted">${settings?.receiptFooter || 'Thank you'}</p>
        <script>window.print();</script>
      </body></html>
    `);
    win.document.close();
  };

  const startNewSale = () => {
    setSuccessOpen(false);
    setCompletedSale(null);
    setReceiptSeconds(120);
    barcodeRef.current?.focus();
  };

  useEffect(() => {
    if (!successOpen) return undefined;
    const timer = window.setInterval(() => {
      setReceiptSeconds((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(timer);
          startNewSale();
          return 120;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [successOpen]);

  const resetReceiptCountdown = () => setReceiptSeconds(120);

  return (
    <AppShell title="New Sale" description="Scan barcode, take payment, save the sale.">
      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        {/* Left Side: Ledger / Items List */}
        <div className="space-y-4">
          {error && (
            <Alert variant="destructive" className="rounded-xl border-destructive/20 bg-destructive/10">
              <AlertDescription className="text-destructive font-semibold">{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleLookup} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input
                ref={barcodeRef}
                className={cn(inputClassName, 'pl-12 h-14 text-base border-2 focus:ring-4 placeholder:text-muted-foreground/60')}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Scan or type barcode, then Enter"
                autoComplete="off"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 px-2 py-1 rounded-lg bg-muted border border-border text-[10px] font-bold text-muted-foreground/80 tracking-widest select-none font-mono">
                PRESS F1
              </span>
            </div>
            <Button type="submit" className="h-14 px-6 rounded-xl font-bold text-base cursor-pointer">Add</Button>
            <Button type="button" variant="outline" className="h-14 px-6 rounded-xl font-bold text-base" onClick={() => setCatalogOpen(true)}>
              Browse
            </Button>
          </form>

          <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground border-b border-border/60">
                  <tr>
                    <th className="text-left p-4 font-bold text-xs uppercase tracking-wider">Item</th>
                    <th className="text-left p-4 font-bold text-xs uppercase tracking-wider w-[180px]">Qty</th>
                    <th className="text-left p-4 font-bold text-xs uppercase tracking-wider">Price</th>
                    <th className="text-left p-4 font-bold text-xs uppercase tracking-wider w-[120px]">Disc.</th>
                    <th className="text-right p-4 font-bold text-xs uppercase tracking-wider">Total</th>
                    <th className="p-4 w-[60px]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {!items.length && (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-muted-foreground font-medium text-base">
                        No items added. Scan a barcode to start checkout.
                      </td>
                    </tr>
                  )}
                  {totals.lines.map((item) => (
                    <tr key={item.variantId} className="hover:bg-muted/5 transition-colors">
                      <td className="p-4 align-middle">
                        <p className="font-bold text-base text-foreground leading-tight">{item.productName}</p>
                        <p className="text-xs text-muted-foreground mt-1 font-mono tracking-wide">{item.barcode || item.sku}</p>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateQty(item.variantId, item.quantity - 1)}
                            className="h-10 w-10 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all select-none cursor-pointer"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <input
                            type="number"
                            min="1"
                            className="w-14 h-10 rounded-xl border border-border bg-input text-center font-bold text-base focus:outline-none focus:ring-2 focus:ring-ring"
                            value={item.quantity}
                            onChange={(e) => updateQty(item.variantId, e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => updateQty(item.variantId, item.quantity + 1)}
                            className="h-10 w-10 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all select-none cursor-pointer"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                      <td className="p-4 align-middle font-bold text-foreground">{formatMoney(item.unitPrice)}</td>
                      <td className="p-4 align-middle">
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground font-mono">Rs.</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-24 h-10 pl-8 rounded-xl border border-border bg-input text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
                            value={item.discountAmount}
                            onChange={(e) => applyDiscount(item.variantId, e.target.value)}
                          />
                        </div>
                      </td>
                      <td className="p-4 align-middle text-right font-bold text-base text-foreground">{formatMoney(item.lineTotal)}</td>
                      <td className="p-4 align-middle text-right">
                        <button 
                          type="button" 
                          onClick={() => removeItem(item.variantId)}
                          className="p-2.5 rounded-xl text-destructive hover:bg-destructive/10 active:scale-95 transition-all cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Side: Payment Pane */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-6 h-fit shadow-md">
          <div>
            <h3 className="font-extrabold text-lg text-foreground mb-1">Select Payment</h3>
            <p className="text-xs text-muted-foreground">Choose customer checkout method</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { id: 'cash', label: 'Cash', activeBg: 'bg-emerald-500/15 border-emerald-500 text-emerald-500 font-bold' },
              { id: 'card', label: 'Card', activeBg: 'bg-violet-500/15 border-violet-500 text-violet-500 font-bold' },
              { id: 'qr', label: 'QR Pay', activeBg: 'bg-amber-500/15 border-amber-500 text-amber-500 font-bold' },
            ].map(({ id, label, activeBg }) => {
              const isActive = paymentMethod === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setPaymentMethod(id);
                    if (id !== 'cash') {
                      setTendered('');
                    }
                  }}
                  className={cn(
                    'h-14 rounded-xl border-2 text-sm font-bold transition-all cursor-pointer shadow-sm active:scale-95',
                    isActive ? activeBg : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="p-4 rounded-xl bg-muted/40 border border-border/40 space-y-3 text-sm">
            <div className="flex justify-between font-semibold">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-foreground">{formatMoney(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-muted-foreground">Discount</span>
              <span className="text-foreground">{formatMoney(totals.discountTotal)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-muted-foreground">VAT (incl.)</span>
              <span className="text-foreground">{formatMoney(totals.vatTotal)}</span>
            </div>
            <div className="flex justify-between text-lg font-black pt-3 border-t border-border border-dashed">
              <span className="text-foreground">Grand Total</span>
              <span className="text-foreground text-xl">{formatMoney(totals.total)}</span>
            </div>
          </div>

          {paymentMethod === 'cash' && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-bold text-foreground" htmlFor="tendered">
                  Cash Tendered
                </label>
                <button
                  type="button"
                  onClick={() => setTendered(String(totals.total.toFixed(2)))}
                  className="text-xs font-bold text-primary hover:underline cursor-pointer"
                >
                  Set exact amount
                </button>
              </div>
              
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground font-mono">Rs.</span>
                <input
                  id="tendered"
                  type="number"
                  min="0"
                  step="0.01"
                  className={cn(inputClassName, 'pl-11 text-lg font-black h-12 border-2 focus:ring-4')}
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  placeholder={String(totals.total.toFixed(2))}
                />
              </div>

              {/* Quick Cash Buttons for Sri Lankan LKR / Rupees */}
              <div className="grid grid-cols-4 gap-2">
                {[100, 500, 1000, 5000].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => {
                      const currentTendered = Number(tendered || 0);
                      setTendered(String(currentTendered + amount));
                    }}
                    className="h-10 rounded-xl border border-border bg-card hover:bg-muted text-xs font-extrabold text-foreground cursor-pointer transition-all active:scale-95"
                  >
                    +{amount}
                  </button>
                ))}
              </div>

              <div className="flex justify-between items-center text-sm font-bold pt-1">
                <span className="text-muted-foreground">Change Due</span>
                <span className={cn('text-base font-black', change >= 0 ? 'text-emerald-500' : 'text-destructive')}>{formatMoney(change)}</span>
              </div>
            </div>
          )}

          <div className="space-y-3 pt-2">
            <button 
              type="button"
              disabled={saving || !items.length} 
              onClick={handleCompleteSale}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 font-bold text-white shadow-lg shadow-orange-500/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none select-none cursor-pointer flex items-center justify-center gap-2"
            >
              {saving ? 'Processing...' : 'Complete Checkout'}
            </button>
            
            <button 
              type="button" 
              onClick={() => navigate(-1)}
              className="w-full h-12 rounded-xl border border-border bg-card hover:bg-muted font-semibold text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-sm"
            >
              Cancel Sale
            </button>
          </div>
        </div>
      </div>

      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Search Products</DialogTitle>
            <DialogDescription>
              Search by name, SKU, barcode, or brand. Only barcode-enabled variants can be added.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                className={cn(inputClassName, 'pl-10')}
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder="Search products..."
              />
            </div>

            <div className="space-y-2">
              {!catalogResults.length && (
                <p className="text-sm text-muted-foreground">No matching barcode-enabled products found.</p>
              )}
              {catalogResults.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => addVariantToSale(variant)}
                  className="w-full text-left rounded-xl border border-border bg-card p-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{variant.product?.name || variant.productName || variant.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {variant.product?.brand || ''}{variant.product?.brand ? ' · ' : ''}{variant.name || 'Default variant'}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono mt-1">
                        {variant.barcode} · {variant.sku}
                      </p>
                    </div>
                    <div className="text-sm font-bold text-foreground">
                      {formatMoney(variant.sellingPrice)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice receipt modal on success */}
      <Dialog open={successOpen} onOpenChange={(open) => { if (!open) startNewSale(); }}>
        <DialogContent className="max-w-md bg-card border border-border rounded-3xl p-6 shadow-2xl">
          <DialogHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mb-2">
              <span className="text-emerald-500 text-xl font-bold">✓</span>
            </div>
            <DialogTitle className="text-2xl font-extrabold text-foreground">Sale Completed</DialogTitle>
            <DialogDescription className="text-xs font-mono font-bold tracking-widest text-muted-foreground uppercase">
              Invoice #{completedSale?.invoiceNumber}
            </DialogDescription>
          </DialogHeader>
          
          {completedSale && (
            <div onClick={resetReceiptCountdown} className="relative my-6 p-5 rounded-2xl bg-muted/30 border border-border/50 space-y-4 font-semibold cursor-pointer">
              <div className="absolute right-4 top-3 text-xs font-semibold text-amber-600">Starting new sale in 0:{String(receiptSeconds).padStart(2, '0')}...</div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Sale</span>
                <span className="font-extrabold text-foreground text-lg">{formatMoney(completedSale.total)}</span>
              </div>
              <div className="flex justify-between text-sm items-center">
                <span className="text-muted-foreground">Payment Method</span>
                <span className="text-xs uppercase font-extrabold tracking-widest bg-muted border border-border px-2.5 py-1 rounded-lg text-foreground">
                  {completedSale.paymentMethod}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cash Tendered</span>
                <span className="text-foreground">{formatMoney(completedSale.amountTendered)}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-dashed border-border/60">
                <span className="text-muted-foreground">Change Given</span>
                <span className="font-black text-emerald-500 text-base">{formatMoney(completedSale.changeGiven)}</span>
              </div>
              
              {completedSale.ird?.qrData && (
                <div className="pt-4 flex flex-col items-center justify-center">
                  <div className="p-3 bg-white rounded-xl shadow-sm border border-border/40">
                    <img src={completedSale.ird.qrData} alt="Invoice QR" className="h-32 w-32 object-contain" />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-semibold mt-2 tracking-wider">IRD GOVERNMENT QR REGISTERED</span>
                </div>
              )}
            </div>
          )}
          
          <DialogFooter className="grid grid-cols-2 gap-3 sm:space-x-0">
            <button 
              type="button" 
              onClick={handlePrintReceipt}
              className="h-12 rounded-xl border border-border hover:bg-muted font-bold text-sm text-foreground flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
            >
              <Printer className="h-4 w-4" />
              Print Receipt
            </button>
            <button 
              type="button" 
              onClick={startNewSale}
              className="h-12 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 font-bold text-sm text-white shadow-md shadow-orange-500/10 flex items-center justify-center cursor-pointer transition-all active:scale-95"
            >
              New Sale
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
