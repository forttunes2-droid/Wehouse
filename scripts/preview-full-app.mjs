import http from 'node:http';
import fs from 'node:fs';
import { createServer } from 'vite';

// Explicit public Test configuration; never inherit a production project override.
process.env.VITE_SUPABASE_URL = 'https://qoobnkedfyosnizrlttt.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Rv3lT3wV3AVqWIlxM3Dygw_E3q_aSlV';
process.env.VITE_WEHOUSE_NATIVE_TARGET = 'test';
const app = await createServer({ server: { host: '127.0.0.1', port: 5180, strictPort: true } });
await app.listen();
const frame = http.createServer((req, res) => {
  if (req.url !== '/') { res.writeHead(404); res.end('Not found'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(fs.readFileSync(new URL('./full-app-phone.html', import.meta.url)));
});
frame.on('error', async error => { console.error(error.message); await app.close(); process.exitCode = 1; });
frame.listen(4179, '127.0.0.1', () => console.log('Full WeHouse Test app: http://127.0.0.1:4179 | Direct: http://127.0.0.1:5180'));
async function close() { frame.close(); await app.close(); }
process.once('SIGINT', close);
process.once('SIGTERM', close);
