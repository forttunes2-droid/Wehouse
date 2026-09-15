import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("GitHub exposes stable required checks on Node 24 with production dependency audit", async () => {
  const [build, consolidation] = await Promise.all([
    read(".github/workflows/profile-phase-check.yml"),
    read(".github/workflows/consolidation-validation.yml"),
  ]);
  assert.match(build, /name: WeHouse Build Check[\s\S]*name: WeHouse Build Check/);
  assert.match(build, /node-version: 24/);
  assert.match(build, /npm audit --omit=dev --audit-level=high/);
  assert.match(build, /npm run lint[\s\S]*npm test[\s\S]*npx tsc --noEmit[\s\S]*npm run build/);
  assert.match(consolidation, /name: Consolidation Validation/);
  assert.match(consolidation, /needs: \[tests-and-build, migration-replay\]/);
  assert.match(consolidation, /node-version: 24/);
  assert.match(consolidation, /worker_face_review_contract\.sql/);
  assert.match(consolidation, /accommodation_handover_contract\.sql/);
});

test("public signup cannot create a Service Provider or Property Partner identity directly", async () => {
  const [auth, login, migration] = await Promise.all([
    read("src/lib/supabase/auth.ts"),
    read("src/pages/Login.tsx"),
    read("supabase/migrations/20260915191500_restore_personal_identity_and_harden_security.sql"),
  ]);
  assert.match(auth, /legacyInitialWorkspace/);
  assert.match(auth, /void legacyInitialWorkspace/);
  assert.doesNotMatch(auth, /signup_role/);
  assert.match(login, /onLoginSuccess\(user\.id, returnedEmail, "user"\)/);
  assert.match(login, /signUpWithEmail\(clean, password, "user"\)/);
  assert.match(migration, /Public account creation always creates Personal only/);
  assert.match(migration, /v_auth_id,v_email,v_username,'user'/);
});

test("public password login is throttled before service-role identity lookup", async () => {
  const [migration, login] = await Promise.all([
    read("supabase/migrations/20260914185841_rate_limit_public_password_login.sql"),
    read("supabase/functions/login-with-identifier/index.ts"),
  ]);
  assert.match(migration, /v_window interval:=interval '15 minutes'/);
  assert.match(migration, /v_max_attempts integer:=12/);
  assert.match(login, /consume_public_password_login_attempt_from_service/);
  assert.match(login, /429/);
});

test("browser security headers and recovery Edge Function verification are explicit", async () => {
  const [vercel, index, config] = await Promise.all([
    read("vercel.json"),
    read("index.html"),
    read("supabase/config.toml"),
  ]);
  assert.match(vercel, /Content-Security-Policy/);
  assert.match(vercel, /frame-ancestors 'none'/);
  assert.match(vercel, /X-Content-Type-Options/);
  assert.doesNotMatch(index, /<script>(?![\s\S]*type=)/);
  assert.match(config, /\[functions\.provider-password-recovery\][\s\S]*verify_jwt = true/);
  assert.match(config, /\[functions\.private-call-ice\][\s\S]*verify_jwt = true/);
});

test("password creation and change keep an eight-character minimum", async () => {
  const [login, security, recovery] = await Promise.all([
    read("src/pages/Login.tsx"),
    read("src/pages/SecuritySettings.tsx"),
    read("supabase/functions/provider-password-recovery/index.ts"),
  ]);
  assert.match(login, /Password must be at least 8 characters/);
  assert.match(login, /New password must be at least 8 characters/);
  assert.match(security, /newPassword\.length\s*<\s*8/);
  assert.match(recovery, /newPassword\.length\s*<\s*8/);
});

test("Personal navigation is exactly Explore, Bookings, Inbox and Account", async () => {
  const app = await read("src/App.tsx");
  const start = app.indexOf("const tabs = useMemo");
  const end = app.indexOf("const navHistoryRef", start);
  const tabs = app.slice(start, end);
  assert.match(tabs, /label: "Explore"/);
  assert.match(tabs, /label: "Bookings"/);
  assert.match(tabs, /label: "Inbox"/);
  assert.match(tabs, /label: "Account"/);
  assert.doesNotMatch(tabs, /label: "Conversation"/);
});

