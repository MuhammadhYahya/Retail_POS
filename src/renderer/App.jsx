import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { getDashboardPath } from './lib/ipc';

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
import RecoverySetupDialog from './components/auth/RecoverySetupDialog';

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
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        Loading...
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
          path="/staff"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['admin']}>
                <StaffManagement />
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/products"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['admin', 'cashier']}>
                <ProductsManagement />
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/low-stock"
          element={<ProtectedRoute><RoleGuard allowedRoles={['admin', 'cashier']}><LowStockPage /></RoleGuard></ProtectedRoute>}
        />

        <Route
          path="/billing"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['admin', 'cashier']}>
                <BillingPage />
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['admin']}>
                <ReportsPage />
              </RoleGuard>
            </ProtectedRoute>
          }
        />

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
