import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/supabase/environment.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, URL, atob });
const { resolveSupabaseEnvironment: resolve, PRODUCTION_SUPABASE_URL: live } = exports;
const testUrl = 'https://qoobnkedfyosnizrlttt.supabase.co';

test('official domains use only the live project and keep the public fallback atomic', () => {
  for (const host of ['wehouse.com.ng', 'www.wehouse.com.ng', 'WWW.WEHOUSE.COM.NG']) {
    assert.equal(resolve(host, live + '/', 'live-public-key').url, live);
    assert.equal(resolve(host, '', '').url, live);
    assert.equal(resolve(host, '', '').isTestEnvironment, false);
    assert.throws(() => resolve(host, testUrl, 'test-public-key'), /live WeHouse website must connect/);
    assert.throws(() => resolve(host, 'http://localhost:54321', 'local-public-key'), /live WeHouse website must connect/);
    assert.throws(() => resolve(host, live, ''), /incomplete/);
    assert.throws(() => resolve(host, '', 'key'), /incomplete/);
  }
});
test('preview, native and lookalike hosts cannot reach the live project', () => {
  for (const host of ['', 'localhost', 'preview.vercel.app', 'wehouse.com.ng.example.org']) {
    for (const url of [live, live + '/', live.toUpperCase(), live + '.', live + ':8443']) {
      assert.throws(() => resolve(host, url, 'public-key'), /non-production WeHouse host cannot connect/);
    }
    assert.throws(() => resolve(host, '', ''), /incomplete/);
    const result = resolve(host, testUrl, 'test-public-key');
    assert.equal(result.url, testUrl);
    assert.equal(result.key, 'test-public-key');
    assert.equal(result.isTestEnvironment, true);
  }
});
test('only an explicit packaged native release can use the live project from localhost', () => {
  assert.throws(() => resolve('localhost', live, 'live-public-key'), /non-production/);
  assert.throws(() => resolve('preview.vercel.app', live, 'live-public-key', true), /non-production/);
  assert.throws(() => resolve('localhost', '', '', true), /explicit Supabase/);
  assert.throws(() => resolve('localhost', testUrl, 'test-public-key', true), /live WeHouse website/);
  const release = resolve('localhost', live, 'live-public-key', true);
  assert.equal(release.url, live);
  assert.equal(release.isTestEnvironment, false);
});
test('client configuration rejects privileged keys on every host', () => {
  const serviceRole = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'), 'signature'].join('.');
  for (const host of ['localhost', 'wehouse.com.ng']) {
    const url = host === 'localhost' ? testUrl : live;
    assert.throws(() => resolve(host, url, 'sb_secret_do-not-bundle'), /privileged Supabase key/);
    assert.throws(() => resolve(host, url, serviceRole), /privileged Supabase key/);
  }
});
test('test origins are normalized and malformed configuration fails closed', () => {
  assert.equal(resolve('localhost', ' http://127.0.0.1:54321/ ', ' key ').url, 'http://127.0.0.1:54321');
  for (const url of ['garbage', 'javascript:alert(1)', 'http://remote.example.org', testUrl + '/path', testUrl + '?project=live', testUrl + '#fragment', 'https://user:password@test.example.org']) {
    assert.throws(() => resolve('preview.vercel.app', url, 'public-key'), /invalid|secure project origin/);
  }
});
test('the client uses the guarded configuration for database and storage', () => {
  const client = readFileSync(new URL('../src/lib/supabase/client.ts', import.meta.url), 'utf8');
  assert.ok(client.includes('resolveSupabaseEnvironment(runtimeHost, configuredUrl, configuredKey, nativeRelease)'));
  assert.ok(client.includes('const SUPABASE_URL = environment.url'));
  assert.ok(client.includes('const SUPABASE_STORAGE_URL = SUPABASE_URL.replace('));
  assert.ok(!client.includes('https://rkrhnkhppeihvmuwvsvn'));
});
