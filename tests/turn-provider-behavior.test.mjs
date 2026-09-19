import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = (await readFile(new URL('../supabase/functions/private-call-ice/index.ts', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function relay(settings = {}, participant = true) {
  let handler;
  const exchanges = [];
  const env = { SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'public-fixture', Cloud_turntokenid: 'legacy-key', Cloud_turnApitoken: 'legacy-server-secret', ...settings };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } }, error: null }) },
    from(table) {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'profiles' ? { user_id: 'user-1' } : { caller_id: participant ? 'user-1' : 'other', callee_id: 'user-2', status: 'accepted' }, error: null }) };
      return q;
    },
  };
  vm.runInNewContext(compiled, { exports: {}, Response, console, corsHeaders: {}, Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } }, createClient: () => client, fetch: async (url, options) => { exchanges.push({ url, options }); return Response.json({ iceServers: [{ urls: ['turn:turn.example.invalid:3478','turn:turn.example.invalid:53'], username: 'temporary-user', credential: 'temporary-credential' }] }); } });
  return { exchanges, request: () => handler(new Request('https://test.invalid/relay', { method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: JSON.stringify({ call_id: '00000000-0000-4000-8000-000000000001' }) })) };
}

test('existing Cloudflare secret names issue only temporary credentials to an active call participant', async () => {
  const ice = relay();
  const response = await ice.request();
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.doesNotMatch(body, /legacy-key|legacy-server-secret/);
  assert.equal(JSON.parse(body).ice_servers[0].urls.length, 1);
  assert.match(ice.exchanges[0].url, /keys\/legacy-key\//);
  assert.equal(ice.exchanges[0].options.headers.Authorization, 'Bearer legacy-server-secret');
  assert.equal(JSON.parse(ice.exchanges[0].options.body).ttl, 3600);
});

test('canonical Cloudflare settings take precedence during credential rotation', async () => {
  const ice = relay({ CLOUDFLARE_TURN_KEY_ID: 'canonical-key', CLOUDFLARE_TURN_API_TOKEN: 'canonical-secret' });
  assert.equal((await ice.request()).status, 200);
  assert.match(ice.exchanges[0].url, /keys\/canonical-key\//);
  assert.equal(ice.exchanges[0].options.headers.Authorization, 'Bearer canonical-secret');
});

test('knowing a call ID does not authorize a Cloudflare credential exchange', async () => {
  const ice = relay({}, false);
  assert.equal((await ice.request()).status, 403);
  assert.equal(ice.exchanges.length, 0);
});
