import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { Button } from '../ui/button';
import { LogOut, LayoutDashboard, Users, ShoppingCart, Package, BarChart3, Settings, Sun, Moon } from 'lucide-react';
import { cn } from '../../lib/utils';

const NAV_ITEMS = {
  admin: [
    { path: '/admin', label: 'Dashboard', icon: LayoutDashboard, color: 'text-amber-500' },
    { path: '/billing', label: 'New Sale', icon: ShoppingCart, color: 'text-emerald-500' },
    { path: '/products', label: 'Products', icon: Package, color: 'text-violet-500' },
    { path: '/reports', label: 'Reports', icon: BarChart3, color: 'text-sky-500' },
    { path: '/staff', label: 'Staff Management', icon: Users, color: 'text-rose-500' },
    { path: '/settings', label: 'Settings', icon: Settings, color: 'text-slate-500' },
  ],
  cashier: [
    { path: '/cashier', label: 'POS Terminal', icon: LayoutDashboard, color: 'text-amber-500' },
    { path: '/billing', label: 'New Sale', icon: ShoppingCart, color: 'text-emerald-500' },
    { path: '/products', label: 'Products', icon: Package, color: 'text-violet-500' },
  ],
};

const nameToAvatar = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

export default function AppShell({ children, title, description }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const setLogout = useAuthStore((state) => state.setLogout);
  const { theme, toggleTheme } = useThemeStore();

  const [timeString, setTimeString] = React.useState('');

  React.useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setTimeString(
        now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        ' | ' +
        now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  const navItems = NAV_ITEMS[user?.role] || [];

  const handleLogout = async () => {
    await setLogout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar navigation */}
      <aside className="w-64 border-r border-border bg-card flex flex-col shrink-0 select-none">
        <div className="p-6 border-b border-border/40 flex items-center gap-3">
          <span className="p-2.5 bg-gradient-to-tr from-amber-500 to-orange-600 rounded-xl shadow-md shadow-orange-500/10 text-white font-extrabold text-lg select-none">
            P
          </span>
          <div>
            <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
              POSLY
            </h1>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mt-0.5">Point of Sale</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {navItems.map(({ path, label, icon: Icon, color }) => {
            const isActive = location.pathname === path;
            return (
              <button
                key={path}
                type="button"
                onClick={() => navigate(path)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all cursor-pointer h-14',
                  isActive
                    ? 'bg-primary/10 text-primary border border-primary/20 shadow-sm shadow-primary/5 font-bold'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground border border-transparent'
                )}
              >
                <Icon className={cn("h-5 w-5 shrink-0 transition-transform duration-100", color, isActive && "scale-110")} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border/40">
          <Button variant="outline" className="w-full h-12 rounded-xl font-semibold border-border hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer shadow-sm transition-all" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main content pane */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-border bg-card/45 backdrop-blur-md px-8 py-4 flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-xl font-bold tracking-tight">{title}</h2>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
          
          {/* Center: Real-time clock */}
          <div className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-xl bg-muted/40 border border-border/30 text-sm font-semibold font-mono tracking-wide text-muted-foreground select-none">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {timeString}
          </div>

          {/* Right: Theme switch & User clerk indicator */}
          <div className="flex items-center gap-4 select-none">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2.5 rounded-xl border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-sm active:scale-95"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
            </button>

            <div className="flex items-center gap-3 pl-3 border-l border-border/50">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-foreground truncate max-w-[150px]">
                  {user?.display_name || user?.username}
                </p>
                <p className="text-xs text-muted-foreground capitalize font-medium">
                  {user?.role}
                </p>
              </div>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm shrink-0 ${
                user?.role === 'admin'
                  ? 'bg-gradient-to-tr from-rose-500 to-orange-500 text-white'
                  : 'bg-gradient-to-tr from-sky-500 to-blue-600 text-white'
              }`}>
                {nameToAvatar(user?.display_name || user?.username)}
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1 p-8 overflow-auto">{children}</div>
      </main>
    </div>
  );
}

