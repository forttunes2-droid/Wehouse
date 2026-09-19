import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Paystack webhook verifies provider HMAC before service authority', async () => {
  const source = await read('supabase/functions/paystack-webhook/index.ts');
  const signatureCheck = source.indexOf('x-paystack-signature');
  const serviceClient = source.indexOf('createClient(url, serviceKey');
  assert.ok(signatureCheck >= 0 && serviceClient > signatureCheck);
  assert.match(source, /HMAC[\s\S]*SHA-512/);
  assert.match(source, /safeEqual\(expectedSignature, signature\.toLowerCase\(\)\)/);
});

test('finance processor requires the private cron secret before service authority', async () => {
  const source = await read('supabase/functions/financial-action-processor/index.ts');
  const auth = source.indexOf("x-wehouse-cron-secret");
  const serviceClient = source.indexOf('createClient(url,serviceKey');
  assert.ok(auth >= 0 && serviceClient > auth);
  assert.match(source, /WEHOUSE_CRON_SECRET/);
  assert.match(source, /sameSecret\(supplied,expected\)/);
});

test('hotel PMS gateway requires an active hashed integration token and idempotency for mutations', async () => {
  const source = await read('supabase/functions/hotel-pms-api/index.ts');
  assert.match(source, /whpms_live_/);
  assert.match(source, /tokenHash = await sha256\(token\)/);
  assert.match(source, /\.eq\("token_hash", tokenHash\)/);
  assert.match(source, /\.eq\("status", "active"\)/);
  assert.match(source, /Idempotency-Key must contain 1 to 200 characters/);
  assert.match(source, /integration\.hotel_id/);
});

test('public username login is throttled before privileged identity lookup', async () => {
  const source = await read('supabase/functions/login-with-identifier/index.ts');
  const throttle = source.indexOf('consume_public_password_login_attempt_from_service');
  const usernameLookup = source.indexOf('.from("profiles")');
  assert.ok(throttle >= 0 && usernameLookup > throttle);
  assert.match(source, /Too many sign-in attempts/);
  assert.match(source, /Invalid username, email or password/);
});

test('retired external identity webhook has no mutation authority', async () => {
  const source = await read('supabase/functions/youverify-webhook/index.ts');
  assert.match(source, /status:\s*410/);
  assert.match(source, /retired:\s*true/);
  assert.doesNotMatch(source, /createClient/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
});
