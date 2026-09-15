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
  assert.match(edge, /admin\.auth\.getUser\(token\)/);
  assert.match(edge, /\[call\.caller_id, call\.callee_id\]\.includes\(profile\.user_id\)/);
  assert.match(edge, /\["ringing", "accepted"\]\.includes\(call\.status\)/);
  assert.match(edge, /TURN_URLS/);
  assert.match(edge, /TURN_SHARED_SECRET/);
  assert.match(edge, /profile\.user_id.*callId/);
  assert.match(client, /functions\.invoke\('private-call-ice'/);
  assert.doesNotMatch(client, /turn-credentials/);
  assert.match(config, /\[functions\.private-call-ice\][\s\S]*verify_jwt = true/);
  assert.match(config, /\[functions\.turn-credentials\][\s\S]*verify_jwt = true/);
});
