-- Operator-only recovery archive for explicitly reviewed test-data repairs.
-- This migration archives/deletes no application records and exposes no RPC.
create schema if not exists wehouse_maintenance;
revoke all on schema wehouse_maintenance from public,anon,authenticated,service_role;
create table wehouse_maintenance.test_record_resets (
  reset_id text primary key,
  reason text not null,
  owner_confirmed_test boolean not null check (owner_confirmed_test),
  before_rows jsonb not null,
  manifest jsonb not null,
  created_at timestamptz not null default now()
);
alter table wehouse_maintenance.test_record_resets enable row level security;
revoke all on table wehouse_maintenance.test_record_resets from public,anon,authenticated,service_role;
