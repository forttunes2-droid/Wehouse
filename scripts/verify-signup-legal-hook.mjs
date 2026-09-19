import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// This script is only for the disposable local Supabase used by CI. Capture
// status privately: never print its keys or feed production settings to it.
const status = JSON.parse(execFileSync('npx', ['--yes', 'supabase@2.114.0', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const origin = new URL(status.API_URL || status.api_url);
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'This check requires local Supabase');
const publishableKey = status.PUBLISHABLE_KEY || status.ANON_KEY || status.publishable_key || status.anon_key;
assert.ok(publishableKey, 'Local Supabase public key is missing');

const response = await fetch(new URL('/auth/v1/signup', origin), {
  method: 'POST',
  headers: { apikey: publishableKey, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'legal-gate-probe@example.invalid', password: randomBytes(24).toString('base64url') }),
  signal: AbortSignal.timeout(20000),
});
const result = await response.json();
assert.equal(response.status, 403, 'Auth must refuse signup without published documents');
assert.match(result.msg || result.message || '', /Registration is unavailable until the Privacy Policy and Terms of Service are published/);
console.log('Auth HTTP confirms the legal hook runs and rejects unreviewed registration.');
