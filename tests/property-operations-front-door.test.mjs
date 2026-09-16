import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("customer property inspection enters Property Operations before Field Operations", async () => {
  const migration = await read("supabase/migrations/20260916160000_property_operations_front_door.sql");
  assert.match(migration, /where reason_code='field_visit'/);
  assert.match(migration, /set owning_domain='property_operations'/);
  assert.match(migration, /field_officer_id,status,notes,[\s\S]*null,'pending'/);
  assert.match(migration, /open_my_reservation_conversation\([\s\S]*'apartment_reservation'/);
  assert.match(migration, /set channel_kind='property_operations'/);
  assert.match(migration, /Property Operations will assign Field Operations for this property in this conversation/);
  assert.doesNotMatch(migration, /set channel_kind='field_operations'/);
});

test("only Property Operations assigns an eligible Field officer to the same conversation", async () => {
  const migration = await read("supabase/migrations/20260916160000_property_operations_front_door.sql");
  const start = migration.indexOf("create or replace function public.staff_assign_customer_inspection");
  const block = migration.slice(start);
  assert.match(block, /current_staff_has_permission\('operations'\)/);
  assert.match(block, /permission='field_officer'/);
  assert.match(block, /assigned_state/);
  assert.match(block, /assigned_lga/);
  assert.match(block, /context_type='apartment_reservation'/);
  assert.match(block, /assigned_staff_id=coalesce\(assigned_staff_id,v_actor\.user_id\)/);
  assert.match(block, /assigned_field_officer_id=v_field\.user_id/);
  assert.match(block, /channel_kind='property_operations'/);
  assert.match(block, /Property Operations remains responsible/);
});

test("Property Operations UI exposes the assignment without inventing a second customer chat", async () => {
  const [panel, workspace] = await Promise.all([
    read("src/components/CustomerInspectionAssignmentPanel.tsx"),
    read("src/components/HousingOperationsWorkspace.tsx"),
  ]);
  assert.match(panel, /get_customer_inspection_assignment/);
  assert.match(panel, /staff_assign_customer_inspection/);
  assert.match(panel, /same reservation conversation/);
  assert.match(panel, /IN SAME CHAT/);
  assert.match(workspace, /<CustomerInspectionAssignmentPanel/);
  assert.match(workspace, /journey.*inspection|action === "inspection"/s);
});