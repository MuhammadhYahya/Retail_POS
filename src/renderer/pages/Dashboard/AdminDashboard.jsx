import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import AppShell from '../../components/layout/AppShell';
import { ShoppingCart, Package, Users, BarChart3, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';

const MODULES = [
  {
    title: 'New Sale',
    description: 'Open the register — scan, pay, and save invoices.',
    icon: ShoppingCart,
    path: '/billing',
    color: 'hover:border-emerald-500/35 hover:shadow-emerald-500/5',
    iconBg: 'bg-emerald-500/10 text-emerald-500',
  },
  {
    title: 'Product Module',
    description: 'Manage products, variants, categories, and inventory ledgers.',
    icon: Package,
    path: '/products',
    color: 'hover:border-violet-500/35 hover:shadow-violet-500/5',
    iconBg: 'bg-violet-500/10 text-violet-500',
  },
  {
    title: 'Staff Management',
    description: 'Create and manage cashier and admin accounts.',
    icon: Users,
    path: '/staff',
    color: 'hover:border-rose-500/35 hover:shadow-rose-500/5',
    iconBg: 'bg-rose-500/10 text-rose-500',
  },
  {
    title: 'Sales Reports',
    description: 'View sales analytics and daily summaries.',
    icon: BarChart3,
    path: '/reports',
    color: 'hover:border-sky-500/35 hover:shadow-sky-500/5',
    iconBg: 'bg-sky-500/10 text-sky-500',
  },
  {
    title: 'Settings',
    description: 'Configure store preferences and system options.',
    icon: Settings,
    path: '/settings',
    color: 'hover:border-slate-500/35 hover:shadow-slate-500/5',
    iconBg: 'bg-slate-500/10 text-slate-500',
  },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  return (
    <AppShell title="Admin Dashboard" description="Manage your POS system and team.">
      <div className="space-y-8">
        {/* Welcome Greeting Banner */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-neutral-900 via-neutral-900 to-neutral-800 dark:from-neutral-950 dark:to-neutral-900 border border-neutral-800 p-8 shadow-xl">
          <div className="relative z-10 space-y-2">
            <span className="px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/25 text-xs font-bold text-rose-400 tracking-wider uppercase">
              System Administrator Mode
            </span>
            <h1 className="text-3xl font-black text-white tracking-tight">
              Welcome back, {user?.display_name || user?.username}!
            </h1>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-rose-500/5 to-transparent pointer-events-none" />
        </div>

        {/* Modules Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((mod) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.title}
                onClick={() => navigate(mod.path)}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 duration-200 cursor-pointer flex flex-col justify-between h-56 focus:outline-none focus:ring-2 focus:ring-primary",
                  mod.color
                )}
              >
                <div className="space-y-4">
                  <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110", mod.iconBg)}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">
                      {mod.title}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                      {mod.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border/40 text-xs font-bold text-muted-foreground uppercase tracking-widest group-hover:text-primary transition-colors">
                  <span>Open Module</span>
                  <span className="transition-transform group-hover:translate-x-1">→</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
