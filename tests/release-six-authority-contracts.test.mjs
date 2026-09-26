import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read=(p)=>fs.readFile(p,'utf8');

test('Short Let Reserve date is fee-first and keeps stay/deposit separate',async()=>{
  const [sql,detail,review]=await Promise.all([
    read('supabase/migrations/20260926061000_short_let_paid_reserve_date.sql'),
    read('src/pages/ListingDetailCore.tsx'),
    read('src/components/ShortLetPaymentReview.tsx'),
  ]);
  assert.match(sql,/policy_key='short_let_reservation_fee'/);
  assert.match(sql,/reservation_fee_status='paid'/);
  assert.match(sql,/short_stay_balance_due_at/);
  assert.match(sql,/Reserve date payment must be confirmed first/);
  assert.match(sql,/v_total:=v_stay\+v_caution/);
  assert.match(detail,/Reserve date · ₦/);
  assert.match(review,/Complete the reservation fee first/);
  assert.match(review,/Reserve date paid/);
});

test('Host authority is property-specific and booking responsibility is snapshotted',async()=>{
  const [authority,chat,managed,panel]=await Promise.all([
    read('supabase/migrations/20260926062000_property_management_authority.sql'),
    read('supabase/migrations/20260926062300_host_booking_conversations.sql'),
    read('supabase/migrations/20260926062500_property_partner_managed_assets.sql'),
    read('src/components/PropertyManagementPanel.tsx'),
  ]);
  assert.match(authority,/property_host_assignments/);
  assert.match(authority,/management_mode_snapshot/);
  assert.match(authority,/responsible_host_user_id/);
  assert.match(authority,/current_actor_can_host_reservation/);
  assert.match(chat,/Guest <-> responsible Host conversation|guest <-> responsible Host/i);
  assert.match(chat,/Only photos and videos can be attached/);
  assert.match(managed,/get_my_managed_properties/);
  assert.match(panel,/Identity verification does not create property authority/);
  assert.match(panel,/booking code.*intentionally not shown/i);
});

test('Creator sensitive actions use a separate server-side credential and MFA',async()=>{
  const [sql,step,setup,modal,security]=await Promise.all([
    read('supabase/migrations/20260926063000_creator_security_credential.sql'),
    read('supabase/functions/creator-step-up/index.ts'),
    read('supabase/functions/creator-security-setup/index.ts'),
    read('src/components/CreatorAuthModal.tsx'),
    read('src/pages/SecuritySettings.tsx'),
  ]);
  assert.match(sql,/creator_security_credentials/);
  assert.match(sql,/extensions\.crypt\(p_secret/);
  assert.match(sql,/locked_until/);
  assert.match(sql,/creator_secret_mfa/);
  assert.doesNotMatch(step,/signInWithPassword\(/);
  assert.match(step,/verify_creator_security_secret_from_service/);
  assert.match(setup,/signInWithPassword/);
  assert.match(modal,/Creator security password/);
  assert.match(security,/Set up authenticator/);
  assert.match(security,/Separate from the password used to sign in to WeHouse/);
});
