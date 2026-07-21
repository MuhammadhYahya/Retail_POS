import React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import AppShell from '../../components/layout/AppShell';
import { Package, ShoppingCart, Receipt, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { invokeWithAuth } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';

export default function CashierDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [sales, setSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(true);
  const [salesError, setSalesError] = useState('');
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    invokeWithAuth('sale:listTodayCashier').then((response) => {
      if (response.success) setSales(response.data || []);
      else setSalesError(response.error || 'Failed to load today\'s sales.');
      setSalesLoading(false);
    });
  }, []);

  const viewReceipt = async (saleId) => {
    const response = await invokeWithAuth('sale:getReceipt', { saleId });
    if (response.success) setReceipt(response.data);
    else setSalesError(response.error || 'Failed to load receipt.');
  };

  return (
    <AppShell title="POS Terminal" description="Ready to process sales.">
      <div className="space-y-8">
        {/* Welcome Greeting Banner */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-neutral-900 via-neutral-900 to-neutral-800 dark:from-neutral-950 dark:to-neutral-900 border border-neutral-800 p-8 shadow-xl">
          <div className="relative z-10 space-y-2">
            <span className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-xs font-bold text-emerald-400 tracking-wider uppercase">
              Terminal Online
            </span>
            <h1 className="text-3xl font-black text-white tracking-tight">
              Welcome back, {user?.display_name || user?.username}!
            </h1>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-emerald-500/5 to-transparent pointer-events-none" />
        </div>

        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div><h2 className="text-lg font-bold">Today&apos;s Sales</h2><p className="text-sm text-muted-foreground">Your completed transactions for today.</p></div>
            <Receipt className="h-5 w-5 text-muted-foreground" />
          </div>
          {salesLoading ? <p className="text-sm text-muted-foreground">Loading today&apos;s sales...</p> : salesError ? <p className="text-sm text-destructive">{salesError}</p> : sales.length === 0 ? <p className="text-sm text-muted-foreground">No sales completed today.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-3 py-2">Invoice #</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Items</th><th className="px-3 py-2">Total</th><th className="px-3 py-2 text-right">View</th></tr></thead><tbody>
              {sales.map((sale) => <tr key={sale.id} className="border-b border-border/50"><td className="px-3 py-3 font-mono font-semibold">{sale.invoiceNumber}</td><td className="px-3 py-3">{new Date(sale.saleDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td><td className="px-3 py-3">{sale.itemCount}</td><td className="px-3 py-3">Rs. {sale.total.toFixed(2)}</td><td className="px-3 py-3 text-right"><Button variant="outline" size="sm" onClick={() => viewReceipt(sale.id)}>View</Button></td></tr>)}
            </tbody></table></div>
          )}
        </section>

        {/* Action Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
          {/* New Sale */}
          <button
            onClick={() => navigate('/billing')}
            className="group relative overflow-hidden rounded-3xl border border-border bg-card p-8 text-left shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-200 cursor-pointer flex flex-col justify-between h-64 hover:border-emerald-500/35 hover:shadow-emerald-500/5 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <div className="space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center transition-transform group-hover:scale-110">
                <ShoppingCart className="h-7 w-7" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-xl font-extrabold text-foreground group-hover:text-primary transition-colors">
                  New Transaction
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Start a new sale ledger. Scan barcodes, key in quick tender cash totals, and print thermal receipt invoices.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-6 border-t border-border/40 text-xs font-bold text-muted-foreground uppercase tracking-widest group-hover:text-primary transition-colors">
              <span>Open Register</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </div>
          </button>

          {/* Browse Products */}
          <button
            onClick={() => navigate('/products')}
            className="group relative overflow-hidden rounded-3xl border border-border bg-card p-8 text-left shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-200 cursor-pointer flex flex-col justify-between h-64 hover:border-violet-500/35 hover:shadow-violet-500/5 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <div className="space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-violet-500/10 text-violet-500 flex items-center justify-center transition-transform group-hover:scale-110">
                <Package className="h-7 w-7" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-xl font-extrabold text-foreground group-hover:text-primary transition-colors">
                  Browse Catalog
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Query variants, verify inventory stock counts, filter active categories, or verify barcodes/pricing lists.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-6 border-t border-border/40 text-xs font-bold text-muted-foreground uppercase tracking-widest group-hover:text-primary transition-colors">
              <span>View Inventory</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </div>
          </button>
        </div>

        {/* Coming Soon Section */}
        <div className="pt-4">
          <h4 className="text-xs font-extrabold text-muted-foreground uppercase tracking-widest mb-4">Module Addons</h4>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex gap-4 p-5 rounded-2xl border border-border bg-muted/20 opacity-60">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                <Receipt className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h5 className="font-bold text-sm text-foreground">Recent Orders Log</h5>
                <p className="text-xs text-muted-foreground">Detailed history of past invoices issued on this terminal.</p>
              </div>
            </div>

            <div className="flex gap-4 p-5 rounded-2xl border border-border bg-muted/20 opacity-60">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                <Clock className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h5 className="font-bold text-sm text-foreground">Shift Summary Reports</h5>
                <p className="text-xs text-muted-foreground">End of day reconciliations and total register balance checks.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Dialog open={Boolean(receipt)} onOpenChange={(open) => !open && setReceipt(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Receipt #{receipt?.sale?.invoiceNumber}</DialogTitle></DialogHeader>
          {receipt?.sale && <div className="space-y-3 text-sm"><div className="flex justify-between"><span>Total</span><strong>Rs. {receipt.sale.total.toFixed(2)}</strong></div><div className="border-t border-border pt-2">{receipt.sale.items.map((item) => <div key={item.id} className="flex justify-between py-1"><span>{item.productName} × {item.quantity}</span><span>Rs. {item.lineTotal.toFixed(2)}</span></div>)}</div></div>}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
