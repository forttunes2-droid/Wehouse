import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/legalConsent.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
const { hasLegalConsent } = exports;
const documents = {
  privacy: { policy_version_id: 'privacy-1', checksum: 'text-a', body: 'Privacy fixture' },
  terms: { policy_version_id: 'terms-1', checksum: 'text-b', body: 'Terms fixture' },
};
const choices = {
  privacy: { policy_version_id: 'privacy-1', checksum: 'text-a' },
  terms: { policy_version_id: 'terms-1', checksum: 'text-b' },
};

test('signup needs both published documents and both explicit confirmations', () => {
  assert.equal(hasLegalConsent({ privacy: null, terms: null }, {}), false);
  assert.equal(hasLegalConsent({ ...documents, terms: null }, choices), false);
  assert.equal(hasLegalConsent(documents, {}), false);
  assert.equal(hasLegalConsent(documents, { privacy: choices.privacy }), false);
  assert.equal(hasLegalConsent(documents, choices), true);
});
test('new version or changed text invalidates a previous confirmation', () => {
  assert.equal(hasLegalConsent({ ...documents, privacy: { ...documents.privacy, policy_version_id: 'privacy-2' } }, choices), false);
  assert.equal(hasLegalConsent({ ...documents, terms: { ...documents.terms, checksum: 'new-text' } }, choices), false);
  assert.equal(hasLegalConsent({ ...documents, terms: { ...documents.terms, body: '   ' } }, choices), false);
});

// Exercise the actual auth helper. No credential, email, or provider network
// request is made; the boundary is replaced with a synthetic in-memory client.
const authSource = await readFile(new URL('../src/lib/supabase/auth.ts', import.meta.url), 'utf8');
const authCode = ts.transpileModule(authSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function signupHarness(currentDocuments = documents, readError = null) {
  const calls = [];
  const authExports = {};
  vm.runInNewContext(authCode, { exports: authExports, window: { location: { origin: 'https://test.invalid' } }, require(name) {
    if (name === './client') return { supabase: { auth: { signUp: async input => { calls.push(input); return { data: { user: { id: 'synthetic' } }, error: null }; } } } };
    if (name === './legal') return { getCurrentLegalDocuments: async () => ({ documents: currentDocuments, error: readError }) };
    if (name === '@/lib/legalConsent') return exports;
    return {};
  } });
  return { calls, signUp: authExports.signUpWithEmail };
}
test('auth helper rejects missing, stale or unavailable legal review before creating an identity', async () => {
  for (const [docs, review, error] of [[documents, {}, null], [{ ...documents, terms: null }, choices, null], [documents, choices, new Error('offline')]]) {
    const h = signupHarness(docs, error);
    assert.ok((await h.signUp('person@example.invalid', 'synthetic-fixture', 'user', review)).error);
    assert.equal(h.calls.length, 0);
  }
});
test('reviewed signup submits document versions without granting a requested privileged role', async () => {
  const h = signupHarness();
  assert.equal((await h.signUp('person@example.invalid', 'synthetic-fixture', 'creator', choices)).error, null);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].options.data.legal_review, choices);
  assert.equal(h.calls[0].options.data.role, undefined);
  assert.equal(h.calls[0].options.data.signup_role, undefined);
});
