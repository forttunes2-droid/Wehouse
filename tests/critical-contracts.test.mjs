import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root=process.cwd();
function resolveContractFile(relative){
  const active=path.join(root,relative);
  if(!relative.startsWith('supabase/migrations/'))return active;
  const archived=path.join(root,relative.replace('supabase/migrations/','supabase/migrations_legacy/'));
  if(!fs.existsSync(archived))return active;
  if(!fs.existsSync(active))return archived;
  const activeSource=fs.readFileSync(active,'utf8');
  return activeSource.startsWith('-- Historical production migration;')?archived:active;
}
const read=(relative)=>fs.readFileSync(resolveContractFile(relative),'utf8');
const exists=(relative)=>fs.existsSync(resolveContractFile(relative));

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
  assert.match(source,/get_my_workspace_inbox/);
  assert.match(source,/get_my_worker_booking_details/);
  assert.doesNotMatch(source,/payment_protected\s*:\s*\{label/,'payment_protected must not be a canonical job label');
});

test('Payout account mutation is idempotent and reconcilable',()=>{
  const client=read('src/components/PayoutAccountManager.tsx');
  const edge=read('supabase/functions/payout-account/index.ts');
  const migration=read('supabase/migrations/20260912190000_reconcile_payout_account_changes.sql');
  const security=read('supabase/migrations/20260913031716_security_and_payout_account_controls.sql');
  const statuses=read('supabase/migrations/20260913157000_reconcile_payout_change_request_statuses.sql');
  assert.doesNotMatch(client,/Promise\.race\s*\(/,'uncancelled mutation must not be raced against a client failure timeout');
  assert.match(client,/request_id/);
  assert.match(client,/get_change_status/);
  assert.match(client,/sessionStorage/);
  assert.match(edge,/payout_account_change_requests/);
  assert.match(edge,/get_change_status/);
  assert.match(edge,/set_default_payout_account_for_user/);
  assert.match(edge,/Read-before-retry/);
  assert.match(edge,/PAYOUT_REPLACEMENT_STEP_UP_REQUIRED/);
  assert.match(edge,/idempotency_key:requestId/);
  assert.match(edge,/replacement:false/);
  assert.match(migration,/request_id uuid primary key/);
  assert.match(migration,/status in \('processing','uncertain','succeeded','failed'\)/);
  assert.match(migration,/is_default = \(id = p_account_id\)/);
  assert.match(migration,/revoke all on table public\.payout_account_change_requests from anon, authenticated/);
  assert.match(security,/add column if not exists idempotency_key/);
  assert.match(security,/payout_account_change_requests_replacement_step_up_check/);
  assert.match(statuses,/'succeeded'/);
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
  for(const file of required)assert.equal(exists(file),true,`${file} is missing`);
  assert.match(read(required[2]),/booking_code/i,'hotel conversation payload hardening must keep the booking-code regression guard');
  assert.match(read(required[3]),/block/i,'private-message block enforcement must remain in migration history');
  assert.match(read(required[4]),/short_let/i,'Short Let date-scoped availability hardening must remain in migration history');
});

test('Production-recorded prerequisites stay in migration history',()=>{
  const supportPrerequisite='supabase/migrations/20260904183557_support_case_lifecycle_and_review_rls.sql';
  assert.equal(exists(supportPrerequisite),true,`${supportPrerequisite} is missing`);
  assert.match(read(supportPrerequisite),/create table if not exists public\.support_case_events/);
  assert.ok(
    path.basename(supportPrerequisite).localeCompare('20260909104005_make_wehouse_requests_operational.sql')<0,
    'support_case_events must exist before later operational support migrations alter it',
  );

  const locationPrerequisite='supabase/migrations/20260910053045_complete_gallery_location_activity_booking_payout_contract.sql';
  assert.equal(exists(locationPrerequisite),true,`${locationPrerequisite} is missing`);
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

test('Internal lifecycle transition helper closes the execution review queue',()=>{
  const preflight=read('supabase/migrations/20260913051251_close_invoker_registry_and_projection_rls.sql');
  const migration=read('supabase/migrations/20260913055204_close_internal_transition_registry_drift.sql');
  assert.match(preflight,/record_my_user_activity/);
  assert.match(preflight,/revoke all on function public\.canonical_product_transition_allowed\(text,text,text\)/);
  assert.match(preflight,/revoke all on function public\.hotel_allowed_capabilities\(\)/);
  assert.match(preflight,/where authenticated_allowed and review_state='requires_review'/);
  assert.match(migration,/revoke all on function public\.canonical_product_transition_allowed\(text,text,text\)/);
  assert.match(migration,/from public,anon,authenticated,service_role/);
  assert.match(migration,/public_allowed=false/);
  assert.match(migration,/service_role_allowed=false/);
  assert.match(migration,/function_signature='hotel_allowed_capabilities\(\)'/);
  assert.match(migration,/review_state='approved_policy_helper'/);
  assert.match(migration,/where review_state='requires_review'/);
  assert.match(migration,/Function execution review queue is not closed: %/);
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
  const foundation=read('supabase/migrations/20260912100500_hotel_pms_connector_foundation.sql');
  const recoveredFoundation=read('supabase/migrations/20260913031731_hotel_pms_connector_foundation.sql');
  const migration=read('supabase/migrations/20260913152000_certified_hotel_pms_foundation.sql');
  const queueMigration=read('supabase/migrations/20260912101500_queue_connected_hotel_reservations.sql');
  const api=read('supabase/functions/hotel-pms-api/index.ts');
  const launch=read('docs/HOTEL_PMS_CERTIFICATION_AND_LAUNCH.md');
  assert.match(foundation,/integration_id uuid primary key/);
  assert.match(foundation,/integration_event_id uuid primary key/);
  assert.match(foundation,/connection_name text not null/);
  assert.match(foundation,/owner_set_hotel_integration_status\(p_integration_id uuid,p_status text\)\s*returns jsonb/);
  assert.doesNotMatch(foundation,/hotel_integrations\(id\)/);
  assert.match(recoveredFoundation,/drop policy if exists hotel_integrations_owner_read/);
  assert.match(recoveredFoundation,/drop policy if exists hotel_integration_events_owner_read/);
  assert.match(migration,/hotel_pms_providers/);
  assert.match(migration,/pending_certification/);
  assert.match(migration,/The named PMS adapter is not certified/);
  assert.match(migration,/hotel_pms_connected_mode/);
  assert.doesNotMatch(queueMigration,/from lateral/i,'PMS backfill must not reference the UPDATE target from a LATERAL subquery');
  assert.doesNotMatch(queueMigration,/select (?:i|x)\.id/,'PMS queueing must use the canonical integration_id key');
  assert.match(queueMigration,/and exists\(/);
  assert.match(api,/\.eq\("integration_id", integration\.integration_id\)/);
  assert.match(api,/\.eq\("integration_event_id", id\)/);
  assert.doesNotMatch(api,/integration\.id/);
  assert.match(launch,/There are no certified PMS providers/);
  assert.match(launch,/Manual WeHouse hotel operations are the supported default/);
});

test('Hotel completion scheduling declares its pg_cron dependency',()=>{
  const migration=read('supabase/migrations/20260912095000_hotel_capabilities_completion_turnover.sql');
  assert.match(migration,/create extension if not exists pg_cron with schema pg_catalog/);
  assert.match(migration,/cron\.schedule\('wehouse-hotel-completion-v1'/);
});

test('Worker onboarding stays free and paid tools remain an optional entitlement',()=>{
  const foundation=read('supabase/migrations/20260913113221_free_worker_and_wehouse_pro_foundation.sql');
  const billing=read('supabase/migrations/20260913114644_worker_pro_web_billing.sql');
  const workers=read('src/lib/supabase/workers.ts');
  const exports=read('src/lib/supabase/index.ts');
  const paidPanel=read('src/components/WorkerProPanel.tsx');
  const publicProfile=read('src/components/WorkerPublicProfile.tsx');
  const discovery=read('src/pages/WorkerDiscovery.tsx');
  const creator=read('src/lib/saveCreatorSetting.ts');

  assert.match(foundation,/\('worker_verification_fee_enabled','false'/);
  assert.match(foundation,/\('worker_pro_sales_enabled','false'/);
  assert.match(foundation,/revoke all on function public\.create_worker_verification_payment\(\) from public,anon,authenticated/);
  assert.match(foundation,/revoke insert,update,delete on table public\.blue_badge_subscriptions from anon,authenticated/);
  assert.match(billing,/worker_pro_monthly_price_ngn/);
  assert.match(billing,/worker_pro_web_paystack_plan_code/);
  assert.match(creator,/creator_set_worker_pro_setting/);
  assert.match(creator,/worker-pro-plan-sync/);
  assert.match(paidPanel,/Gold PRO means an active subscription/);
  assert.match(paidPanel,/Identity and professional checks are reviewed separately/);
  assert.match(paidPanel,/pro\.active && <GoldTickBadge/);
  assert.match(read('src/components/GoldTickBadge.tsx'),/title = 'Pro membership'/);
  assert.doesNotMatch(paidPanel,/gold PRO mark|<WorkerProBadge/);
  assert.doesNotMatch(publicProfile,/WorkerProBadge/);
  assert.doesNotMatch(discovery,/WorkerProBadge/);
  assert.doesNotMatch(workers,/export async function createBlueBadgeSubscription/);
  assert.doesNotMatch(workers,/export async function cancelBlueBadgeSubscription/);
  assert.match(workers,/const hasCompletedVerification = status === 'verified'/);
  assert.doesNotMatch(exports,/createBlueBadgeSubscription|cancelBlueBadgeSubscription/);
});

test('Paid Worker tools stay separate from trust, organic ranking and payment truth',()=>{
  const migration=read('supabase/migrations/20260913170000_worker_paid_plan_options.sql');
  const discovery=read('src/pages/WorkerDiscovery.tsx');
  const proPanel=read('src/components/WorkerProPanel.tsx');
  const bookingChat=read('src/components/BookingNegotiationChat.tsx');
  const webhook=read('supabase/functions/paystack-webhook/index.ts');

  assert.match(migration,/\('worker_featured_sales_enabled','false'/);
  assert.match(migration,/_legal_launch_gate_is_approved\('worker_featured_placement'\)/);
  assert.match(migration,/worker_pro_is_active\(profile\.user_id\)/);
  assert.match(migration,/order by profile\.rating desc nulls last,profile\.review_count desc nulls last/);
  assert.match(discovery,/Featured Workers/);
  assert.match(discovery,/Paid placement among matching, available and Reviewed Workers\. It does not mean more trusted\./);
  assert.match(migration,/signed_in_unique_impressions/);
  assert.match(migration,/status='approved_released'/);
  assert.match(migration,/Marked paid by Worker — not verified by WeHouse/);
  assert.match(migration,/Paid through WeHouse/);
  assert.match(migration,/paid_plan_ordinary_support/);
  assert.match(migration,/safety_risk/);
  assert.match(proPanel,/monthly or yearly|selectedBillingPeriod/);
  assert.match(webhook,/invoice\.payment_failed/);
  assert.match(webhook,/subscription\.not_renew/);
  assert.match(bookingChat,/Original service request/);
});

test('Independent workspaces preserve scoped Staff operations access',()=>{
  const foundation=read('supabase/migrations/20260912094000_canonical_personal_and_workspaces.sql');
  const independent=read('supabase/migrations/20260913140000_independent_professional_workspaces.sql');
  for(const migration of [foundation,independent]){
    assert.match(migration,/property_operations/);
    assert.match(migration,/field_operations/);
    assert.match(migration,/worker_operations/);
    assert.match(migration,/finance_operations/);
    assert.match(migration,/security_operations/);
    assert.match(migration,/support/);
  }
});

test('Privileged production Edge Functions remain reproducible and fail closed',()=>{
  const creator=read('supabase/functions/creator-step-up/index.ts');
  const processor=read('supabase/functions/financial-action-processor/index.ts');
  assert.match(creator,/issue_creator_elevation_from_service/);
  assert.match(creator,/password_mfa/);
  assert.match(processor,/x-wehouse-cron-secret/);
  assert.match(processor,/sameSecret/);
  assert.match(processor,/mark_financial_action_manual_review/);
});

test('Adult eligibility is private and enforced before new profile completion',()=>{
  const migration=read('supabase/migrations/20260913180000_private_adult_account_gate.sql');
  const setup=read('src/pages/Setup.tsx');
  assert.match(migration,/create table if not exists public\.profile_age_eligibility/);
  assert.match(migration,/revoke all on table public\.profile_age_eligibility from public, anon, authenticated/);
  assert.match(migration,/current_date - interval '18 years'/);
  assert.match(migration,/profiles_require_adult_before_completion/);
  assert.match(setup,/set_my_date_of_birth/);
  assert.match(setup,/You must be 18 or older to use WeHouse/);
});

test('Short Let checkout follows reservation occupancy, not global listing state',()=>{
  const operations=read('src/components/HousingOperationsWorkspace.tsx');
  const migration=read('supabase/migrations/20260912001300_separate_short_let_publication_from_date_occupancy.sql');
  assert.match(operations,/row\.reservation_status === "occupied"/);
  assert.doesNotMatch(operations,/row\.listing_status === "occupied" \? \(\s*<section[^]*Confirm checkout/);
  assert.match(migration,/set status='occupied',tenancy_start_date=p_actual_check_in/);
  assert.match(migration,/set status='available',availability_status='available'/);
});

test('Worker ratings and reviews render only after verified job reviews exist',()=>{
  const profile=read('src/components/WorkerPublicProfile.tsx');
  const discovery=read('src/pages/WorkerDiscovery.tsx');
  const workerWorkspace=read('src/components/WorkerProfilePanelV2.tsx');
  const booking=read('src/components/BookingNegotiationChat.tsx');
  const schema=read('supabase/migrations/20250525000000_remote_schema.sql');
  assert.match(profile,/reviewCount > 0 && <span>★/);
  assert.match(profile,/reviews\.length \? <div/);
  assert.doesNotMatch(profile,/value=\{rating > 0 \?[^:]+: "New"\}/);
  assert.match(discovery,/Number\(worker\.review_count \|\| 0\) > 0 && Number\(worker\.rating \|\| 0\) > 0/);
  assert.match(workerWorkspace,/Number\(trust\?\.review_count\|\|0\)>0\?<Fact label="Customer rating"/);
  assert.match(booking,/booking\?\.status === "approved_released"/);
  assert.match(schema,/if booking\.status<>'approved_released' then raise exception 'Review becomes available after the job is completed'/);
});

test('Listing detail controls render with loaded media instead of floating during load',()=>{
  const wrapper=read('src/pages/ListingDetail.tsx');
  const detail=read('src/pages/ListingDetailCore.tsx');
  assert.doesNotMatch(wrapper,/Add apartment to Saved/);
  assert.match(detail,/PropertyMediaCarousel/);
  assert.match(detail,/!ml-0 !h-10 !w-10 !rounded-full/);
});

test('Location labels remove repeated address segments',async()=>{
  const location=await loadTsModule('src/lib/locationPresentation.ts');
  assert.equal(
    location.locationLabel('Ombi 1, Lafia, Nasarawa State, Lafia, Nasarawa State','Lafia','Nasarawa State'),
    'Ombi 1, Lafia, Nasarawa State',
  );
});
