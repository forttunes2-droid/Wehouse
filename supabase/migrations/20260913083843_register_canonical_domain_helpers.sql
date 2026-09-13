-- Close the last executable-function inventory gap. These two functions are
-- immutable/invoker-only label normalizers; they carry no table or elevated
-- authority, but every executable public function still belongs in the audit.

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
  'approved_client_rpc',
  'Read-only canonical work-area normalizer with no table or elevated authority.',
  now()
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.oid::regprocedure::text in(
    'canonical_operational_domain(text)',
    'canonical_staff_domain(text)'
  )
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
  if (
    select count(*)
    from public.function_execution_registry
    where function_signature in(
      'canonical_operational_domain(text)',
      'canonical_staff_domain(text)'
    )
      and security_mode='invoker'
      and not public_allowed
      and not anon_allowed
      and authenticated_allowed
      and service_role_allowed
      and review_state='approved_client_rpc'
  )<>2 then
    raise exception 'Canonical work-area helper registry classification is invalid';
  end if;
end
$$;
