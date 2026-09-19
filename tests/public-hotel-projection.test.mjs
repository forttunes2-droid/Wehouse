import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('anonymous hotel discovery and detail use explicit field allowlists', async () => {
  const migration = await read('supabase/migrations/20260915214000_allowlist_public_hotel_projection.sql');
  assert.match(migration, /create or replace function public\.get_discoverable_hotels/);
  assert.match(migration, /create or replace function public\.get_public_hotel_detail/);
  assert.doesNotMatch(migration, /to_jsonb\(h\)|to_jsonb\(v_hotel\)|to_jsonb\(room\)|to_jsonb\(plan\)|to_jsonb\(venue\)/);
  assert.match(migration, /'address',case when v_exact_location then v_hotel\.address else null end/);
  assert.match(migration, /'location_exact',v_exact_location/);
  assert.match(migration, /v_exact_location:=v_internal or v_current_paid_stay/);
});

test('public hotel projection does not publish connector, ownership, approval or capacity-provenance fields', async () => {
  const migration = await read('supabase/migrations/20260915214000_allowlist_public_hotel_projection.sql');
  const publicReturn = migration.slice(migration.indexOf("return jsonb_build_object("));
  for (const privateField of [
    "'owner_id'",
    "'inspection_request_id'",
    "'approved_by'",
    "'source_system'",
    "'external_reference'",
    "'total_rooms'",
    "'turnover_minutes'",
    "'completion_mode'",
    "'manual_completion_sla_hours'",
  ]) {
    assert.doesNotMatch(publicReturn, new RegExp(privateField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('anonymous execution is granted only on the safe public read commands', async () => {
  const migration = await read('supabase/migrations/20260915214000_allowlist_public_hotel_projection.sql');
  assert.match(migration, /grant execute on function public\.get_discoverable_hotels\(\) to anon,authenticated,service_role/);
  assert.match(migration, /grant execute on function public\.get_public_hotel_detail\(integer\) to anon,authenticated,service_role/);
});
