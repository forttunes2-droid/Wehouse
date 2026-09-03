-- Private calls belong to eligible private relationships in the Personal
-- workspace. An additive Staff/Admin assignment must not make the consumer
-- identity unreachable.
do $$
declare definition text;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_private_call_capabilities'
    and pg_get_function_identity_arguments(p.oid)='p_context_type text, p_context_id uuid';
  definition:=replace(
    definition,
    'v_profile.role not in (''user'', ''worker'')',
    'not (v_profile.account_kind = ''consumer'' or v_profile.role = ''worker'')'
  );
  execute definition;
end;
$$;

-- A ringing call cannot remain active forever. Either participant polling the
-- active-call endpoint closes an unanswered call and produces its canonical
-- missed-call Activity event through the existing trigger.
create or replace function public.get_my_active_private_calls()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_me text:=public.current_profile_user_id(); result jsonb;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  update public.private_calls
  set status='missed',ended_at=now()
  where v_me in(caller_id,callee_id)
    and status='ringing'
    and created_at < now() - interval '45 seconds';
  select coalesce(jsonb_agg(public.get_private_call_details(c.id) order by c.created_at desc),'[]'::jsonb)
    into result
  from public.private_calls c
  where v_me in(c.caller_id,c.callee_id) and c.status in('ringing','accepted');
  return result;
end;
$$;

revoke all on function public.get_my_active_private_calls() from public,anon;
grant execute on function public.get_my_active_private_calls() to authenticated,service_role;

