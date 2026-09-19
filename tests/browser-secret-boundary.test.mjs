import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

async function filesUnder(root) {
  const output = [];
  for (const name of await readdir(root)) {
    const full = path.join(root, name);
    const info = await stat(full);
    if (info.isDirectory()) output.push(...await filesUnder(full));
    else if (/\.(?:ts|tsx|js|jsx|html|json)$/.test(name)) output.push(full);
  }
  return output;
}

test('browser bundle source never contains privileged server secret material', async () => {
  const browserFiles = [
    ...await filesUnder(new URL('../src', import.meta.url).pathname),
    new URL('../index.html', import.meta.url).pathname,
    new URL('../vercel.json', import.meta.url).pathname,
  ];
  const forbiddenNames = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'PAYSTACK_SECRET_KEY',
    'TURN_SHARED_SECRET',
    'WEHOUSE_CRON_SECRET',
    'CREATOR_BOOTSTRAP_SECRET',
  ];
  const secretValuePatterns = [
    /\bsk_live_[A-Za-z0-9_-]{12,}\b/,
    /\bsk_test_[A-Za-z0-9_-]{12,}\b/,
    /\bsb_secret_[A-Za-z0-9_-]{12,}\b/,
  ];

  for (const file of browserFiles) {
    const source = await readFile(file, 'utf8');
    for (const secretName of forbiddenNames) {
      assert.equal(source.includes(secretName), false, `${secretName} leaked into browser source: ${file}`);
    }
    for (const pattern of secretValuePatterns) {
      assert.equal(pattern.test(source), false, `Privileged secret-shaped value leaked into browser source: ${file}`);
    }
  }
});
