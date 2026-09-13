-- An acceptance receipt is historical evidence, not an editable preference.
-- Re-accepting an already accepted version returns the original receipt.

create or replace function public.accept_effective_policy(
  p_policy_version_id uuid,
  p_presentation text,
  p_locale text default 'en-NG',
  p_source text default 'account',
  p_subject_type text default null,
  p_subject_id text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user text:=public.current_profile_user_id(); v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1 from public.creator_policy_versions p
    where p.policy_version_id=p_policy_version_id
      and p.status='active' and p.effective_from<=now()
      and (p.effective_until is null or p.effective_until>now())
  ) then raise exception 'Policy version is not effective'; end if;
  insert into public.policy_acceptance_receipts(
    user_id,policy_version_id,lifecycle_subject_type,lifecycle_subject_id,
    presentation,locale,source
  ) values(
    v_user,p_policy_version_id,p_subject_type,p_subject_id,
    p_presentation,coalesce(nullif(p_locale,''),'en-NG'),p_source
  ) on conflict do nothing
  returning receipt_id into v_id;
  if v_id is null then
    select receipt_id into v_id from public.policy_acceptance_receipts
    where user_id=v_user and policy_version_id=p_policy_version_id
      and lifecycle_subject_type is not distinct from p_subject_type
      and lifecycle_subject_id is not distinct from p_subject_id
    order by accepted_at limit 1;
  end if;
  return v_id;
end
$$;

create or replace function public.prevent_policy_acceptance_receipt_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  raise exception 'Policy acceptance receipts are immutable';
end
$$;

drop trigger if exists policy_acceptance_receipts_immutable
on public.policy_acceptance_receipts;
create trigger policy_acceptance_receipts_immutable
before update or delete on public.policy_acceptance_receipts
for each row execute function public.prevent_policy_acceptance_receipt_mutation();

revoke all on function public.prevent_policy_acceptance_receipt_mutation()
from public,anon,authenticated;
grant execute on function public.prevent_policy_acceptance_receipt_mutation()
to service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  case when p.proname='prevent_policy_acceptance_receipt_mutation'
    then 'approved_service_only' else 'approved_client_rpc' end,
  case when p.proname='prevent_policy_acceptance_receipt_mutation'
    then 'Internal immutable acceptance-receipt guard'
    else 'Idempotent exact-version policy acceptance command' end,
  now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'accept_effective_policy','prevent_policy_acceptance_receipt_mutation'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

comment on function public.prevent_policy_acceptance_receipt_mutation() is
  'Rejects UPDATE and DELETE so a policy acceptance remains immutable evidence.';
