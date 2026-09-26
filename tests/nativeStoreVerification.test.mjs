import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/_shared/native-store.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { verifyStorePurchase } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const environment = new Map([
  ['SUPABASE_URL', 'https://qoobnkedfyosnizrlttt.supabase.co'],
  ['NATIVE_STORE_ENVIRONMENT', 'sandbox'],
  ['APPLE_IAP_KEY_ID', 'test-key'],
  ['APPLE_IAP_ISSUER_ID', 'test-issuer'],
  ['APPLE_BUNDLE_ID', 'ng.com.wehouse.test'],
  ['GOOGLE_PLAY_PACKAGE_NAME', 'ng.com.wehouse.test'],
]);
globalThis.Deno = { env: { get: name => environment.get(name) } };
const account = 'ed933e8e-e58f-4ca1-b13a-122628770594';
const jws = payload => ['eyJhbGciOiJFUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'signature'].join('.');
const response = value => new Response(JSON.stringify(value), { status: 200 });

async function privateKey(algorithm) {
  const pair = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return `-----BEGIN PRIVATE KEY-----\n${der.toString('base64')}\n-----END PRIVATE KEY-----`;
}
environment.set('APPLE_IAP_PRIVATE_KEY', await privateKey({ name: 'ECDSA', namedCurve: 'P-256' }));
environment.set('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', JSON.stringify({
  client_email: 'test@example.invalid', private_key: await privateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }),
}));

test('Apple subscription uses current server status, not the initial transaction alone', async () => {
  const originalFetch = globalThis.fetch;
  const initial = { environment: 'Sandbox', bundleId: 'ng.com.wehouse.test',
    productId: 'com.wehouse.pro.monthly', transactionId: '2000001000000001',
    originalTransactionId: '2000001000000001', appAccountToken: account,
    inAppOwnershipType: 'PURCHASED', type: 'Auto-Renewable Subscription',
    purchaseDate: Date.now() - 86400_000, expiresDate: Date.now() + 86400_000 };
  const latest = { ...initial, transactionId: '2000001000000002', expiresDate: Date.now() - 1000 };
  globalThis.fetch = async url => String(url).includes('/subscriptions/')
    ? response({ data: [{ lastTransactions: [{ status: 2, signedTransactionInfo: jws(latest), signedRenewalInfo: jws({ autoRenewStatus: 0 }) }] }] })
    : response({ signedTransactionInfo: jws(initial) });
  try {
    const verified = await verifyStorePurchase({ platform: 'apple', productId: initial.productId,
      transactionId: initial.transactionId, accountToken: account, productType: 'subscription' });
    assert.equal(verified.active, false);
    assert.equal(verified.autoRenews, false);
    assert.equal(verified.transactionId, latest.transactionId);
    await assert.rejects(verifyStorePurchase({ platform: 'apple', productId: initial.productId,
      transactionId: initial.transactionId, accountToken: 'b4c67260-d843-4d1f-82bf-8fd907e83ff9',
      productType: 'subscription' }), /does not match/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Google one-time purchase binds account and rejects consumed replay unless reconciling', async () => {
  const originalFetch = globalThis.fetch;
  let consumed = false;
  globalThis.fetch = async url => String(url).includes('oauth2.googleapis.com')
    ? response({ access_token: 'test-access-token' })
    : response({ productId: 'com.wehouse.sponsored.7d', purchaseState: 0,
      consumptionState: consumed ? 1 : 0, purchaseType: 0, quantity: 1,
      obfuscatedExternalAccountId: account, orderId: 'GPA.1234-5678-9012-34567',
      purchaseTimeMillis: String(Date.now()) });
  try {
    const input = { platform: 'google', productId: 'com.wehouse.sponsored.7d',
      purchaseToken: 'test-token', accountToken: account, productType: 'consumable' };
    assert.equal((await verifyStorePurchase(input)).active, true);
    consumed = true;
    await assert.rejects(verifyStorePurchase(input), /does not match/);
    assert.equal((await verifyStorePurchase({ ...input, reconciliation: true })).settled, true);
    await assert.rejects(verifyStorePurchase({ ...input, reconciliation: true,
      accountToken: 'b4c67260-d843-4d1f-82bf-8fd907e83ff9' }), /does not match/);
  } finally { globalThis.fetch = originalFetch; }
});

test('store environment cannot be set to production on Test backend', async () => {
  environment.set('NATIVE_STORE_ENVIRONMENT', 'production');
  try {
    await assert.rejects(verifyStorePurchase({ platform: 'apple', productId: 'com.wehouse.pro.monthly',
      transactionId: '2000001000000001', accountToken: account, productType: 'subscription' }), /does not match this WeHouse backend/);
  } finally { environment.set('NATIVE_STORE_ENVIRONMENT', 'sandbox'); }
});
