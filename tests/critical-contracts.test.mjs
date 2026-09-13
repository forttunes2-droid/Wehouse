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
  assert.match(source,/get_my_booking_conversations_v3/);
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
  for(const label of ['Explore','Bookings','Inbox'])assert.match(userBlock,new RegExp(`label: '${label}'|label: \\"${label}\\"`));
  assert.match(userBlock,/account\(\)/,'Account must remain the fourth personal destination');
  assert.match(nav,/label: 'Account'/);
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

test('Production-recorded prerequisites stay in migration history',()=>{
  const supportPrerequisite='supabase/migrations/20260904183557_support_case_lifecycle_and_review_rls.sql';
  assert.equal(fs.existsSync(path.join(root,supportPrerequisite)),true,`${supportPrerequisite} is missing`);
  assert.match(read(supportPrerequisite),/create table if not exists public\.support_case_events/);
  assert.ok(
    path.basename(supportPrerequisite).localeCompare('20260909104005_make_wehouse_requests_operational.sql')<0,
    'support_case_events must exist before later operational support migrations alter it',
  );

  const locationPrerequisite='supabase/migrations/20260910053045_complete_gallery_location_activity_booking_payout_contract.sql';
  assert.equal(fs.existsSync(path.join(root,locationPrerequisite)),true,`${locationPrerequisite} is missing`);
  assert.match(read(locationPrerequisite),/get_discoverable_homes/);
  assert.ok(
    path.basename(locationPrerequisite).localeCompare('20260910065000_remove_legacy_location_rpc_access.sql')<0,
    'legacy location RPC must exist before its access is revoked',
  );
});

test('Validation workflow runs regression tests before build',()=>{
  const workflow=read('.github/workflows/consolidation-validation.yml');
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npx tsc --noEmit/);
  assert.match(workflow,/npm run build/);
  assert.match(workflow,/supabase@2\.114\.0 db reset --local/);
  assert.match(workflow,/Reject duplicate migration versions/);
});

test('Accommodation arrival issues preserve the agreed money window',()=>{
  const migration=read('supabase/migrations/20260913154000_accommodation_arrival_issue_and_release_window.sql');
  const client=read('src/lib/supabase/accommodation-protection.ts');
  const bookings=read('src/pages/MyReservations.tsx');
  assert.match(migration,/default 2/i);
  assert.match(migration,/between 2 and 4/);
  assert.match(migration,/arrival_issue_deadline_at/);
  assert.match(migration,/report_my_accommodation_arrival_issue/);
  assert.match(migration,/protection_state.*disputed/s);
  assert.match(migration,/financial_action_outbox/);
  assert.match(client,/report_my_accommodation_arrival_issue/);
  assert.match(bookings,/Report arrival issue/);
  assert.match(bookings,/different from an ordinary WeHouse message/);
});

test('Short Let caution never awards the Partner from silence',()=>{
  const migration=[
    read('supabase/migrations/20260913031702_canonical_product_lifecycles_v2.sql'),
    read('supabase/migrations/20260913054450_shared_short_let_caution_distribution.sql'),
  ].join('\n');
  const bookings=read('src/pages/MyReservations.tsx');
  assert.match(migration,/24 hours/i);
  assert.match(migration,/48 hours/i);
  assert.match(migration,/silence/i);
  assert.match(bookings,/Silence\s+never awards the fee to the Partner/);
});

test('PMS mode is named, certified and fail-closed',()=>{
  const migration=read('supabase/migrations/20260913152000_certified_hotel_pms_foundation.sql');
  const launch=read('docs/HOTEL_PMS_CERTIFICATION_AND_LAUNCH.md');
  assert.match(migration,/hotel_pms_providers/);
  assert.match(migration,/pending_certification/);
  assert.match(migration,/The named PMS adapter is not certified/);
  assert.match(migration,/hotel_pms_connected_mode/);
  assert.match(launch,/There are no certified PMS providers/);
  assert.match(launch,/Manual WeHouse hotel operations are the supported default/);
});

test('Hotel completion scheduling declares its pg_cron dependency',()=>{
  const migration=read('supabase/migrations/20260912095000_hotel_capabilities_completion_turnover.sql');
  assert.match(migration,/create extension if not exists pg_cron with schema pg_catalog/);
  assert.match(migration,/cron\.schedule\('wehouse-hotel-completion-v1'/);
});

test('Worker onboarding stays free and Pro stays an optional entitlement',()=>{
  const foundation=read('supabase/migrations/20260913113221_free_worker_and_wehouse_pro_foundation.sql');
  const billing=read('supabase/migrations/20260913114644_worker_pro_web_billing.sql');
  const workers=read('src/lib/supabase/workers.ts');
  const exports=read('src/lib/supabase/index.ts');
  const badge=read('src/components/WorkerProBadge.tsx');
  const creator=read('src/pages/CreatorSettingsTabV2.tsx');

  assert.match(foundation,/\('worker_verification_fee_enabled','false'/);
  assert.match(foundation,/\('worker_pro_sales_enabled','false'/);
  assert.match(foundation,/revoke all on function public\.create_worker_verification_payment\(\) from public,anon,authenticated/);
  assert.match(foundation,/revoke insert,update,delete on table public\.blue_badge_subscriptions from anon,authenticated/);
  assert.match(billing,/worker_pro_monthly_price_ngn/);
  assert.match(billing,/worker_pro_web_paystack_plan_code/);
  assert.match(creator,/creator_set_worker_pro_setting/);
  assert.match(creator,/worker-pro-plan-sync/);
  assert.match(badge,/>PRO</);
  assert.doesNotMatch(badge,/Reviewed|Trusted/,'Pro must not be presented as a trust or safety decision');
  assert.doesNotMatch(workers,/export async function createBlueBadgeSubscription/);
  assert.doesNotMatch(workers,/export async function cancelBlueBadgeSubscription/);
  assert.doesNotMatch(exports,/createBlueBadgeSubscription|cancelBlueBadgeSubscription/);
});
