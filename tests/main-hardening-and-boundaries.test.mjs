import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("GitHub exposes stable required check names and a dependent consolidation gate", async () => {
  const [build, consolidation] = await Promise.all([
    read(".github/workflows/profile-phase-check.yml"),
    read(".github/workflows/consolidation-validation.yml"),
  ]);
  assert.match(
    build,
    /name: WeHouse Build Check[\s\S]*jobs:[\s\S]*name: WeHouse Build Check/,
  );
  assert.match(build, /pull_request:[\s\S]*merge_group:/);
  assert.match(
    consolidation,
    /name: Consolidation Validation[\s\S]*needs: \[tests-and-build, migration-replay\]/,
  );
  assert.match(consolidation, /BUILD_RESULT[\s\S]*MIGRATION_RESULT/);
});

test("Activity owns one deterministic mobile back treatment", async () => {
  const layout = await read("src/components/DesktopLayout.tsx");
  assert.match(layout, /OWN_MOBILE_BACK[\s\S]*'activity'/);
  assert.match(layout, /activePage !== 'activity'/);
});

test("accommodation UI and database fail closed without Payment Protection", async () => {
  const [lifecycle, migration] = await Promise.all([
    read("src/lib/propertyBookingLifecycle.ts"),
    read(
      "supabase/migrations/20260914070812_enforce_protected_accommodation_handover.sql",
    ),
  ]);
  assert.match(lifecycle, /year_one_rent_protection_id/);
  assert.match(lifecycle, /stay_payment_protection_id/);
  assert.match(lifecycle, /Payment needs WeHouse review/);
  assert.match(
    migration,
    /Current Payment Protection is required before accommodation arrival or handover/,
  );
  assert.match(
    migration,
    /create or replace function public\.get_public_hotel_detail/,
  );
  assert.match(
    migration,
    /Internal WeHouse accounts cannot activate marketplace workspaces/,
  );
  assert.match(migration, /workspace_one_marketplace_role_guard/);
});

test("Personal apartment bookings cannot inherit Creator operations visibility", async () => {
  const reservations = await read("src/lib/supabase/reservations.ts");
  assert.match(
    reservations,
    /getReservationsForUser\(userId: string\)[\s\S]*\.eq\("user_id", userId\)[\s\S]*\.eq\("reservation_type", "apartment"\)/,
  );
  assert.match(
    reservations,
    /getInspectionRequestsForUser\(userId: string\)[\s\S]*\.eq\("user_id", userId\)/,
  );
});

