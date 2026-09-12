import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd();
const read=(relative)=>fs.readFileSync(path.join(root,relative),'utf8');

async function loadTsModule(relative){
  const source=read(relative);
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('Worker job status and Payment Protection remain separate contracts',async()=>{
  const contract=await loadTsModule('src/lib/workerBookingContract.ts');
  assert.equal(contract.WORKER_JOB_STATUSES.includes('payment_protected'),false,'Payment Protection must not become a job status');
  for(const status of contract.WORKER_JOB_STATUSES)assert.ok(contract.BOOKING_STATUS_LABELS[status],`missing label for ${status}`);
  const legacy=contract.normalizeWorkerBookingRow({status:'payment_protected',payment_protected:true});
  assert.equal(legacy.status,'confirmed');
  assert.equal(legacy.booking_status,'confirmed');
  assert.equal(legacy.money_state,'protected');
  assert.equal(legacy.payment_status,'payment_protected');
  assert.equal(contract.workerNextAction('confirmed','protected','worker'),'Start job');
  assert.equal(contract.workerNextAction('confirmed','protected','customer'),'Waiting for Worker to start');
  for(const terminal of ['approved_released','cancelled','refunded']){
    assert.equal(contract.workerNextAction(terminal,'released','customer'),null);
    assert.equal(contract.workerNextAction(terminal,'released','worker'),null);
  }
});

test('Worker booking reads normalize the canonical contract',()=>{
  const source=read('src/lib/supabase/worker-bookings.ts');
  assert.match(source,/normalizeWorkerBookingRow/);
  assert.match(source,/get_my_booking_conversations_v2/);
  assert.match(source,/get_my_worker_booking_details/);
  assert.doesNotMatch(source,/payment_protected\s*:\s*\{label/,'payment_protected must not be a canonical job label');
});

test('Payout account mutation is idempotent and reconcilable',()=>{
  const client=read('src/components/PayoutAccountManager.tsx');
  const edge=read('supabase/functions/payout-account/index.ts');
  const migration=read('supabase/migrations/20260912190000_reconcile_payout_account_changes.sql');
  assert.doesNotMatch(client,/Promise\.race\s*\(/,'uncancelled mutation must not be raced against a client failure timeout');
  assert.match(client,/request_id/);
  assert.match(client,/get_change_status/);
  assert.match(client,/sessionStorage/);
  assert.match(edge,/payout_account_change_requests/);
  assert.match(edge,/get_change_status/);
  assert.match(edge,/set_default_payout_account_for_user/);
  assert.match(edge,/Read-before-retry/);
  assert.match(migration,/request_id uuid primary key/);
  assert.match(migration,/status in \('processing','uncertain','succeeded','failed'\)/);
  assert.match(migration,/is_default = \(id = p_account_id\)/);
  assert.match(migration,/revoke all on table public\.payout_account_change_requests from anon, authenticated/);
});

test('Personal navigation remains the locked four destinations',()=>{
  const nav=read('src/lib/nav2.tsx');
  const userBlock=nav.slice(nav.indexOf('export function getUserNav'),nav.indexOf('export function getNavForRole'));
  for(const label of ['Explore','Bookings','Inbox','Account'])assert.match(userBlock,new RegExp(`label: '${label}'|label: \\"${label}\\"`));
  assert.doesNotMatch(userBlock,/label: ['"]Saved['"]/);
  assert.doesNotMatch(userBlock,/label: ['"]Activity['"]/);
});

test('PR71 safety migrations stay present',()=>{
  const required=[
    'supabase/migrations/20260912000100_lock_public_hotel_projection_and_seed_stay_threads.sql',
    'supabase/migrations/20260912001000_harden_hotel_internal_access_and_team_chat.sql',
    'supabase/migrations/20260912001100_minimize_hotel_conversation_payload.sql',
    'supabase/migrations/20260912001200_enforce_blocks_on_private_messages.sql',
    'supabase/migrations/20260912001300_separate_short_let_publication_from_date_occupancy.sql',
    'supabase/migrations/20260912001400_decouple_short_let_checkout_from_property_status.sql',
    'supabase/migrations/20260912001500_harden_short_let_operations_read_model.sql',
  ];
  for(const file of required)assert.equal(fs.existsSync(path.join(root,file)),true,`${file} is missing`);
  assert.match(read(required[2]),/booking_code/i,'hotel conversation payload hardening must keep the booking-code regression guard');
  assert.match(read(required[3]),/block/i,'private-message block enforcement must remain in migration history');
  assert.match(read(required[4]),/short_let/i,'Short Let date-scoped availability hardening must remain in migration history');
});

test('Validation workflow runs regression tests before build',()=>{
  const workflow=read('.github/workflows/consolidation-validation.yml');
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npx tsc --noEmit/);
  assert.match(workflow,/npm run build/);
});
