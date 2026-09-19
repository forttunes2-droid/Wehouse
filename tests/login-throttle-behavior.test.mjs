import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual HTTP handler. Only the external SDK/database boundary is
// replaced; requests, hashing, responses and handler control flow are real.
async function loginHarness() {
  const source = await readFile(new URL('../supabase/functions/login-with-identifier/index.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const attempts = new Map();
  let handler;
  let lookups = 0;
  const admin = {
    async rpc(name, { p_fingerprint_hash: key }) {
      assert.equal(name, 'consume_public_password_login_attempt_from_service');
      const count = (attempts.get(key) || 0) + 1;
      attempts.set(key, count);
      return { data: { allowed: count <= 12, retry_after_seconds: 900 }, error: null };
    },
    from() {
      lookups++;
      const query = { select: () => query, ilike: () => query, or: () => query,
        maybeSingle: async () => ({ data: null, error: null }) };
      return query;
    },
  };
  vm.runInNewContext(code, {
    Deno: { env: { get: () => 'test-only' }, serve: (fn) => { handler = fn; } },
    createClient: () => admin, corsHeaders: {}, crypto: webcrypto,
    TextEncoder, Response, console,
  });
  return { request: (headers) => handler(new Request('https://test.invalid/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ identifier: 'not_a_real_user', password: 'invalid-password' }),
  })), lookups: () => lookups };
}

test('rotating User-Agent cannot reset the public login throttle', async () => {
  const login = await loginHarness();
  for (let i = 0; i < 12; i++) {
    const response = await login.request({ 'x-forwarded-for': '192.0.2.1', 'user-agent': `browser-${i}` });
    assert.equal(response.status, 400);
  }
  const blocked = await login.request({ 'x-forwarded-for': '192.0.2.1', 'user-agent': 'one-more-browser' });
  assert.equal(blocked.status, 429);
  assert.equal(login.lookups(), 12, 'blocked requests must not reach privileged profile lookup');
  assert.equal((await login.request({ 'x-forwarded-for': '192.0.2.2', 'user-agent': 'other-network' })).status, 400);
});

test('missing network headers use one fail-closed bucket despite User-Agent changes', async () => {
  const login = await loginHarness();
  for (let i = 0; i < 12; i++) await login.request({ 'user-agent': `browser-${i}` });
  assert.equal((await login.request({ 'user-agent': 'rotated' })).status, 429);
});
