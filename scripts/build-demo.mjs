// Bouwt de game als één los HTML-bestand (alle JS/CSS ingebakken) om snel te testen
// op een laptop: dubbelklik demo/fetih-1453.html en het spel start in de browser.
import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = 'dist-demo';
await build({
  configFile: false,
  base: './',
  logLevel: 'warn',
  build: {
    outDir: out,
    target: 'es2020',
    assetsInlineLimit: 1e9,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 5000,
    rollupOptions: { output: { codeSplitting: false } },
  },
});

let html = readFileSync(join(out, 'index.html'), 'utf8');
const assets = join(out, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const icon = 'data:image/svg+xml;base64,' + readFileSync('public/icon.svg').toString('base64');

html = html
  .replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, '')
  .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, () => `<style>${css}</style>`)
  .replace('href="./icon.svg"', `href="${icon}"`)
  .replace('</body>', () => `<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>\n</body>`);

mkdirSync('demo', { recursive: true });
writeFileSync('demo/fetih-1453.html', html);

// Variant zonder <html>/<head>/<body> voor publicatie als Claude-artifact.
const head = html.match(/<head>([\s\S]*)<\/head>/)[1].replace(/<meta[^>]*>\s*/g, '').replace(/<link rel="icon"[^>]*>\s*/, '');
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
const fragment = `${head}\n<style>:root{color-scheme:dark}html,body{background:#120c08}:root{padding:0!important}</style>\n<script>document.body.dataset.team='ottoman'</script>\n${body}`;
writeFileSync(join(out, 'artifact.html'), fragment);
console.log('demo/fetih-1453.html', (html.length / 1024).toFixed(0) + ' KB');
