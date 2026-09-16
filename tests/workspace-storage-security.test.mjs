import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('private Service Provider and Property Partner storage follows workspace grants, not legacy profile roles', async () => {
  const migration = await read('supabase/migrations/20260916073500_workspace_scoped_storage_authority.sql');

  assert.match(migration, /current_actor_has_workspace\('worker',null\)/);
  assert.match(migration, /current_actor_has_workspace\('property_partner',null\)/);
  assert.match(migration, /service_provider_evidence_owner_insert/);
  assert.match(migration, /account_identity_owner_insert/);
  assert.match(migration, /property_partner_access_evidence_insert/);
  assert.match(migration, /listing_candidates_insert_source/);
  assert.doesNotMatch(migration, /p\.role='worker'/);
  assert.doesNotMatch(migration, /p\.role='property_partner'/);
});

test('Property Partner onboarding cannot become arbitrary public file hosting', async () => {
  const migration = await read('supabase/migrations/20260916073500_workspace_scoped_storage_authority.sql');

  assert.match(migration, /private candidates/);
  assert.match(migration, /hotel\.owner_id=public\.current_profile_user_id\(\)/);
  assert.match(migration, /hotel\.status='active'/);
  assert.match(migration, /\(storage\.foldername\(name\)\)\[1\]='hotels'/);
  assert.doesNotMatch(migration, /\(actor\.role = 'property_partner'/);
});
