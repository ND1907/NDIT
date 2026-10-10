import { defineConfig } from 'vite';

// app.html is de bron-HTML van het spel. De index.html in de hoofdmap is de kant-en-klare
// game in één bestand voor GitHub Pages (gemaakt met `npm run build:demo`).
// Bij het bouwen wordt app.html → dist/index.html (nodig voor Capacitor), en de
// ontwikkelserver toont app.html op /.
// base './' is nodig zodat Capacitor en GitHub Pages de bestanden relatief laden.
export const appEntry = {
  name: 'app-entry',
  enforce: 'post',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/' || req.url === '/index.html') req.url = '/app.html';
      next();
    });
  },
  generateBundle(_, bundle) {
    for (const f of Object.values(bundle)) if (f.fileName === 'app.html') f.fileName = 'index.html';
  },
};

export default defineConfig({
  base: './',
  plugins: [appEntry],
  build: {
    target: 'es2020',
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: 'app.html' },
  },
});
