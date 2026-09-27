import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/nativeOAuthRedirect.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, URL });
const { parseNativeOAuthCallback: parse, NATIVE_OAUTH_REDIRECT: redirect } = exports;

test('native OAuth accepts only its callback origin and extracts the PKCE code', () => {
  assert.equal(redirect, 'com.wehouse.app://auth-callback/');
  const callback = parse(`${redirect}?code=one%2Btwo&verify=password_recovery`);
  assert.equal(callback?.code, 'one+two');
  assert.equal(callback?.context, 'password_recovery');
  assert.equal(callback?.error, '');
  for (const value of [
    'https://wehouse.com.ng/?code=stolen',
    'com.wehouse.app://auth-callback.evil/?code=stolen',
    'com.wehouse.app://auth-callback/other?code=stolen',
    'com.wehouse.app://unexpected/?code=stolen',
    'not a URL',
  ]) assert.equal(parse(value), null);
});

test('native OAuth retains provider errors and ignores unknown verification contexts', () => {
  const callback = parse(`${redirect}?error=access_denied&error_description=Cancelled&verify=other`);
  assert.equal(callback?.code, '');
  assert.equal(callback?.error, 'Cancelled');
  assert.equal(callback?.context, null);
});
