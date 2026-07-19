import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import AppShell from '../../components/layout/AppShell';
import { Package, ShoppingCart, Receipt, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';

export default function CashierDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

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
            <p className="text-neutral-400 text-sm max-w-xl leading-relaxed">
              Your register terminal is authorized and connected. Scan items, apply local discounts, and finalize sales securely.
            </p>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-emerald-500/5 to-transparent pointer-events-none" />
        </div>

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
    </AppShell>
  );
}
