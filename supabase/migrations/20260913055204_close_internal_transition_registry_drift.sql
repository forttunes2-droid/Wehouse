-- The canonical transition matrix is an internal immutable helper called by
-- reviewed lifecycle functions. It has no direct execution grant, so classify
-- it explicitly and keep the registry's all-function review queue closed.

revoke all on function public.canonical_product_transition_allowed(text,text,text)
from public,anon,authenticated,service_role;

update public.function_execution_registry
set public_allowed=false,
    anon_allowed=false,
    authenticated_allowed=false,
    service_role_allowed=false,
    review_state='approved_service_only',
    rationale='Internal immutable lifecycle transition validator; no direct role execution grant',
    captured_at=now()
where function_signature='canonical_product_transition_allowed(text,text,text)';

do $$
declare v_unresolved text;
begin
  select string_agg(
    format('%s [%s public=%s anon=%s authenticated=%s service=%s]',
      function_signature,security_mode,public_allowed,anon_allowed,
      authenticated_allowed,service_role_allowed),
    ', ' order by function_signature
  ) into v_unresolved
  from public.function_execution_registry
  where review_state='requires_review';
  if v_unresolved is not null then
    raise exception 'Function execution review queue is not closed: %',v_unresolved;
  end if;
end
$$;
