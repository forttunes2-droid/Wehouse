import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Short Let caution is optional and Hotels keep their separate arrival policy", async () => {
  const [form, migration] = await Promise.all([
    read("src/components/PropertyInspectionRequestPanel.tsx"),
    read("supabase/migrations/20260916173100_optional_short_let_caution_window.sql"),
  ]);
  assert.match(form, /cautionEnabled/);
  assert.match(form, /No caution/);
  assert.match(form, /Use caution/);
  assert.match(form, /Refundable caution amount/);
  assert.match(migration, /short_let_caution_check_in_window/);
  assert.match(migration, /default_minutes',60,'minimum_minutes',30,'maximum_minutes',60/);
  assert.match(migration, /This Short Let has no refundable caution amount/);
  assert.match(migration, /Legacy already-checked-in stays retain the old four-hour evidence window/);
  assert.doesNotMatch(migration, /alter table public\.hotel_bookings/);
  assert.doesNotMatch(migration, /set_hotel_arrival_deadline/);
});

test("Operations preparation and publication do not force a Short Let caution amount", async () => {
  const [optionalMigration, prepareMigration] = await Promise.all([
    read("supabase/migrations/20260916173100_optional_short_let_caution_window.sql"),
    read("supabase/migrations/20260916173200_prepare_optional_short_let_caution.sql"),
  ]);
  assert.match(optionalMigration, /v_deposit<0/);
  assert.match(optionalMigration, /Caution amount cannot be negative/);
  assert.doesNotMatch(optionalMigration, /Short Stay requires a refundable security deposit/);
  assert.match(prepareMigration, /v_deposit<0/);
  assert.doesNotMatch(prepareMigration, /Short Let requires a refundable security deposit/);
});
