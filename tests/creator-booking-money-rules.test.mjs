import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Creator exposes one nested Booking & money rules surface", async () => {
  const [dashboard, editor, genericSettings] = await Promise.all([
    read("src/pages/CreatorDashboard.tsx"),
    read("src/components/CreatorBookingMoneyRules.tsx"),
    read("src/pages/CreatorSettingsTabV2.tsx"),
  ]);

  assert.match(dashboard, /id: "booking_money"/);
  assert.equal(
    (dashboard.match(/label: "Booking & money rules"/g) || []).length,
    1,
  );
  assert.match(
    dashboard,
    /section === "booking_money" && <CreatorBookingMoneyRules \/>/,
  );
  assert.match(editor, /creator_get_booking_money_rules/);
  assert.match(editor, /creator_publish_booking_money_rules/);
  assert.match(editor, /requestElevation\("policy_publish"/);
  assert.doesNotMatch(editor, /from\("platform_settings"\)/);
  assert.doesNotMatch(genericSettings, /reservation_fee|commission_short_let|commission_long_let|commission_hotel|commission_worker/);
});

test("versioned booking money policy is the authority and legacy keys are mirrors", async () => {
  const migration = await read(
    "supabase/migrations/20260921110000_consolidate_booking_money_policy_authority.sql",
  );

  assert.match(migration, /source_of_truth','creator_policy_versions'/);
  assert.match(migration, /finance_is_read_only',true/);
  assert.match(migration, /short_let_reservation_hold/);
  assert.match(migration, /'minutes',30/);
  assert.match(migration, /long_let_reservation_fee/);
  assert.match(migration, /'amount',10000/);
  assert.match(migration, /late_cancel_max_nights',1/);
  assert.match(migration, /no_show_max_nights',1/);
  assert.match(migration, /security_deposit_never_cancellation_charge',true/);
  assert.match(migration, /'maximum_nights',1/);
  assert.match(migration, /'enabled',false,'partner_opt_in',true/);
  assert.match(migration, /when 'short_let' then 'commission_short_let'/);
  assert.match(migration, /when 'long_let' then 'commission_long_let'/);
  assert.match(migration, /Compatibility mirror only\. Creator policy registry is authoritative\./);
  assert.match(migration, /editable=false/);
  assert.match(migration, /enforce_short_let_checkout_window_trigger/);
  assert.match(migration, /enforce_shared_short_let_checkout_window_housing/);
  assert.match(migration, /enforce_shared_short_let_checkout_window_payment/);
});

test("money policy editor preserves launch product boundaries", async () => {
  const editor = await read("src/components/CreatorBookingMoneyRules.tsx");

  assert.match(editor, /Short Let/);
  assert.match(editor, /Long Let/);
  assert.match(editor, /Service Worker/);
  assert.match(editor, /Security deposit/);
  assert.match(editor, /Off at launch/);
  assert.match(editor, /Existing bookings keep the rules they accepted/);
  assert.match(editor, /Refundable Short Let security deposits are excluded/);
  assert.doesNotMatch(editor, /escrow/i);
});
