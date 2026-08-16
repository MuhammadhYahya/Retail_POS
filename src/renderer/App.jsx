import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { getDashboardPath } from './lib/ipc';
import { hasPermission, PATH_PERMISSION } from './lib/permissions.js';

import LoginPage from './pages/Login/LoginPage';
import RegisterPage from './pages/Register/RegisterPage';
import AdminDashboard from './pages/Dashboard/AdminDashboard';
import CashierDashboard from './pages/Dashboard/CashierDashboard';
import StaffManagement from './pages/Dashboard/StaffManagement';
import ProductsManagement from './pages/Dashboard/ProductsManagement';
import DashboardRedirect from './pages/Dashboard/Dashboard';
import BillingPage from './pages/Billing/BillingPage';
import ReportsPage from './pages/Reports/ReportsPage';
import SettingsPage from './pages/Settings/SettingsPage';
import LowStockPage from './pages/Inventory/LowStockPage';
import DayClosePage from './pages/Cash/DayClosePage';
import PurchasesPage from './pages/Purchases/PurchasesPage';
import ReturnsPage from './pages/Returns/ReturnsPage';
import ExpensesPage from './pages/Expenses/ExpensesPage';
import AuditPage from './pages/Audit/AuditPage';
import LabelsPage from './pages/Labels/LabelsPage';
import RecoverySetupDialog from './components/auth/RecoverySetupDialog';
import { invokeWithAuth } from './lib/ipc';

function StartupDataGate() {
  const [state, setState] = useState(null);
  const [mode, setMode] = useState('choice');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.electronAPI.invoke('data:getState').then((response) => {
      const next = response?.data || {};
      setState(next.needsChoice ? next : null);
    });
  }, []);

  if (!state) return null;

  const useExisting = async () => {
    setBusy(true);
    const response = await window.electronAPI.invoke('data:useExisting');
    if (response.success) setState(null);
    else setError(response.error || 'Could not keep existing data.');
    setBusy(false);
  };

  const startFresh = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const response = await window.electronAPI.invoke('data:startFresh', { username, pin });
    if (!response.success) {
      setError(response.error || 'Could not start fresh.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        {mode === 'choice' ? (
          <>
            <h1 className="text-xl font-semibold">Existing ZEN data found</h1>
            <p className="mt-2 text-sm text-muted-foreground">Choose whether to continue with this shop or create an empty POS.</p>
            <div className="mt-6 flex flex-col gap-3">
              <button className="rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground" onClick={useExisting} disabled={busy}>Use Existing Data</button>
              <button className="rounded-lg border border-border px-4 py-3 font-semibold" onClick={() => setMode('fresh')} disabled={busy}>Start Fresh</button>
            </div>
          </>
        ) : (
          <form onSubmit={startFresh}>
            <h1 className="text-xl font-semibold">Start Fresh</h1>
            <p className="mt-2 text-sm text-muted-foreground">A verified safety backup will be created before the old shop is replaced.</p>
            <div className="mt-5 space-y-3">
              <input className="w-full rounded-lg border border-border bg-input p-3" placeholder="Administrator username" value={username} onChange={(e) => setUsername(e.target.value)} required />
              <input className="w-full rounded-lg border border-border bg-input p-3" placeholder="Administrator PIN" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} required />
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-6 flex gap-3">
              <button type="button" className="rounded-lg border border-border px-4 py-3" onClick={() => setMode('choice')} disabled={busy}>Back</button>
              <button type="submit" className="flex-1 rounded-lg bg-destructive px-4 py-3 font-semibold text-destructive-foreground" disabled={busy}>{busy ? 'Preparing…' : 'Create Empty POS'}</button>
            </div>
          </form>
        )}
        {mode === 'choice' && error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const user = useAuthStore((state) => state.user);
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function GuestRoute({ children }) {
  const user = useAuthStore((state) => state.user);
  if (user) {
    return <Navigate to={getDashboardPath(user.role)} replace />;
  }
  return children;
}

function RoleGuard({ children, allowedRoles }) {
  const user = useAuthStore((state) => state.user);
  if (!allowedRoles.includes(user?.role)) {
    return <Navigate to={getDashboardPath(user?.role) || '/login'} replace />;
  }
  return children;
}

function PermissionGuard({ children, permission }) {
  const user = useAuthStore((state) => state.user);
  if (!hasPermission(user, permission)) {
    return <Navigate to={getDashboardPath(user?.role) || '/login'} replace />;
  }
  return children;
}

function FeatureRoute({ permission, children }) {
  return (
    <ProtectedRoute>
      <PermissionGuard permission={permission}>
        {children}
      </PermissionGuard>
    </ProtectedRoute>
  );
}

function AuthBootstrap() {
  const initializeAuth = useAuthStore((state) => state.initializeAuth);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const navigate = useNavigate();

  useEffect(() => {
    const init = async () => {
      const user = await initializeAuth();
      if (user) {
        navigate(getDashboardPath(user.role), { replace: true });
      }
    };
    init();
  }, [initializeAuth, navigate]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-background text-muted-foreground">
        <img src="./front-loading-image.png" alt="ZEN loading" className="max-h-56 max-w-[min(80vw,28rem)] object-contain" />
        <p className="text-sm">Loading ZEN...</p>
      </div>
    );
  }

  return null;
}

function AppRoutes() {
  const user = useAuthStore((state) => state.user);
  const isInitialized = useAuthStore((state) => state.isInitialized);

  if (!isInitialized) {
    return <AuthBootstrap />;
  }

  return (
    <>
      <StartupDataGate />
      {user && <RecoverySetupDialog />}
      <Routes>
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />

        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['admin']}>
                <AdminDashboard />
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/cashier"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['cashier']}>
                <CashierDashboard />
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/manager"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['manager']}>
                <CashierDashboard />
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/staff"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['admin']}>
                <StaffManagement />
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route path="/products" element={<FeatureRoute permission={PATH_PERMISSION['/products']}><ProductsManagement /></FeatureRoute>} />
        <Route path="/low-stock" element={<FeatureRoute permission={PATH_PERMISSION['/low-stock']}><LowStockPage /></FeatureRoute>} />
        <Route
          path="/billing"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['admin', 'manager', 'cashier']}>
                <BillingPage />
              </RoleGuard>
            </ProtectedRoute>
          }
        />
        <Route path="/reports" element={<FeatureRoute permission={PATH_PERMISSION['/reports']}><ReportsPage /></FeatureRoute>} />
        <Route path="/audit" element={<ProtectedRoute><RoleGuard allowedRoles={['admin']}><AuditPage /></RoleGuard></ProtectedRoute>} />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['admin']}>
                <SettingsPage />
              </RoleGuard>
            </ProtectedRoute>
          }
        />
        <Route path="/day-close" element={<FeatureRoute permission={PATH_PERMISSION['/day-close']}><DayClosePage /></FeatureRoute>} />
        <Route path="/purchases" element={<FeatureRoute permission={PATH_PERMISSION['/purchases']}><PurchasesPage /></FeatureRoute>} />
        <Route path="/returns" element={<FeatureRoute permission={PATH_PERMISSION['/returns']}><ReturnsPage /></FeatureRoute>} />
        <Route path="/expenses" element={<FeatureRoute permission={PATH_PERMISSION['/expenses']}><ExpensesPage /></FeatureRoute>} />
        <Route path="/labels" element={<FeatureRoute permission={PATH_PERMISSION['/labels']}><LabelsPage /></FeatureRoute>} />

        <Route path="/dashboard" element={<ProtectedRoute><DashboardRedirect /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  );
}
