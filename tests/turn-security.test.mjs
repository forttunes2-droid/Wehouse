import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('legacy TURN endpoint is retired and cannot mint relay credentials', async () => {
  const legacy = await read('supabase/functions/turn-credentials/index.ts');
  assert.match(legacy, /status:\s*410/);
  assert.match(legacy, /private-call-ice/);
  assert.doesNotMatch(legacy, /TURN_SHARED_SECRET/);
  assert.doesNotMatch(legacy, /crypto\.subtle\.sign/);
});

test('TURN credentials are bound to one authenticated active call participant', async () => {
  const [edge, client, config] = await Promise.all([
    read('supabase/functions/private-call-ice/index.ts'),
    read('src/lib/private-calls.ts'),
    read('supabase/config.toml'),
  ]);
  assert.match(edge, /SUPABASE_ANON_KEY/);
  assert.match(edge, /client\.auth\.getUser\(token\)/);
  assert.doesNotMatch(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /\.from\("private_calls"\)/);
  assert.match(edge, /\[call\.caller_id, call\.callee_id\]\.includes\(profile\.user_id\)/);
  assert.match(edge, /\["ringing", "accepted"\]\.includes\(call\.status\)/);
  assert.match(edge, /CLOUDFLARE_TURN_KEY_ID/);
  assert.match(edge, /CLOUDFLARE_TURN_API_TOKEN/);
  assert.match(edge, /rtc\.live\.cloudflare\.com\/v1\/turn\/keys/);
  assert.match(edge, /generate-ice-servers/);
  assert.match(edge, /ttlSeconds = 60 \* 60/);
  assert.match(edge, /customIdentifier/);
  assert.doesNotMatch(edge, /TURN_SHARED_SECRET/);
  assert.match(client, /functions\.invoke\('private-call-ice'/);
  assert.doesNotMatch(client, /turn-credentials/);
  assert.match(config, /\[functions\.private-call-ice\][\s\S]*verify_jwt = true/);
  assert.match(config, /\[functions\.turn-credentials\][\s\S]*verify_jwt = true/);
});
