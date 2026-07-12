import { useAuthStore } from '../store/authStore';

export async function invokeWithAuth(channel, data = {}) {
  const token = useAuthStore.getState().token;
  const response = await window.electronAPI.invoke(channel, { ...data, _token: token });

  if (response?.code === 'UNAUTHORIZED') {
    useAuthStore.getState().handleUnauthorized();
  }

  return response;
}

export function getDashboardPath(role) {
  return role === 'admin' ? '/admin' : '/cashier';
}
