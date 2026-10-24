import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// This preview uses actual UI components and isolated sample-data adapters.
// It never loads environment files or connects to a WeHouse backend.
for (const args of [['tests/browser/wallet-pro-journeys.mjs', '--build-only'], ['tests/browser/build-support-inbox.mjs']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const routes = new Map([
  ['/property.js', ['test-results/wallet-pro-journeys/fixture.js', 'application/javascript']],
  ['/property.css', ['test-results/wallet-pro-journeys/fixture.css', 'text/css']],
  ['/help.js', ['test-results/support-inbox-offline/fixture.js', 'application/javascript']],
  ['/help.css', ['test-results/support-inbox-offline/fixture.css', 'text/css']],
]);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // No live network transport, geolocation, microphone or camera in a sample.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; font-src 'self' data:; frame-ancestors 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const asset = routes.get(url.pathname);
  if (asset) { res.setHeader('Content-Type', asset[1]); res.end(fs.readFileSync(asset[0])); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname === '/') { res.end(fs.readFileSync(path.resolve('scripts/property-phone-preview.html'))); return; }
  if (!['/property', '/help'].includes(url.pathname)) { res.statusCode = 404; res.end('Not found'); return; }
  const bundle = url.pathname.slice(1);
  const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
  res.end(`<!doctype html><html lang="en" data-wh-theme="${theme}" class="${theme === 'dark' ? 'dark' : ''}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${bundle}.css"><style>body{background:var(--wh-bg);margin:0}</style></head><body><div id="root"></div><script src="/${bundle}.js"></script></body></html>`);
});
server.listen(4178, '127.0.0.1', () => console.log('WeHouse phone preview: http://127.0.0.1:4178 (sample data only)'));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
