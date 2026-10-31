import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

// Deliberately fixed to Test. These probes cannot authorize a charge or create a user.
const origin = 'https://qoobnkedfyosnizrlttt.supabase.co';
const key = process.env.WEHOUSE_TEST_PUBLISHABLE_KEY;
assert.ok(key?.startsWith('sb_publishable_'), 'Test publishable key required');
const checks = [];
async function probe(name, path, body, expected) {
  try {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: key, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    const passed = expected(response, data);
    checks.push({ name, status: response.status, passed });
    return data;
  } catch (error) {
    checks.push({ name, passed: false, error: error.name });
    return null;
  }
}
const settings = await probe('Auth settings reachable', '/auth/v1/settings', undefined,
  (response, data) => response.ok && typeof data?.external === 'object');
await probe('Address lookup rejects anonymous coordinates before provider access', '/functions/v1/reverse-geocode', {latitude:8.5,longitude:8.5}, response=>response.status===401);
await probe('Address lookup rejects oversized streamed details', '/functions/v1/reverse-geocode', {latitude:8.5,longitude:8.5,extra:'a'.repeat(3000)}, response=>response.status===413);
await probe('Payment verification rejects anonymous references before provider access', '/functions/v1/paystack-verify', {reference:'WEHOUSE_BOUNDARY_NO_PAYMENT'}, response=>response.status===401);
await probe('Payment verification rejects oversized streamed details', '/functions/v1/paystack-verify', {reference:'WEHOUSE_BOUNDARY_NO_PAYMENT',extra:'a'.repeat(9000)}, response=>response.status===413);
await probe('Anonymous discovery available', '/rest/v1/rpc/search_discoverable_homes', { p_limit: 1 },
  (response, data) => response.ok && Array.isArray(data?.items));
for (const [rpc, body] of [
  ['list_my_friends', {}],
  ['get_my_property_arrival_instructions', { p_kind: 'listing', p_asset_id: 'hosted-boundary-no-asset' }],
]) {
  await probe(`Anonymous ${rpc} denied`, `/rest/v1/rpc/${rpc}`, body,
    (response, data) => [401, 403].includes(response.status) && data?.code === '42501');
}
for (const name of ['payment-init', 'payout-account', 'payout-withdrawal', 'partner-pro-payment-init', 'worker-pro-payment-init']) {
  await probe(`Anonymous ${name} denied`, `/functions/v1/${name}`, {},
    response => [401, 403].includes(response.status));
}
await probe('Device email confirmation requires sign-in', '/functions/v1/email-account-security',
  {action:'start',purpose:'device_confirmation'}, response => response.status===401);
await probe('Recovery never succeeds without a valid code', '/functions/v1/email-account-security',
  {action:'complete',purpose:'password_recovery',challenge_id:'invalid'},
  (response,data) => [400,503].includes(response.status) && data?.success!==true);
const report = {
  measured_at: new Date().toISOString(), project: 'qoobnkedfyosnizrlttt',
  scope: 'Hosted public configuration and anonymous access boundaries only. No signed-in roles, checkout, provider mode, settlement, refunds, email delivery or browser rendering proved.',
  auth: settings ? {
    email_enabled: settings.external?.email === true,
    google_enabled: settings.external?.google === true,
    apple_enabled: settings.external?.apple === true,
    signup_disabled: settings.disable_signup === true,
  } : null,
  checks, passed: checks.every(check => check.passed),
};
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/hosted-test-boundaries.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
