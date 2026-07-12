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
  // This part is critical for Electron to find your React entry point [2]
  build: {
    outDir: '../../.vite/renderer',
    rollupOptions: {
      input: './src/renderer/index.html',
    },
  },
});