import { spawnSync } from 'node:child_process';

const [platform, target] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !['test', 'production'].includes(target)) {
  throw new Error('Usage: node scripts/prepare-native.mjs <ios|android> <test|production>');
}

const url = (process.env.VITE_SUPABASE_URL || '').trim();
const key = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
const live = 'https://rkrhnkhppeihvmuwvsvn.supabase.co';
if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for the selected project.');
if (key.startsWith('sb_secret_')) throw new Error('A privileged Supabase key cannot be bundled into WeHouse.');
if (key.startsWith('eyJ')) {
  let role = '';
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role; } catch {}
  if (role === 'service_role' || role === 'supabase_admin') throw new Error('A privileged Supabase key cannot be bundled into WeHouse.');
}
const endpoint = new URL(url);
if (endpoint.protocol !== 'https:' || endpoint.origin !== url.replace(/\/$/, '') || endpoint.pathname !== '/') {
  throw new Error('VITE_SUPABASE_URL must be a secure project origin.');
}
if (target === 'production' && endpoint.origin !== live) throw new Error('A release must use the WeHouse production project.');
if (target === 'test' && endpoint.origin === live) throw new Error('A test package must use an isolated test project.');

const env = { ...process.env, VITE_WEHOUSE_NATIVE_TARGET: target };
for (const [command, args] of [
  ['npm', ['run', 'build']],
  ['npx', ['cap', 'sync', platform]],
]) {
  const result = spawnSync(process.platform === 'win32' ? `${command}.cmd` : command, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
