import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import AppShell from '../../components/layout/AppShell';
import { ShoppingCart, Package, Clock, Receipt } from 'lucide-react';
import { invokeWithAuth } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';

function formatMoney(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [sales, setSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(true);
  const [salesError, setSalesError] = useState('');
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    invokeWithAuth('sale:listTodayShop').then((response) => {
      if (response.success) setSales(response.data || []);
      else setSalesError(response.error || 'Failed to load today\'s sales.');
      setSalesLoading(false);
    });
  }, []);

  // Display-only roll-up of the rows already fetched. The authoritative
  // end-of-day figures remain the Z-report in Day Open / Close; this excludes
  // refunds and expenses, so it will legitimately differ from drawer cash.
  const figures = useMemo(() => {
    const total = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const cash = sales
      .filter((sale) => sale.paymentMethod === 'cash')
      .reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    return {
      count: sales.length,
      total: round(total),
      cash: round(cash),
      card: round(total - cash),
    };
  }, [sales]);

  const viewReceipt = async (saleId) => {
    const response = await invokeWithAuth('sale:getReceipt', { saleId });
    if (response.success) setReceipt(response.data);
    else setSalesError(response.error || 'Failed to load receipt.');
  };


  return (
    <AppShell title="Admin Dashboard" description="Manage your POS system and team.">
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-3xl bg-card border border-border p-6 sm:p-8 shadow-sm">
          <div className="relative z-10 space-y-2">
            <span className="px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/25 text-xs font-bold text-rose-400 tracking-wider uppercase">
              System Administrator Mode
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
              Welcome back, {user?.display_name || user?.username}!
            </h1>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-primary/5 pointer-events-none" />
        </div>

        {/* Today's trading - the figures an owner wants on login */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl bg-primary-tint border border-primary/20 px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-wider text-primary-dark/70">Today&apos;s sales</p>
            <p className="mt-1 text-3xl font-black tabular-nums text-primary-dark leading-none">
              {formatMoney(figures.total)}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Transactions</p>
            <p className="mt-1 text-3xl font-black tabular-nums text-foreground leading-none">{figures.count}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cash</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-foreground leading-none">
              {formatMoney(figures.cash)}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Card</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-foreground leading-none">
              {formatMoney(figures.card)}
            </p>
          </div>
        </div>

        <section className="@container rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
            <div>
              <h2 className="text-lg font-bold">Today&apos;s Sales</h2>
              <p className="text-sm text-muted-foreground">Every sale made in the shop today.</p>
            </div>
            <Receipt className="h-5 w-5 text-muted-foreground shrink-0" />
          </div>

          {salesLoading ? (
            <p className="p-5 text-sm text-muted-foreground">Loading today&apos;s sales...</p>
          ) : salesError ? (
            <p className="p-5 text-sm text-destructive">{salesError}</p>
          ) : sales.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No sales completed today.</p>
          ) : (
            <>
              <div className="divide-y divide-border/40 @3xl:hidden max-h-96 overflow-y-auto">
                {sales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-mono font-bold truncate">{sale.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {new Date(sale.saleDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        {' \u00b7 '}{sale.cashierName || sale.cashierUsername || 'Unknown'}
                        {' \u00b7 '}{sale.itemCount} item{sale.itemCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-bold tabular-nums">{formatMoney(sale.total)}</span>
                      <Button variant="outline" size="sm" className="h-11" onClick={() => viewReceipt(sale.id)}>
                        View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden @3xl:block max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3">Invoice #</th>
                      <th className="text-left px-4 py-3">Time</th>
                      <th className="text-left px-4 py-3">Cashier</th>
                      <th className="text-left px-4 py-3">Items</th>
                      <th className="text-left px-4 py-3">Method</th>
                      <th className="text-right px-4 py-3">Total</th>
                      <th className="px-4 py-3 text-right">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {sales.map((sale) => (
                      <tr key={sale.id}>
                        <td className="px-4 py-3 font-mono font-semibold">{sale.invoiceNumber}</td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums">
                          {new Date(sale.saleDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-3">{sale.cashierName || sale.cashierUsername || 'Unknown'}</td>
                        <td className="px-4 py-3 tabular-nums">{sale.itemCount}</td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">{sale.paymentMethod}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums">{formatMoney(sale.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="outline" size="sm" className="h-11" onClick={() => viewReceipt(sale.id)}>
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>


        <div className="grid gap-6 md:grid-cols-2">
          <button
            type="button"
            onClick={() => navigate('/billing')}
            className="group relative overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8 text-left shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-200 cursor-pointer flex flex-col justify-between min-h-52 hover:border-emerald-500/35 hover:shadow-emerald-500/5 focus:outline-none focus:ring-2 focus:ring-primary"
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
                  Open the register &mdash; scan, take payment, print the receipt.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-6 border-t border-border/40 text-xs font-bold text-muted-foreground uppercase tracking-widest group-hover:text-primary transition-colors">
              <span>Open Register</span>
              <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/products')}
            className="group relative overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8 text-left shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-200 cursor-pointer flex flex-col justify-between min-h-52 hover:border-violet-500/35 hover:shadow-violet-500/5 focus:outline-none focus:ring-2 focus:ring-primary"
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
                  Check stock, prices, and barcodes across every product.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-6 border-t border-border/40 text-xs font-bold text-muted-foreground uppercase tracking-widest group-hover:text-primary transition-colors">
              <span>View Inventory</span>
              <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/day-close')}
            className="group relative overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8 text-left shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-200 cursor-pointer flex flex-col justify-between min-h-52 hover:border-teal-500/35 hover:shadow-teal-500/5 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <div className="space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-teal-500/10 text-teal-500 flex items-center justify-center transition-transform group-hover:scale-110">
                <Clock className="h-7 w-7" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-xl font-extrabold text-foreground group-hover:text-primary transition-colors">
                  Day Open / Z-Close
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Opening float, X-report, and end-of-day Z-report.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-6 border-t border-border/40 text-xs font-bold text-muted-foreground uppercase tracking-widest group-hover:text-primary transition-colors">
              <span>Open Day Controls</span>
              <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/expenses')}
            className="group relative overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8 text-left shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-200 cursor-pointer flex flex-col justify-between min-h-52 hover:border-lime-500/35 hover:shadow-lime-500/5 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <div className="space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-lime-500/10 text-lime-600 flex items-center justify-center transition-transform group-hover:scale-110">
                <Receipt className="h-7 w-7" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-xl font-extrabold text-foreground group-hover:text-primary transition-colors">
                  Expenses
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Record petty cash and shop costs for today's drawer.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-6 border-t border-border/40 text-xs font-bold text-muted-foreground uppercase tracking-widest group-hover:text-primary transition-colors">
              <span>Record Expense</span>
              <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
            </div>
          </button>
        </div>
      </div>

      <Dialog open={Boolean(receipt)} onOpenChange={(open) => !open && setReceipt(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Receipt #{receipt?.sale?.invoiceNumber}</DialogTitle>
          </DialogHeader>
          {receipt?.sale && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span>Total</span>
                <strong className="tabular-nums">{formatMoney(receipt.sale.total)}</strong>
              </div>
              <div className="border-t border-border pt-2">
                {receipt.sale.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-1">
                    <span>{item.productName} × {item.quantity}</span>
                    <span className="tabular-nums">{formatMoney(item.lineTotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
