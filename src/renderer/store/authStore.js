import { create } from 'zustand';

export const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isInitialized: false,
  needsRecoverySetup: false,

  setLogin: (userData, token) => {
    if (!userData?.role) {
      console.error('Missing role in user object');
      return;
    }
    set({
      user: userData,
      token,
      isAuthenticated: true,
      isInitialized: true,
      needsRecoverySetup: Boolean(userData.needsRecoverySetup),
    });
  },

  setNeedsRecoverySetup: (value) => {
    set({ needsRecoverySetup: Boolean(value) });
  },

  setLogout: async () => {
    const token = get().token;
    if (window.electronAPI?.invoke) {
      await window.electronAPI.invoke('auth:logout', { token });
    }
    set({ user: null, token: null, isAuthenticated: false, needsRecoverySetup: false });
  },

  handleUnauthorized: () => {
    set({ user: null, token: null, isAuthenticated: false, needsRecoverySetup: false });
  },

  initializeAuth: async () => {
    if (!window.electronAPI?.invoke) {
      set({ isInitialized: true });
      return null;
    }

    try {
      const response = await window.electronAPI.invoke('auth:restore-session');
      if (response?.success) {
        set({
          user: response.user,
          token: response.token,
          isAuthenticated: true,
          isInitialized: true,
          needsRecoverySetup: Boolean(response.user?.needsRecoverySetup),
        });
        return response.user;
      }
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isInitialized: true,
        needsRecoverySetup: false,
      });
      return null;
    } catch (error) {
      console.error('Failed to restore session:', error);
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isInitialized: true,
        needsRecoverySetup: false,
      });
      return null;
    }
  },
}));

if (process.env.NODE_ENV === 'development') {
  window.store = useAuthStore;
}
