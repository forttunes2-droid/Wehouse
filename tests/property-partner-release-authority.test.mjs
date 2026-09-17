import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = () => readFile(
  new URL("../supabase/migrations/20260917084500_retire_legacy_partner_release_paths.sql", import.meta.url),
  "utf8",
);

test("legacy Hotel and Property Partner release paths cannot credit supplier wallets", async () => {
  const sql = await migration();
  assert.match(sql, /drop trigger if exists hotel_booking_release_partner_earning/i);
  assert.match(sql, /create or replace function public\.release_completed_hotel_partner_earning\(\)/i);
  assert.match(sql, /Compatibility no-op/i);
  assert.match(sql, /create or replace function public\.release_property_partner_earning/i);
  assert.match(sql, /legacy_disabled/i);
  assert.doesNotMatch(sql, /available_balance\s*=\s*available_balance\s*\+/i);
});

test("canonical release reconciles an old pending Partner amount before availability", async () => {
  const sql = await migration();
  assert.match(sql, /normalize_canonical_partner_earning/i);
  assert.match(sql, /v_legacy_pending/i);
  assert.match(sql, /pending_balance\s*=\s*pending_balance\s*-\s*v_legacy_pending/i);
  assert.match(sql, /net_amount\s*=\s*v_receipt\.payee_amount/i);
  assert.match(sql, /requires Finance review/i);
});

test("WeHouse property pipeline keeps technical coordinates behind the human UI", async () => {
  const sql = await migration();
  assert.match(sql, /create or replace function public\.get_my_property_pipeline_v2/i);
  for (const field of ["gps_latitude", "gps_longitude", "location_accuracy_m", "latitude", "longitude", "accuracy"]) {
    assert.match(sql, new RegExp(`- '${field}'`));
  }
});
