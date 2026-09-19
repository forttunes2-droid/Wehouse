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

function localSql(sql) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_wehouse', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

async function signup(legalReview = {}) {
  const response = await fetch(new URL('/auth/v1/signup', origin), {
    method: 'POST',
    headers: { apikey: publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `legal-gate-${randomBytes(8).toString('hex')}@example.invalid`,
      password: randomBytes(24).toString('base64url'),
      data: { legal_review: legalReview },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  return { status: response.status, hasUser: Boolean(result.id || result.user?.id), message: result.msg || result.message || '' };
}

// Real HTTP reaches the Auth-owned database role; calling only the SQL hook as
// postgres cannot establish that the installed hook has the right permissions.
// These fixtures exist only in disposable CI, never in a hosted project.
assert.equal(localSql("select count(*) from public.creator_policy_versions where policy_key in ('legal_privacy','legal_terms') and status='active';"), '0');
let result = await signup();
assert.equal(result.status, 200, 'Unpublished documents must allow identity creation');
assert.equal(result.hasUser, true);

try {
  localSql(`
    begin;
    set local session_replication_role=replica;
    insert into public.creator_policy_versions(policy_version_id,policy_key,version,value,status,effective_from,public_disclosure,legal_review_state,reason,checksum)
    values('88888888-1111-4111-8111-888888888888','legal_privacy',999002,
      '{"title":"Disposable CI fixture","body":"Synthetic Auth HTTP check, not a legal policy","locale":"en-NG","review_reference":"local-ci"}',
      'active',now()-interval '1 hour',true,'reviewed','Disposable local CI only','http-privacy-checksum');
    commit;
  `);
  result = await signup();
  assert.equal(result.status, 403, 'One published document must reject missing acceptance');
  assert.match(result.message, /review the published legal documents/);
  result = await signup({ privacy: { policy_version_id: '88888888-1111-4111-8111-888888888888', checksum: 'stale' } });
  assert.equal(result.status, 403, 'A stale acceptance must be rejected');
  result = await signup({ privacy: { policy_version_id: '88888888-1111-4111-8111-888888888888', checksum: 'http-privacy-checksum' } });
  assert.equal(result.status, 200, 'Accepting the published document must not require an unpublished second one');
  assert.equal(result.hasUser, true);
} finally {
  localSql("begin; set local session_replication_role=replica; delete from public.creator_policy_versions where policy_version_id='88888888-1111-4111-8111-888888888888'; commit;");
}
console.log('Auth HTTP confirms unpublished signup is allowed and published documents reject missing/stale acceptance.');
