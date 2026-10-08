import { defineConfig } from 'vite';

// base './' is nodig zodat Capacitor de bestanden vanaf het apparaat kan laden.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
});
