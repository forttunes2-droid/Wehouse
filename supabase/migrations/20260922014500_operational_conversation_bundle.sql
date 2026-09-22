begin;

-- Internal operations need a server-owned read model that keeps customer chat,
-- internal notes and case history separate. The previous client stitched two
-- RPCs together and mixed internal notes into the customer message stream.
create or replace function public.get_operational_conversation_bundle(
  p_conversation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_team boolean := false;
  v_messages jsonb := '[]'::jsonb;
  v_internal_notes jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
begin
  select *
  into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and deleted_at is null
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_actor.user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_conversation
  from public.partner_support_conversations
  where id=p_conversation_id;

  if v_conversation.id is null then
    raise exception 'Conversation not found';
  end if;

  if not public.current_actor_can_access_operational_conversation(
    p_conversation_id,false
  ) then
    raise exception 'Not authorised';
  end if;

  v_team := v_actor.user_id<>v_conversation.partner_id;

  select coalesce(jsonb_agg(item order by item.created_at),'[]'::jsonb)
  into v_messages
  from (
    select
      m.id,
      m.sender_id,
      coalesce(p.full_name,p.username,'WeHouse') as sender_name,
      m.sender_role,
      m.content,
      m.attachments,
      m.attachment_types,
      m.action_type,
      coalesce(m.action_metadata,'{}'::jsonb) as action_metadata,
      m.visibility,
      m.is_read,
      m.created_at
    from public.partner_support_messages m
    left join public.profiles p on p.user_id=m.sender_id
    where m.conversation_id=p_conversation_id
      and coalesce(m.visibility,'customer')<>'internal'
      and coalesce(m.action_type,'')<>'status_change'
  ) item;

  if v_team then
    select coalesce(jsonb_agg(item order by item.created_at),'[]'::jsonb)
    into v_internal_notes
    from (
      select
        m.id,
        m.sender_id,
        coalesce(p.full_name,p.username,'WeHouse team') as sender_name,
        m.sender_role,
        m.content,
        m.attachments,
        m.attachment_types,
        coalesce(m.action_metadata,'{}'::jsonb) as action_metadata,
        m.created_at
      from public.partner_support_messages m
      left join public.profiles p on p.user_id=m.sender_id
      where m.conversation_id=p_conversation_id
        and m.visibility='internal'
    ) item;
  end if;

  select coalesce(jsonb_agg(item order by item.created_at),'[]'::jsonb)
  into v_events
  from (
    select
      e.id,
      e.event_type,
      e.actor_id,
      coalesce(p.full_name,p.username,e.metadata->>'actor_name','WeHouse') as actor_name,
      p.role as actor_role,
      e.from_status,
      e.to_status,
      e.note,
      coalesce(e.metadata,'{}'::jsonb) as metadata,
      e.created_at
    from public.support_case_events e
    left join public.profiles p on p.user_id=e.actor_id
    where e.conversation_id=p_conversation_id
  ) item;

  return jsonb_build_object(
    'conversation',jsonb_build_object(
      'conversation_id',v_conversation.id,
      'subject',v_conversation.subject,
      'status',v_conversation.status,
      'context_type',v_conversation.context_type,
      'context_id',v_conversation.context_id,
      'context_snapshot',coalesce(v_conversation.context_snapshot,'{}'::jsonb),
      'case_number',v_conversation.case_number
    ),
    'messages',v_messages,
    'internal_notes',v_internal_notes,
    'events',v_events
  );
end;
$function$;

revoke all on function public.get_operational_conversation_bundle(uuid)
  from public,anon;
grant execute on function public.get_operational_conversation_bundle(uuid)
  to authenticated,service_role;

comment on function public.get_operational_conversation_bundle(uuid)
is 'Authorized operations projection separating customer messages, internal notes and case history so UI cannot accidentally merge distinct communication lanes.';

commit;
