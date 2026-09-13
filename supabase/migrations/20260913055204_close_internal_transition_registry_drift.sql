-- The canonical transition matrix is an internal immutable helper called by
-- reviewed lifecycle functions. It has no direct execution grant, so classify
-- it explicitly and keep the registry's all-function review queue closed.

update public.function_execution_registry
set review_state='approved_service_only',
    rationale='Internal immutable lifecycle transition validator; no direct role execution grant',
    captured_at=now()
where function_signature='canonical_product_transition_allowed(text,text,text)'
  and not public_allowed
  and not anon_allowed
  and not authenticated_allowed
  and not service_role_allowed;

do $$
begin
  if exists(
    select 1
    from public.function_execution_registry
    where review_state='requires_review'
  ) then
    raise exception 'Function execution review queue is not closed';
  end if;
end
$$;
