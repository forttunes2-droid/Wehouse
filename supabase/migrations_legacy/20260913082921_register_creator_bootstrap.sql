-- Keep the service-only Creator bootstrap inside the audited function
-- execution inventory. This migration is separate because 0496 was already
-- rehearsed against the preview project before the registry gap was found.

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  p.oid::regprocedure::text,
  p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  'approved_service_only',
  'One-time, exact-identity Creator grant; callable only by a protected service-role runbook.',
  now()
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.oid::regprocedure::text=
    'bootstrap_first_creator_from_service(uuid,text,text)'
on conflict(function_signature) do update set
  function_name=excluded.function_name,
  security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=excluded.captured_at;

do $$
begin
  if not exists(
    select 1
    from public.function_execution_registry
    where function_signature=
      'bootstrap_first_creator_from_service(uuid,text,text)'
      and security_mode='definer'
      and not public_allowed
      and not anon_allowed
      and not authenticated_allowed
      and service_role_allowed
      and review_state='approved_service_only'
  ) then
    raise exception 'Creator bootstrap execution registry classification is invalid';
  end if;
end
$$;
