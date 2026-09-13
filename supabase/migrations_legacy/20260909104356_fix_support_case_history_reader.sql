-- Qualify the conversation id because the table-returning RPC also exposes an id column.
create or replace function public.get_my_support_case_events(p_conversation_id uuid)
returns table(
  id uuid,
  event_type text,
  actor_id text,
  actor_name text,
  actor_role text,
  from_status text,
  to_status text,
  note text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor public.profiles;
  current_case public.partner_support_conversations;
begin
  select * into actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if actor.user_id is null then raise exception 'Authentication required'; end if;

  select c.* into current_case
  from public.partner_support_conversations c
  where c.id=p_conversation_id;
  if current_case.id is null then raise exception 'Request not found'; end if;

  if not (
    actor.user_id=current_case.partner_id
    or actor.user_id=current_case.assigned_staff_id
    or actor.user_id=current_case.assigned_field_officer_id
    or actor.role in ('admin','creator')
  ) then raise exception 'Not authorised'; end if;

  return query
  select e.id,e.event_type,e.actor_id,
    coalesce(p.full_name,p.username,e.metadata->>'actor_name','WeHouse'),p.role,
    e.from_status,e.to_status,e.note,coalesce(e.metadata,'{}'::jsonb),e.created_at
  from public.support_case_events e
  left join public.profiles p on p.user_id=e.actor_id
  where e.conversation_id=p_conversation_id
  order by e.created_at;
end;
$function$;

revoke all on function public.get_my_support_case_events(uuid) from public,anon;
grant execute on function public.get_my_support_case_events(uuid) to authenticated,service_role;
