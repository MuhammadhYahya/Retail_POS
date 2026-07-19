import { create } from 'zustand';

export const useThemeStore = create((set, get) => {
  const initialTheme = localStorage.getItem('theme') || 'dark';
  
  const applyTheme = (theme) => {
    const root = document.documentElement;
    const body = document.body;
    if (theme === 'light') {
      root.classList.add('light');
      body.classList.add('light');
    } else {
      root.classList.remove('light');
      body.classList.remove('light');
    }
  };
  
  applyTheme(initialTheme);

  return {
    theme: initialTheme,
    toggleTheme: () => {
      const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', nextTheme);
      applyTheme(nextTheme);
      set({ theme: nextTheme });
    },
    setTheme: (theme) => {
      localStorage.setItem('theme', theme);
      applyTheme(theme);
      set({ theme });
    }
  };
});
