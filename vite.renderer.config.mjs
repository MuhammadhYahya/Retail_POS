import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'; // Ensure this is imported for your React UI
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  root: './src/renderer',
  base: './',
  plugins: [
    react(), // Required for your React components [2]
    tailwindcss(), // The new Tailwind v4 plugin
  ],
  // Must match forge renderer name (`main_window`) used by MAIN_WINDOW_VITE_NAME in main.js
  build: {
    outDir: '../../.vite/renderer/main_window',
    rollupOptions: {
      input: './src/renderer/index.html',
    },
  },
});