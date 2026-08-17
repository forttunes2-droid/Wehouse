-- Non-destructive validation queries for the Profile phase.
-- Run after applying the Profile migrations. They return rows only when a check fails.

-- Required functions must exist.
SELECT required.name AS missing_function
FROM (VALUES
  ('create_my_profile'),('update_my_profile'),('update_my_privacy'),
  ('manage_staff_permission'),('ensure_my_partner_account'),
  ('upsert_my_bank_account'),('save_my_worker_verification'),
  ('submit_my_worker_verification')
) AS required(name)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=required.name
);

-- Sensitive tables must have RLS enabled.
SELECT c.relname AS table_without_rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('profiles','staff_permissions','property_partners','worker_services','bank_accounts','worker_verifications','worker_service_coverage')
  AND c.relrowsecurity=false;

-- No public ALL policy should remain on the sensitive role tables.
SELECT tablename,policyname
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('staff_permissions','property_partners','worker_services','bank_accounts','worker_verifications')
  AND cmd='ALL' AND roles::text LIKE '%public%';

-- Worker evidence buckets must not be public.
SELECT id AS public_worker_evidence_bucket
FROM storage.buckets
WHERE id IN ('worker-files','worker_docs') AND public=true;
