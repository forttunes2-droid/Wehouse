-- Payment protection is mandatory: money paid by a user may only reach a partner or worker through a protected release.
-- Future-year rent instalments were settled to the partner with no protection hold, so new instalment payments are
-- blocked until they are rebuilt on the protected release path. Already-created rows and plans are not touched.

create or replace function public.create_rent_plan_contribution_payment(p_contribution_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
begin
  raise exception 'Rent instalments are paused until they run under payment protection';
end $$;

revoke all on function public.create_rent_plan_contribution_payment(uuid) from public, anon;
grant execute on function public.create_rent_plan_contribution_payment(uuid) to authenticated, service_role;