test("Inbox keeps Activity and Messages in one product surface with separate counts", async () => {
  const [personal, provider, activity] = await Promise.all([
    read("src/pages/Chat.tsx"),
    read("src/components/WorkerJobsPanelV2.tsx"),
    read("src/components/InboxActivityEntry.tsx"),
  ]);
  assert.match(personal, /InboxActivityEntry/);
  assert.match(personal, /activityUnreadCount/);
  assert.match(personal, /Messages/);
  assert.match(provider, /InboxActivityEntry/);
  assert.match(provider, /displayedActivityUnread/);
  assert.match(provider, /displayedChatUnread/);
  assert.match(activity, /Activity/);
});

test("private messaging unlock is profile-session scoped, not route or conversation scoped", async () => {
  const [e2ee, hook, auth] = await Promise.all([
    read("src/lib/e2ee.ts"),
    read("src/hooks/useSecureInboxAccess.ts"),
    read("src/hooks/useAuth.ts"),
  ]);
  assert.match(e2ee, /SESSION_KEY_PREFIX = "wehouse:e2ee:private-key:"/);
  assert.match(e2ee, /sessionStorage\.setItem\(sessionKey\(identity\.user_id\)/);
  assert.match(e2ee, /sessionStorage\.getItem\(sessionKey\(identity\.user_id\)\)/);
  assert.match(hook, /rememberPrivateMessagingProfile\(profileId\)/);
  assert.doesNotMatch(hook, /conversationId|peerUserId|workspace/);
  assert.match(auth, /sessionStorage\.clear\(\)/);
});

test("forgotten Inbox passcode resets with new six digits and no old-passcode requirement", async () => {
  const [onboarding, recovery] = await Promise.all([
    read("src/components/SecureChatOnboarding.tsx"),
    read("src/lib/e2eeRecovery.ts"),
  ]);
  assert.match(onboarding, /Forgot passcode\?/);
  assert.match(onboarding, /You do not need the old passcode/);
  assert.match(onboarding, /Confirm your passcode/);
  assert.match(onboarding, /resetEncryptionRecoveryPin\(pin\)/);
  assert.match(recovery, /reset_my_encryption_identity/);
  assert.doesNotMatch(recovery, /currentPin/);
});

test("Inbox surfaces do not expose a permanent PIN settings control", async () => {
  const [personal, provider, security] = await Promise.all([
    read("src/pages/Chat.tsx"),
    read("src/components/WorkerJobsPanelV2.tsx"),
    read("src/pages/PrivacySecuritySettings.tsx"),
  ]);
  assert.doesNotMatch(personal, />Inbox PIN/);
  assert.doesNotMatch(provider, />Inbox PIN/);
  assert.doesNotMatch(security, /SecureMessagesPanel/);
});

test("Service Provider and Property Partner are additive workspaces on one Personal identity", async () => {
  const [account, migration] = await Promise.all([
    read("src/pages/AccountCenter.tsx"),
    read("supabase/migrations/20260915204500_allow_multi_professional_workspaces.sql"),
  ]);
  assert.match(account, /Workspaces & access/);
  assert.match(account, /Use WeHouse as/);
  assert.match(account, /Service Provider/);
  assert.match(account, /Property Partner/);
  assert.match(account, /Offer services through WeHouse Services/);
  assert.match(account, /List or manage apartments and hotels/);
  assert.match(migration, /'worker','global','active'/);
  assert.match(migration, /'property_partner','global','active'/);
  assert.doesNotMatch(migration, /set role=case when role='user' then 'worker'/);
});

test("multi-role conflict guards block self-approval and self-inspection", async () => {
  const migration = await read("supabase/migrations/20260915205500_multi_role_conflict_guards.sql");
  assert.match(migration, /review your listing/);
  assert.match(migration, /review your Service Provider verification/);
  assert.match(migration, /process your refund/);
  assert.match(migration, /review and publish your hotel/);
  assert.match(migration, /cannot be assigned to their own customer inspection/);
});

test("Service Provider onboarding is free and paid Pro is separate from review and trust", async () => {
  const [activation, pro, profile, discovery, retiredPayment] = await Promise.all([
    read("src/components/WorkerActivationHome.tsx"),
    read("src/components/WorkerProPanel.tsx"),
    read("src/components/WorkerPublicProfile.tsx"),
    read("src/pages/WorkerDiscovery.tsx"),
    read("supabase/functions/worker-verification-payment-init/index.ts"),
  ]);
  assert.match(activation, /No onboarding payment is required/);
  assert.match(pro, /business tools/i);
  assert.doesNotMatch(profile, /WorkerProBadge/);
  assert.doesNotMatch(discovery, /WorkerProBadge/);
  assert.match(retiredPayment, /retired: true/);
  assert.match(retiredPayment, /No verification payment can be initialized/);
});

test("biometric/liveness is policy gated and recurring verification is independently disabled by default", async () => {
  const [migration, gate, review] = await Promise.all([
    read("supabase/migrations/20260915212000_gate_biometric_identity_policy.sql"),
    read("src/components/IdentityAccessGate.tsx"),
    read("src/pages/ServiceProviderVerification.tsx"),
  ]);
  assert.match(migration, /'account_identity_recurring_enabled','false'/);
  assert.match(migration, /account_identity_checks_enabled\(\)/);
  assert.match(migration, /account_identity_recurring_enabled\(\)/);
  assert.match(migration, /Private identity verification is not enabled by current WeHouse policy/);
  assert.match(migration, /identity_gate_satisfied/);
  assert.match(migration, /identity_passed/);
  assert.match(gate, /state\?\.required && !state\.gate_satisfied/);
  assert.match(review, /activation\.identity_required === true/);
  assert.match(review, /Face\/liveness verification is not currently required/);
});

test("browser face scores can only request independent WeHouse review", async () => {
  const [migration, capture, queue] = await Promise.all([
    read("supabase/migrations/20260914210626_harden_account_identity_review.sql"),
    read("src/components/WorkerIdentityCheck.tsx"),
    read("src/components/AccountIdentityReviewQueue.tsx"),
  ]);
  assert.match(migration, /status='pending_review'/);
  assert.match(migration, /review_account_identity_check/);
  assert.match(migration, /p_decision not in\('approved','rejected'\)/);
  assert.match(migration, /v_actor\.user_id=v_target\.user_id then return false/);
  assert.match(capture, /awaiting WeHouse review/);
  assert.match(queue, /Browser scores help screening but cannot approve/);
});

test("Personal apartment bookings cannot inherit Creator operational visibility", async () => {
  const reservations = await read("src/lib/supabase/reservations.ts");
  assert.match(reservations, /getReservationsForUser\(userId: string\)[\s\S]*\.eq\("user_id", userId\)/);
  assert.match(reservations, /getInspectionRequestsForUser\(userId: string\)[\s\S]*\.eq\("user_id", userId\)/);
});

test("accommodation arrival and handover fail closed without authoritative Payment Protection", async () => {
  const [migration, contract] = await Promise.all([
    read("supabase/migrations/20260914094837_close_accommodation_handover_gaps.sql"),
    read("supabase/tests/accommodation_handover_contract.sql"),
  ]);
  assert.match(migration, /protected_ledger_transaction_id is not null/);
  assert.match(migration, /provider_event\.processing_status='processed'/);
  assert.match(migration, /ledger\.reference_type='booking_payment'/);
  assert.match(contract, /checked_in_at bypassed the Payment Protection guard/);
  assert.match(contract, /verified_handover_at bypassed the Long Let Payment Protection guard/);
});

test("paid accommodation terms become immutable and Long Let remains rent only", async () => {
  const [snapshot, rentOnly, contract] = await Promise.all([
    read("supabase/migrations/20260914160000_bind_paid_accommodation_snapshots.sql"),
    read("supabase/migrations/20260914170000_enforce_long_let_rent_only.sql"),
    read("supabase/tests/accommodation_handover_contract.sql"),
  ]);
  assert.match(snapshot, /prevent_paid_accommodation_snapshot_change/);
  assert.match(snapshot, /Short Let payment does not match its dates, guests and price snapshot/);
  assert.match(snapshot, /Long Let payment does not match its tenure and contract snapshot/);
  assert.match(rentOnly, /Long Let payment must contain rent only/);
  assert.match(contract, /Long Let accepted a security deposit/);
});

test("password recovery is one-use, OAuth-bound, server-completed and globally signs out", async () => {
  const [login, transaction, migration, edge] = await Promise.all([
    read("src/pages/Login.tsx"),
    read("src/lib/googleVerification.ts"),
    read("supabase/migrations/20260914084537_worker_support_window_and_auth_grants.sql"),
    read("supabase/functions/provider-password-recovery/index.ts"),
  ]);
  assert.match(login, /begin_identity_provider_password_recovery/);
  assert.match(login, /verify_identity_provider_password_recovery/);
  assert.match(login, /functions\.invoke\([\s\S]{0,80}"provider-password-recovery"/);
  assert.doesNotMatch(login, /resetPasswordForEmail/);
  assert.match(transaction, /PASSWORD_RECOVERY_MAX_AGE_MS = 10 \* 60 \* 1000/);
  assert.match(transaction, /sessionStorage\.setItem\(TRANSACTION_KEY/);
  assert.match(migration, /attempt\.status='verified'/);
  assert.match(edge, /claim_identity_provider_password_recovery/);
  assert.match(edge, /admin\.auth\.admin\.updateUserById/);
  assert.match(edge, /finish_identity_provider_password_recovery/);
  assert.match(edge, /admin\.auth\.admin\.signOut\(token, "global"\)/);
});

test("private audio/video calls use call-participant authorization and temporary TURN credentials", async () => {
  const [client, center, edge] = await Promise.all([
    read("src/lib/private-calls.ts"),
    read("src/components/PrivateCallCenter.tsx"),
    read("supabase/functions/private-call-ice/index.ts"),
  ]);
  assert.match(client, /functions\.invoke\('private-call-ice'/);
  assert.match(center, /getPrivateCallIceServers\(call\.id\)/);
  assert.match(edge, /admin\.auth\.getUser\(token\)/);
  assert.match(edge, /\[call\.caller_id, call\.callee_id\]\.includes\(profile\.user_id\)/);
  assert.match(edge, /TURN_URLS/);
  assert.match(edge, /TURN_SHARED_SECRET/);
  assert.match(edge, /\+ 60 \* 60/);
  assert.match(edge, /crypto\.subtle\.sign/);
  assert.doesNotMatch(edge, /return json\(\{[^}]*TURN_SHARED_SECRET/);
});

test("account closure checks all workspaces and cannot ignore obligations because of a legacy role", async () => {
  const migration = await read("supabase/migrations/20260915213000_harden_multi_workspace_account_closure.sql");
  assert.match(migration, /user_has_active_workspace\(v_target\.user_id,'worker'\)/);
  assert.match(migration, /user_has_active_workspace\(v_target\.user_id,'property_partner'\)/);
  assert.match(migration, /active housing reservation/);
  assert.match(migration, /active hotel stay/);
  assert.match(migration, /active WeHouse Services job/);
  assert.match(migration, /wallet obligations remain/);
  assert.match(migration, /withdrawal is still being processed/);
});

test("legacy verification payment recording is retired", async () => {
  const migration = await read("supabase/migrations/20260915213000_harden_multi_workspace_account_closure.sql");
  assert.match(migration, /record_worker_verification_payment/);
  assert.match(migration, /return false/);
  assert.match(migration, /from public,anon,authenticated/);
});

test("legal surfaces use reviewed versioned documents and Long Let never gains an invented deposit", async () => {
  const [account, setup, terms, privacy, editor, drafts, rentOnly] = await Promise.all([
    read("src/pages/AccountCenter.tsx"),
    read("src/pages/Setup.tsx"),
    read("src/pages/TermsPage.tsx"),
    read("src/pages/PrivacyPolicyPage.tsx"),
    read("src/components/CreatorLegalDocuments.tsx"),
    read("src/content/legalReviewDrafts.ts"),
    read("supabase/migrations/20260914170000_enforce_long_let_rent_only.sql"),
  ]);
  for (const source of [account, setup, terms, privacy]) assert.match(source, /getCurrentLegalDocuments/);
  assert.match(editor, /creator_save_legal_draft/);
  assert.match(editor, /creator_publish_legal_document/);
  assert.match(drafts, /There is no Long Let security deposit/);
  assert.match(drafts, /Biometric\/liveness DPIA/);
  assert.match(rentOnly, /Long Let payment must contain rent only/);
});
