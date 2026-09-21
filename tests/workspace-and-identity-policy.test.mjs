import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Personal identity can add both Service Worker and Property Partner workspaces', async () => {
  const [workspaceMigration, conflictMigration, account] = await Promise.all([
    read('supabase/migrations/20260915204500_allow_multi_professional_workspaces.sql'),
    read('supabase/migrations/20260915205500_multi_role_conflict_guards.sql'),
    read('src/pages/AccountCenter.tsx'),
  ]);

  assert.match(workspaceMigration, /insert into public\.workspace_role_assignments[\s\S]*'worker'/);
  assert.match(workspaceMigration, /insert into public\.workspace_role_assignments[\s\S]*'property_partner'/);
  assert.doesNotMatch(workspaceMigration, /set role=case when role='user' then 'worker'/);
  assert.doesNotMatch(workspaceMigration, /set role=case when role='user' then 'property_partner'/);
  assert.match(conflictMigration, /drop trigger if exists workspace_one_marketplace_role_guard/);
  assert.match(conflictMigration, /drop function if exists public\.enforce_one_marketplace_workspace/);
  assert.ok(
    conflictMigration.indexOf('drop trigger if exists workspace_one_marketplace_role_guard') <
      conflictMigration.indexOf('drop function if exists public.enforce_one_marketplace_workspace'),
  );
  assert.match(account, /title="WeHouse"/);
  assert.match(account, /Service Worker/);
  assert.match(account, /title="Offer services"/);
  assert.match(account, /Property Partner/);
  assert.match(account, /title="List a property"/);
});

test('multi-role identities cannot approve records that benefit themselves', async () => {
  const migration = await read('supabase/migrations/20260915205500_multi_role_conflict_guards.sql');
  assert.match(migration, /Another authorized person must review your listing/);
  assert.match(migration, /Another authorized person must review your Service Provider verification/);
  assert.match(migration, /Another authorized person must process your refund/);
  assert.match(migration, /Another authorized person must review and publish your hotel/);
  assert.match(migration, /cannot be assigned to their own customer inspection/);
});

test('biometric identity verification is policy-gated and recurring checks are separately disabled by default', async () => {
  const [migration, gate, review] = await Promise.all([
    read('supabase/migrations/20260915212000_gate_biometric_identity_policy.sql'),
    read('src/components/IdentityAccessGate.tsx'),
    read('src/pages/ServiceProviderVerification.tsx'),
  ]);

  assert.match(migration, /'account_identity_recurring_enabled','false'/);
  assert.match(migration, /create or replace function public\.account_identity_checks_enabled/);
  assert.match(migration, /create or replace function public\.account_identity_recurring_enabled/);
  assert.match(migration, /not public\.account_identity_checks_enabled\(\)[\s\S]*or public\.account_identity_is_current/);
  assert.match(migration, /Private identity verification is not enabled by current WeHouse policy/);
  assert.match(migration, /'identity_required',v_identity_required/);
  assert.match(migration, /'identity_gate_satisfied',v_identity_gate/);
  assert.match(migration, /'identity_passed',coalesce\(v_identity\.status='passed',false\)/);
  assert.match(gate, /state\?\.required && !state\.gate_satisfied/);
  assert.match(review, /activation\.identity_required === true/);
  assert.doesNotMatch(review, /Face\/liveness verification is not currently required/);
});

test('identity evidence stays distinct from public Reviewed or trust claims', async () => {
  const migration = await read('supabase/migrations/20260915212000_gate_biometric_identity_policy.sql');
  assert.match(migration, /v_actual_current:=public\.account_identity_is_current\(p_worker_id\)/);
  assert.match(migration, /'identity_passed',coalesce\(v_identity\.status='passed',false\)/);
  assert.match(migration, /Do not use this helper as a public claim that biometrics passed/);
});