test("legal surfaces use reviewed versioned documents, never legacy settings", async () => {
  const [account, setup, terms, privacy, creator, legalEditor, settings] =
    await Promise.all([
      read("src/pages/AccountCenter.tsx"),
      read("src/pages/Setup.tsx"),
      read("src/pages/TermsPage.tsx"),
      read("src/pages/PrivacyPolicyPage.tsx"),
      read("src/pages/CreatorDashboard.tsx"),
      read("src/components/CreatorLegalDocuments.tsx"),
      read("src/pages/CreatorSettingsTabV2.tsx"),
    ]);

  for (const source of [account, setup, terms, privacy])
    assert.match(source, /getCurrentLegalDocuments/);
  for (const source of [account, setup, terms, privacy, creator, legalEditor, settings])
    assert.doesNotMatch(
      source,
      /from\(['"]platform_settings['"]\)[\s\S]{0,180}(privacy_policy|terms_of_service)/,
    );
  assert.match(creator, /<CreatorLegalDocuments\s*\/>/);
  assert.match(legalEditor, /creator_save_legal_draft/);
  assert.match(legalEditor, /creator-step-up/);
  assert.match(legalEditor, /creator_publish_legal_document/);
  assert.match(legalEditor, /p_review_reference/);
  assert.match(legalEditor, /row\.policy_key === "legal_privacy"/);
  assert.match(legalEditor, /row\.policy_key === "legal_terms"/);
  assert.doesNotMatch(settings, /key:'privacy_policy'|key:'terms_of_service'/);
});

test("Short Let naming and public location copy match the product boundary", async () => {
  const [title, detail] = await Promise.all([
    read("src/lib/listingPresentation.ts"),
    read("src/pages/ListingDetailCore.tsx"),
  ]);
  assert.doesNotMatch(title, /Short Stay/);
  assert.match(title, /Short Let/);
  assert.match(
    detail,
    /exact address,[\s\S]*full[\s\S]*accommodation payment is confirmed and protected/i,
  );
});

test("paid Worker tools stay separate from review and public trust", async () => {
  const [panel, profile, discovery] = await Promise.all([
    read("src/components/WorkerProPanel.tsx"),
    read("src/components/WorkerPublicProfile.tsx"),
    read("src/pages/WorkerDiscovery.tsx"),
  ]);
  assert.match(panel, /subscription pays for the business tools listed below/i);
  assert.doesNotMatch(panel, /gold PRO mark|<WorkerProBadge/);
  assert.doesNotMatch(profile, /WorkerProBadge/);
  assert.doesNotMatch(discovery, /WorkerProBadge/);
});

test("accommodation payment confirmation uses the canonical protected-funds gateway", async () => {
  const [webhook, verify, migration] = await Promise.all([
    read("supabase/functions/paystack-webhook/index.ts"),
    read("supabase/functions/paystack-verify/index.ts"),
    read(
      "supabase/migrations/20260914094837_close_accommodation_handover_gaps.sql",
    ),
  ]);
  assert.match(webhook, /process_verified_paystack_charge/);
  assert.match(verify, /process_verified_paystack_charge/);
  assert.match(webhook, /retired Worker payment recorded for Finance review/i);
  assert.match(
    verify,
    /legacy Worker onboarding payment cannot grant WeHouse approval/i,
  );
  assert.match(
    migration,
    /payment\.metadata->>'reservation_id'=p_reservation_id/,
  );
  assert.match(migration, /payment\.listing_id=p_listing_id/);
  assert.match(migration, /payment_group\.listing_id=p_listing_id/);
  assert.match(migration, /payment_component'=case when v_short/);
  assert.match(migration, /protected_ledger_transaction_id is not null/);
  assert.match(migration, /ledger\.reference_type='booking_payment'/);
  assert.match(migration, /ledger\.reference_id=payment\.id::text/);
  assert.match(
    migration,
    /provider_event\.provider_event_id=ledger\.provider_event_id/,
  );
  assert.match(migration, /provider_event\.processing_status='processed'/);
  assert.match(
    migration,
    /Existing accommodation % must be reconciled before protected handover enforcement/,
  );
});

test("every accommodation arrival field and shared payer is guarded", async () => {
  const [migration, workflow, contract] = await Promise.all([
    read(
      "supabase/migrations/20260914094837_close_accommodation_handover_gaps.sql",
    ),
    read(".github/workflows/consolidation-validation.yml"),
    read("supabase/tests/accommodation_handover_contract.sql"),
  ]);
  for (const field of [
    "requested_move_in_at",
    "status",
    "canonical_state",
    "verified_handover_at",
    "handover_confirmed_by_customer_at",
    "tenancy_start_date",
    "occupancy_started_at",
    "checked_in_at",
    "listing_id",
    "stay_rent_total",
    "upfront_rent_required",
    "annual_rent_snapshot",
  ])
    assert.match(migration, new RegExp(field));
  assert.match(migration, /v_paid_member_count=v_accepted_count/);
  assert.match(migration, /component_total/);
  assert.match(migration, /shared_housing_share','other'/);
  assert.match(
    migration,
    /Shared Long Let contract payment is temporarily unavailable/,
  );
  assert.match(
    workflow,
    /supabase\/tests\/accommodation_handover_contract\.sql/,
  );
  assert.match(contract, /checked_in_at bypassed the Payment Protection guard/);
  assert.match(
    contract,
    /verified_handover_at bypassed the Long Let Payment Protection guard/,
  );
  assert.match(contract, /A protected reservation was moved to an unpaid listing/);
  assert.match(contract, /A valid occupied Long Let lost access after release/);
  assert.match(
    contract,
    /accepted but unpaid shared member authorized handover/,
  );
});

test("paid accommodation terms are bound to the checkout snapshot", async () => {
  const [migration, contract] = await Promise.all([
    read(
      "supabase/migrations/20260914160000_bind_paid_accommodation_snapshots.sql",
    ),
    read("supabase/tests/accommodation_handover_contract.sql"),
  ]);
  assert.match(migration, /validate_paid_accommodation_snapshot/);
  assert.match(migration, /Short Let payment does not match its dates, guests and price snapshot/);
  assert.match(migration, /Long Let payment does not match its tenure and contract snapshot/);
  assert.match(migration, /Shared Short Let payment does not match its dates, guests and split snapshot/);
  assert.match(migration, /prevent_paid_accommodation_snapshot_change/);
  for (const field of [
    "stay_check_in",
    "stay_check_out",
    "stay_nights",
    "guest_count",
    "rental_plan_years",
    "contract_rent_total",
    "upfront_rent_required",
    "security_deposit_snapshot",
  ])
    assert.match(migration, new RegExp(field));
  assert.match(contract, /Paid Short Let dates or guests were mutable/);
  assert.match(contract, /Paid Long Let tenure or contract total was mutable/);
  assert.match(contract, /Open shared Short Let dates or guests were mutable/);
});

test("Worker review and booking have no onboarding-payment gate", async () => {
  const [migration, reviewStatus, oversight] = await Promise.all([
    read(
      "supabase/migrations/20260914100242_separate_worker_review_from_paid_tools.sql",
    ),
    read("src/components/WorkerReviewIdentityStatus.tsx"),
    read("src/components/CreatorWorkerOversight.tsx"),
  ]);
  assert.match(
    migration,
    /create or replace function public\.start_my_worker_test/,
  );
  assert.match(
    migration,
    /create or replace function public\.create_booking_request_v2/,
  );
  assert.doesNotMatch(
    migration,
    /Verified Paystack payment is required before the Worker test/,
  );
  assert.doesNotMatch(migration, /purpose\s*=\s*'worker_verification'/);
  assert.match(migration, /'profile_ready',v_profile_ready/);
  assert.doesNotMatch(reviewStatus, /payment_confirmed|>Payment</);
  assert.doesNotMatch(oversight, /payment_confirmed|label="Payment"/);
});

test("private Inbox unlock is independent from whether a job is still open", async () => {
  const [personalInbox, workerInbox, bookingChat, workerMessages, roommateMessages, e2ee] = await Promise.all([
    read("src/pages/ChatCore.tsx"),
    read("src/components/WorkerJobsPanelV2.tsx"),
    read("src/components/BookingNegotiationChat.tsx"),
    read("src/lib/supabase/worker-bookings.ts"),
    read("src/lib/supabase/chat.ts"),
    read("src/lib/e2ee.ts"),
  ]);
  assert.match(personalInbox, /useSecureInboxAccess/);
  assert.match(workerInbox, /useSecureInboxAccess/);
  assert.match(
    bookingChat,
    /!openConversation[\s\S]*secureChat\.state === "unlock_required"[\s\S]*<SecureChatOnboarding/,
  );
  assert.match(bookingChat, /This job conversation is closed/);
  assert.match(bookingChat, /Some messages are still locked/);
  assert.match(bookingChat, /retryLockedMessages/);
  assert.match(personalInbox, /Some messages are still locked/);
  assert.match(personalInbox, /retryLockedMessages/);
  assert.match(workerMessages, /decryption_failed:decryptionFailed/);
  assert.match(roommateMessages, /decryption_failed:decryptionFailed/);
  assert.match(e2ee, /wehouse:private-message-access/);
});

test("Worker paid tools live under Account and load only when opened", async () => {
  const [workspace, account] = await Promise.all([
    read("src/pages/WorkerWorkspaceModern.tsx"),
    read("src/pages/AccountCenter.tsx"),
  ]);
  const nav = workspace.slice(
    workspace.indexOf("const LIVE_NAV"),
    workspace.indexOf("const ACTIVATION_NAV"),
  );
  assert.doesNotMatch(nav, /Works|paid_tools|\bpro\b/);
  assert.match(workspace, /accountView === "paid_tools"/);
  assert.match(workspace, /function WorkerPaidToolsAccount[\s\S]*useWorkerPro/);
  assert.match(account, /Paid Worker tools/);
});

test("creating a Worker workspace opens Worker setup and continues to verification", async () => {
  const [app, account, setup, activation, verification, workspace, migration, sqlContract] = await Promise.all([
    read("src/App.tsx"),
    read("src/pages/AccountCenter.tsx"),
    read("src/pages/WorkerSetupProfessional.tsx"),
    read("src/components/WorkerActivationHome.tsx"),
    read("src/pages/WorkerVerificationPhase9.tsx"),
    read("src/pages/WorkerWorkspaceModern.tsx"),
    read("supabase/migrations/20260914113621_enforce_worker_face_check_before_review.sql"),
    read("supabase/tests/worker_face_review_contract.sql"),
  ]);
  assert.match(account, /onWorkspaceActivated\?\.\(workspace\)/);
  assert.match(app, /workspace === "worker" \? "worker_setup" : "property_partner"/);
  assert.match(setup, /if \(!profile\.worker_verified\)[\s\S]*onContinueVerification\(\)/);
  assert.doesNotMatch(setup, /wh_worker_setup_return/);
  assert.match(activation, /Continue Worker setup/);
  assert.match(activation, /identity_captured === true && data\.identity_passed === true/);
  assert.match(verification, /Worker verification/);
  assert.match(verification, /identity_captured === true && a\.identity_passed === true/);
  assert.match(verification, /!identityComplete[\s\S]*<WorkerIdentityCheck/);
  assert.match(workspace, /const ACTIVATION_NAV[\s\S]*id: "account"/);
  assert.match(migration, /'identity_required',true/);
  assert.match(
    migration,
    /create or replace function public\.submit_my_worker_verification\(\)[\s\S]*if not public\.worker_identity_is_current\(v_profile\.user_id\)/,
  );
  assert.match(
    migration,
    /create or replace function public\.save_my_worker_professional_evidence[\s\S]*if not public\.worker_identity_is_current\(v_profile\.user_id\)/,
  );
  assert.doesNotMatch(
    migration,
    /coalesce\(v_identity_required,false\) and not public\.worker_identity_is_current/,
  );
  assert.match(
    migration,
    /get_public_workers[\s\S]*and public\.worker_identity_is_current\(profile\.user_id\)/,
  );
  assert.match(
    migration,
    /coalesce\(profile\.worker_status,'pending'\)<>'verified'[\s\S]*coalesce\(profile\.worker_verified,false\)/,
  );
  assert.match(sqlContract, /Worker review submission bypassed the live-face check/);
  assert.match(sqlContract, /Valid Worker review submission did not enter review/);
  assert.doesNotMatch(account, /title="Professional profile"/);
  assert.doesNotMatch(account, /managed only from Professional Profile/);
  assert.doesNotMatch(account, /Add a professional workspace/);
  assert.doesNotMatch(activation, /professional work evidence/i);
});

test("Worker chat does not repeat the full request card in the message timeline", async () => {
  const chat = await read("src/components/BookingNegotiationChat.tsx");
  const timeline = chat.slice(
    chat.indexOf("<main className="),
    chat.indexOf("</main>"),
  );
  assert.doesNotMatch(timeline, /<JobRequestDetails/);
  assert.match(chat, /<JobRequestDetailsSheet/);
  assert.match(chat, /Requested date/);
  assert.doesNotMatch(chat, /\["Payment state"|\["Job state"/);
});

test("showcase comments stay a mobile sheet and video uses one playback stream", async () => {
  const viewer = await read("src/components/WorkerShowcasePostViewer.tsx");
  assert.match(viewer, /max-h-\[72dvh\]/);
  assert.match(viewer, /containerClassName="h-full w-full bg-transparent"/);
  assert.doesNotMatch(viewer, /<video src=\{src\} muted autoPlay loop/);
});

test("job-specific WeHouse support expires from final payment release, not job completion", async () => {
  const [migration, chat] = await Promise.all([
    read(
      "supabase/migrations/20260914084537_worker_support_window_and_auth_grants.sql",
    ),
    read("src/components/BookingNegotiationChat.tsx"),
  ]);
  assert.match(migration, /released_at\+interval '24 hours'/);
  assert.match(migration, /job_support_open/);
  assert.match(migration, /protection_state='released'/);
  assert.match(
    migration,
    /Job completion and mutable booking timestamps do[\s\S]*not start or extend this window/,
  );
  assert.match(chat, /jobSupportOpen/);
  assert.match(chat, /\{jobSupportOpen && \([\s\S]*Message WeHouse/);
});

test("adult gate helpers and account deletion use restricted execution contexts", async () => {
  const migration = await read(
    "supabase/migrations/20260914084537_worker_support_window_and_auth_grants.sql",
  );
  assert.match(
    migration,
    /require_adult_before_profile_completion\(\) from public,anon,authenticated/,
  );
  assert.match(migration, /set_my_date_of_birth\(date\) from public,anon/);
  assert.match(
    migration,
    /alter function public\.delete_user_account\(text\) set search_path to 'pg_catalog','public'/,
  );
});

test("password recovery requires a one-use attempt bound to the linked OAuth session", async () => {
  const [login, auth, useAuth, migration, edge] = await Promise.all([
    read("src/pages/Login.tsx"),
    read("src/lib/supabase/auth.ts"),
    read("src/hooks/useAuth.ts"),
    read(
      "supabase/migrations/20260914084537_worker_support_window_and_auth_grants.sql",
    ),
    read("supabase/functions/provider-password-recovery/index.ts"),
  ]);
  assert.match(login, /begin_identity_provider_password_recovery/);
  assert.match(login, /verify_identity_provider_password_recovery/);
  assert.match(login, /functions\.invoke\("provider-password-recovery"/);
  assert.doesNotMatch(login, /resetPasswordForEmail/);
  assert.doesNotMatch(login, /auth\.updateUser\(\{ password \}\)/);
  assert.doesNotMatch(login, /verify_google_password_recovery/);
  assert.match(
    migration,
    /expires_at timestamptz not null default \(now\(\)\+interval '10 minutes'\)/,
  );
  assert.match(migration, /verified_session_id=v_session_id/);
  assert.match(migration, /method->>'method'='oauth'/);
  assert.match(migration, /attempt\.target_auth_id=v_auth_id/);
  assert.match(migration, /attempt\.status='verified'/);
  assert.match(edge, /admin\.auth\.getUser\(token\)/);
  assert.match(edge, /claim_identity_provider_password_recovery/);
  assert.match(edge, /admin\.auth\.admin\.updateUserById/);
  assert.match(edge, /finish_identity_provider_password_recovery/);
  assert.match(edge, /admin\.auth\.admin\.signOut\(token, "global"\)/);
  assert.doesNotMatch(edge, /console\.(?:log|error).*newPassword/);
  assert.match(auth, /current_password: currentPassword/);
  assert.match(useAuth, /googlePasswordRecoveryRequested/);
  assert.doesNotMatch(useAuth, /PASSWORD_RECOVERY_AUTH_KEY/);
});
