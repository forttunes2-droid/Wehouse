// Server-to-server store verification. Client transaction fields are selectors,
// never proof of purchase. Only responses fetched from Apple or Google are used.
type Json = Record<string, unknown>;
export type StorePlatform = 'apple' | 'google';
export type VerifiedStorePurchase = {
  platform: StorePlatform;
  environment: 'sandbox' | 'production';
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  accountToken: string;
  purchasedAt: string;
  expiresAt: string | null;
  active: boolean;
  autoRenews: boolean;
  priceAmount: number;
  currency: string;
  purchaseToken: string | null;
  payloadHash: string;
  settled: boolean;
};

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Native store configuration is missing: ${name}`);
  return value;
}
function urlBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function encoded(value: unknown): string {
  return urlBase64(new TextEncoder().encode(JSON.stringify(value)));
}
function fromBase64Url(value: string): Json {
  const bytes = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes, c => c.charCodeAt(0))));
}
function pemBytes(pem: string): Uint8Array {
  const raw = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function signJwt(header: Json, claims: Json, pem: string, alg: 'ES256' | 'RS256'): Promise<string> {
  const input = `${encoded(header)}.${encoded(claims)}`;
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(pem), alg === 'ES256'
    ? { name: 'ECDSA', namedCurve: 'P-256' }
    : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign(alg === 'ES256'
    ? { name: 'ECDSA', hash: 'SHA-256' }
    : { name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(input));
  return `${input}.${urlBase64(new Uint8Array(signature))}`;
}
async function payloadHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
async function appleToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ alg: 'ES256', kid: required('APPLE_IAP_KEY_ID'), typ: 'JWT' }, {
    iss: required('APPLE_IAP_ISSUER_ID'), iat: now, exp: now + 300,
    aud: 'appstoreconnect-v1', bid: required('APPLE_BUNDLE_ID'),
  }, required('APPLE_IAP_PRIVATE_KEY').replace(/\\n/g, '\n'), 'ES256');
}
async function googleToken(): Promise<string> {
  const account = JSON.parse(required('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')) as Json;
  const email = String(account.client_email || '');
  const privateKey = String(account.private_key || '');
  if (!email || !privateKey) throw new Error('Google Play service account is incomplete');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({ alg: 'RS256', typ: 'JWT' }, {
    iss: email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 300,
  }, privateKey, 'RS256');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error('Google Play authorization failed');
  const token = (await response.json()) as Json;
  if (!token.access_token) throw new Error('Google Play authorization returned no token');
  return String(token.access_token);
}
function expectedEnvironment(): 'sandbox' | 'production' {
  const environment = required('NATIVE_STORE_ENVIRONMENT');
  if (environment !== 'sandbox' && environment !== 'production')
    throw new Error('Invalid native store environment');
  const project = required('SUPABASE_URL');
  const isLive = new URL(project).hostname === 'rkrhnkhppeihvmuwvsvn.supabase.co';
  if ((environment === 'production') !== isLive)
    throw new Error('Native store environment does not match this WeHouse backend');
  return environment;
}
export async function verifyStorePurchase(input: {
  platform: StorePlatform;
  productId: string;
  transactionId?: string;
  purchaseToken?: string;
  accountToken: string;
  productType: 'subscription' | 'consumable';
  reconciliation?: boolean;
}): Promise<VerifiedStorePurchase> {
  if (!/^[A-Za-z0-9_.-]{3,180}$/.test(input.productId)
    || !/^[0-9a-f-]{36}$/i.test(input.accountToken)
    || !['apple', 'google'].includes(input.platform)) throw new Error('Invalid store purchase request');
  const target = expectedEnvironment();
  if (input.platform === 'apple') {
    if (!/^[0-9]{8,30}$/.test(input.transactionId || ''))
      throw new Error('Invalid App Store transaction');
    const host = target === 'production' ? 'api.storekit.apple.com' : 'api.storekit-sandbox.apple.com';
    const response = await fetch(`https://${host}/inApps/v1/transactions/${input.transactionId}`, {
      headers: { Authorization: `Bearer ${await appleToken()}` },
    });
    if (!response.ok) throw new Error('App Store could not verify this transaction');
    const result = (await response.json()) as Json;
    let signed = String(result.signedTransactionInfo || '');
    const parts = signed.split('.');
    if (parts.length !== 3 || !signed) throw new Error('App Store returned no signed transaction');
    // The JWS is read only from Apple's authenticated HTTPS response, never
    // from a device or webhook. Apple is the authoritative transaction source.
    let value = fromBase64Url(parts[1]);
    let renewal: Json | null = null;
    let storeStatus = 1;
    if (input.productType === 'subscription') {
      const statusResponse = await fetch(`https://${host}/inApps/v1/subscriptions/${input.transactionId}`, {
        headers: { Authorization: `Bearer ${await appleToken()}` },
      });
      if (!statusResponse.ok) throw new Error('App Store subscription status is unavailable');
      const statusResult = (await statusResponse.json()) as Json;
      const groups = Array.isArray(statusResult.data) ? statusResult.data as Json[] : [];
      const latest = groups.flatMap(group => Array.isArray(group.lastTransactions)
        ? group.lastTransactions as Json[] : []).find(item => {
        const jws = String(item.signedTransactionInfo || '').split('.');
        if (jws.length !== 3) return false;
        const transaction = fromBase64Url(jws[1]);
        return String(transaction.originalTransactionId) === String(value.originalTransactionId)
          && transaction.productId === input.productId;
      });
      if (!latest) throw new Error('App Store subscription is no longer in this plan');
      signed = String(latest.signedTransactionInfo);
      value = fromBase64Url(signed.split('.')[1]);
      storeStatus = Number(latest.status);
      const signedRenewal = String(latest.signedRenewalInfo || '').split('.');
      renewal = signedRenewal.length === 3 ? fromBase64Url(signedRenewal[1]) : null;
    }
    const env = value.environment === 'Production' ? 'production' : value.environment === 'Sandbox' ? 'sandbox' : null;
    if (env !== target || value.bundleId !== required('APPLE_BUNDLE_ID')
      || value.productId !== input.productId
      || (input.productType !== 'subscription' && String(value.transactionId) !== input.transactionId)
      || String(value.appAccountToken || '').toLowerCase() !== input.accountToken.toLowerCase()
      || value.inAppOwnershipType !== 'PURCHASED')
      throw new Error('App Store transaction does not match this WeHouse purchase');
    const isSubscription = value.type === 'Auto-Renewable Subscription';
    if (isSubscription !== (input.productType === 'subscription'))
      throw new Error('App Store product type mismatch');
    const expiry = isSubscription && Number(value.expiresDate) ? new Date(Number(value.expiresDate)).toISOString() : null;
    return {
      platform: 'apple', environment: env, productId: input.productId,
      transactionId: String(value.transactionId),
      originalTransactionId: String(value.originalTransactionId || value.transactionId),
      accountToken: input.accountToken, purchasedAt: new Date(Number(value.purchaseDate)).toISOString(),
      expiresAt: expiry, active: !value.revocationDate && (!isSubscription || [1, 4].includes(storeStatus))
        && (!expiry || Date.parse(expiry) > Date.now()),
      autoRenews: isSubscription && renewal?.autoRenewStatus === 1,
      priceAmount: Number(value.price || 0) / 1000,
      currency: String(value.currency || 'NGN'), purchaseToken: null,
      payloadHash: await payloadHash(signed + (renewal ? JSON.stringify(renewal) : '')),
      settled: false,
    };
  }
  const token = String(input.purchaseToken || '');
  if (!token || token.length > 2048) throw new Error('Invalid Google Play purchase token');
  const packageName = required('GOOGLE_PLAY_PACKAGE_NAME');
  const prefix = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases`;
  const path = input.productType === 'subscription'
    ? `/subscriptionsv2/tokens/${encodeURIComponent(token)}`
    : `/products/${encodeURIComponent(input.productId)}/tokens/${encodeURIComponent(token)}`;
  const response = await fetch(prefix + path, { headers: { Authorization: `Bearer ${await googleToken()}` } });
  if (!response.ok) throw new Error('Google Play could not verify this purchase');
  const value = (await response.json()) as Json;
  const sandbox = input.productType === 'subscription' ? Boolean(value.testPurchase) : value.purchaseType === 0;
  const environment = sandbox ? 'sandbox' : 'production';
  if (environment !== target) throw new Error('Google Play purchase environment mismatch');
  if (input.productType === 'subscription') {
    const lines = Array.isArray(value.lineItems) ? value.lineItems as Json[] : [];
    const line = lines.find(item => item.productId === input.productId);
    const account = value.externalAccountIdentifiers as Json | undefined;
    if (!line || String(account?.obfuscatedExternalAccountId || '').toLowerCase() !== input.accountToken.toLowerCase())
      throw new Error('Google Play subscription does not belong to this account');
    const expiry = String(line.expiryTime || '');
    const state = String(value.subscriptionState || '');
    const plan = line.autoRenewingPlan as Json | undefined;
    const price = plan?.recurringPrice as Json | undefined;
    const amount = Number(price?.units || 0) + Number(price?.nanos || 0) / 1e9;
    return {
      platform: 'google', environment, productId: input.productId,
      transactionId: String(line.latestSuccessfulOrderId || value.latestOrderId || ''),
      originalTransactionId: token, accountToken: input.accountToken,
      purchasedAt: String(value.startTime || ''), expiresAt: expiry,
      active: ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED'].includes(state)
        && Date.parse(expiry) > Date.now(),
      autoRenews: Boolean(plan?.autoRenewEnabled), priceAmount: amount,
      currency: String(price?.currencyCode || 'NGN'), purchaseToken: token,
      payloadHash: await payloadHash(JSON.stringify(value)),
      settled: value.acknowledgementState === 1,
    };
  }
  if (value.productId !== input.productId
    || String(value.obfuscatedExternalAccountId || '').toLowerCase() !== input.accountToken.toLowerCase()
    || (!input.reconciliation && (value.purchaseState !== 0 || value.consumptionState !== 0))
    || Number(value.quantity || 1) !== 1)
    throw new Error('Google Play purchase does not match this account or product');
  return {
    platform: 'google', environment, productId: input.productId,
    transactionId: String(value.orderId || ''), originalTransactionId: token,
    accountToken: input.accountToken, purchasedAt: new Date(Number(value.purchaseTimeMillis)).toISOString(),
    expiresAt: null, active: value.purchaseState === 0, autoRenews: false, priceAmount: 0, currency: 'NGN',
    purchaseToken: token, payloadHash: await payloadHash(JSON.stringify(value)),
    settled: value.consumptionState === 1,
  };
}

export async function settleGoogleStorePurchase(purchase: VerifiedStorePurchase, productType: 'subscription' | 'consumable'): Promise<void> {
  if (purchase.platform !== 'google' || !purchase.purchaseToken || purchase.settled) return;
  const packageName = required('GOOGLE_PLAY_PACKAGE_NAME');
  const prefix = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases`;
  const path = productType === 'subscription'
    ? `/subscriptions/${encodeURIComponent(purchase.productId)}/tokens/${encodeURIComponent(purchase.purchaseToken)}:acknowledge`
    : `/products/${encodeURIComponent(purchase.productId)}/tokens/${encodeURIComponent(purchase.purchaseToken)}:consume`;
  const response = await fetch(prefix + path, {
    method: 'POST', headers: { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok && response.status !== 409) throw new Error('Google Play purchase settlement failed');
}
