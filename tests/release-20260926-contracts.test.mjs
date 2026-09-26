import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Short Let Reserve date is a separate paid fee before stay and deposit', async () => {
  const [migration, detail, review, paymentInit] = await Promise.all([
    read('supabase/migrations/20260926061000_short_let_paid_reserve_date.sql'),
    read('src/pages/ListingDetailCore.tsx'),
    read('src/components/ShortLetPaymentReview.tsx'),
    read('supabase/functions/payment-init/index.ts'),
  ]);
  assert.match(migration, /policy_key='short_let_reservation_fee'/);
  assert.match(migration, /reservation_fee_status='paid'/);
  assert.match(migration, /payment_component','short_stay_balance'/);
  assert.match(migration, /v_total:=v_stay\+v_caution/);
  assert.match(migration, /Reserve date payment must be confirmed first/);
  assert.match(detail, /Reserve date · ₦/);
  assert.match(detail, /initializeReservationPayment\(reference\)/);
  assert.match(review, /Reserve date paid/);
  assert.match(review, /stay charge and any refundable security deposit/i);
  assert.match(paymentInit, /Reserve date payment must be confirmed before the stay balance/);
});

test('Signed-out Personal uses Sign in instead of a fake Account destination', async () => {
  const [nav, guest] = await Promise.all([
    read('src/components/PersonalBottomNav.tsx'),
    read('src/components/GuestBrowseEntry.tsx'),
  ]);
  assert.match(nav, /signedOut/);
  assert.match(nav, /'Sign in'/);
  assert.match(guest, /signedOut/);
  assert.match(guest, /requireSignIn\(null, 'account'\)/);
  assert.doesNotMatch(guest, /title: 'Your account'/);
  assert.doesNotMatch(guest, /title: 'Sign in to WeHouse'/);
});

test('Property management is property-scoped and booking responsibility is snapshotted', async () => {
  const [authority, conversations, assets, panel] = await Promise.all([
    read('supabase/migrations/20260926062000_property_management_authority.sql'),
    read('supabase/migrations/20260926062300_host_booking_conversations.sql'),
    read('supabase/migrations/20260926062500_property_partner_managed_assets.sql'),
    read('src/components/PropertyManagementPanel.tsx'),
  ]);
  assert.match(authority, /property_host_assignments/);
  assert.match(authority, /management_mode_snapshot/);
  assert.match(authority, /responsible_host_user_id/);
  assert.match(authority, /current_actor_can_host_reservation/);
  assert.match(conversations, /property_host_conversations/);
  assert.match(conversations, /Only photos and videos can be attached/);
  assert.doesNotMatch(conversations, /select\s+r\.booking_code/i);
  assert.match(assets, /get_my_managed_properties/);
  assert.match(panel, /Host managed/);
  assert.match(panel, /WeHouse managed/);
  assert.match(panel, /Hosting team/);
  assert.match(panel, /Property Operations/);
  assert.match(panel, /Guest booking code/);
});

test('Host-managed homes expose audited future price and availability controls', async () => {
  const [migration, controls, workspace, reserveDate] = await Promise.all([
    read('supabase/migrations/20260926081500_host_managed_home_controls.sql'),
    read('src/components/PropertyHostControls.tsx'),
    read('src/pages/PropertyOwnerDashboard.tsx'),
    read('supabase/migrations/20260926061000_short_let_paid_reserve_date.sql'),
  ]);
  assert.match(migration, /property_host_date_blocks/);
  assert.match(migration, /property_commercial_change_log/);
  assert.match(migration, /set_my_property_future_price/);
  assert.match(migration, /set_my_property_booking_availability/);
  assert.match(migration, /block_my_property_dates/);
  assert.match(migration, /current_actor_can_manage_property/);
  assert.match(migration, /Only the property owner can change who manages this home/);
  assert.match(migration, /a\.assignment_role='owner'/);
  assert.match(migration, /revoke_property_host_manager/);
  assert.match(migration, /responsible_host_user_id=v_actor/);
  assert.match(migration, /property_host_conversations/);
  assert.match(migration, /host_user_id=v_actor/);
  assert.match(migration, /property_host_manager_revoked/);
  assert.match(migration, /revoke all on public\.property_host_date_blocks from public,anon,authenticated/i);
  assert.match(migration, /l\.status in \('available','unavailable','reserved','occupied','maintenance','closed'\)/);
  assert.match(reserveDate, /nightly_rate_snapshot/);
  assert.match(controls, /Hosting controls/);
  assert.match(controls, /Pause bookings/);
  assert.match(controls, /Reopen on/);
  assert.match(workspace, /<PropertyHostControls/);
});

test('Creator sensitive actions use a separate server-hashed secret and independent MFA', async () => {
  const [migration, stepUp, modal, security] = await Promise.all([
    read('supabase/migrations/20260926063000_creator_security_credential.sql'),
    read('supabase/functions/creator-step-up/index.ts'),
    read('src/components/CreatorAuthModal.tsx'),
    read('src/pages/SecuritySettings.tsx'),
  ]);
  assert.match(migration, /extensions\.crypt\(p_secret,extensions\.gen_salt\('bf',12\)\)/);
  assert.match(migration, /finance_exception/);
  assert.match(migration, /Authenticator verification is required for this Creator action/);
  assert.match(stepUp, /creator_secret/);
  assert.doesNotMatch(stepUp, /signInWithPassword/);
  assert.match(modal, /Creator security password/);
  assert.match(security, /Set up authenticator/);
  assert.match(security, /Current WeHouse account password/);
  assert.match(security, /New Creator security password/);
});

test('Host conversations stay separate from WeHouse support and media storage is booking-scoped', async () => {
  const [conversation, media, chat, inbox] = await Promise.all([
    read('supabase/migrations/20260926062300_host_booking_conversations.sql'),
    read('supabase/migrations/20260926062400_property_host_chat_media.sql'),
    read('src/components/PropertyHostBookingChat.tsx'),
    read('src/pages/Chat.tsx'),
  ]);
  assert.match(conversation, /property_host_conversation_access/);
  assert.match(conversation, /get_my_property_host_conversations/);
  assert.match(media, /property-host-chat-files/);
  assert.match(media, /property_host_chat_storage_access/);
  assert.match(chat, /Back to Inbox/);
  assert.match(inbox, /kind: "host"/);
  assert.match(inbox, /PropertyHostBookingChat/);
});

test('Short Let shared payment starts only after paid Reserve date', async () => {
  const [migration, split] = await Promise.all([
    read('supabase/migrations/20260926062800_short_let_share_after_reserve_date.sql'),
    read('src/components/ShortLetSplitCosts.tsx'),
  ]);
  assert.match(migration, /Pay Reserve date before splitting the remaining stay cost/);
  assert.match(migration, /reservation_fee_status<>'paid'/);
  assert.match(migration, /payment_phase.*short_stay/s);
  assert.match(migration, /status='ready_for_move_in'/);
  assert.match(migration, /reservation_fee_kept_separate/);
  assert.match(split, /Reserve date is already paid by you/);
  assert.match(split, /short_stay_balance_due_at/);
  assert.doesNotMatch(migration, /create_short_stay_reservation\(/);
});
