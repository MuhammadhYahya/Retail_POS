import { useAuthStore } from '../store/authStore';

export const LOW_STOCK_UPDATED_EVENT = 'zen:low-stock-updated';

export function notifyLowStockUpdated() {
  window.dispatchEvent(new Event(LOW_STOCK_UPDATED_EVENT));
}

export async function invokeWithAuth(channel, data = {}) {
  const token = useAuthStore.getState().token;
  const response = await window.electronAPI.invoke(channel, { ...data, _token: token });

  if (response?.code === 'UNAUTHORIZED') {
    useAuthStore.getState().handleUnauthorized();
  }

  return response;
}

export function subscribeProgress(channel, handler) {
  if (!window.electronAPI?.on) {
    return () => {};
  }
  return window.electronAPI.on(channel, handler);
}

export function getDashboardPath(role) {
  if (role === 'admin') return '/admin';
  if (role === 'manager') return '/manager';
  return '/cashier';
}
