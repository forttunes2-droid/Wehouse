-- Customer previews, order and unread counts never include private operational notes.
CREATE OR REPLACE FUNCTION public.get_my_support_conversations()
 RETURNS TABLE(conversation_id uuid, subject text, status text, category text, context_type text, context_id text, context_snapshot jsonb, priority text, assigned_staff_name text, last_message text, last_message_time timestamp with time zone, unread_count bigint, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles;
begin
  if not public._property_document_session_active() then raise exception 'A trusted active session is required' using errcode='42501';end if;
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Authentication required'; end if;
  return query
  select
    c.id,
    coalesce(nullif(btrim(c.subject),''),'WeHouse Help')::text,
    c.status,
    c.category,
    c.context_type,
    c.context_id,
    coalesce(c.context_snapshot,'{}'::jsonb)||jsonb_build_object('case_number',c.case_number),
    c.priority,
    coalesce(s.full_name,s.username),
    (select case
      when nullif(btrim(m.content),'') is not null then m.content
      when coalesce(cardinality(m.attachments),0)>0 then 'Attachment'
      else '' end
     from public.partner_support_messages m
     where m.conversation_id=c.id and coalesce(m.visibility,'customer')<>'internal'
     order by m.created_at desc limit 1),
    (select m.created_at from public.partner_support_messages m where m.conversation_id=c.id and coalesce(m.visibility,'customer')<>'internal' order by m.created_at desc limit 1),
    (select count(*) from public.partner_support_messages m where m.conversation_id=c.id and coalesce(m.visibility,'customer')<>'internal' and not coalesce(m.is_read,false) and m.sender_id<>v_actor.user_id),
    c.created_at
  from public.partner_support_conversations c
  left join public.profiles s on s.user_id=c.assigned_staff_id
  where c.partner_id=v_actor.user_id
    and exists(select 1 from public.partner_support_messages first_message where first_message.conversation_id=c.id and coalesce(first_message.visibility,'customer')<>'internal')
  order by coalesce((select max(latest.created_at) from public.partner_support_messages latest where latest.conversation_id=c.id and coalesce(latest.visibility,'customer')<>'internal'),c.created_at) desc;
end;
$function$;


-- Queue reads require the same trusted session as conversation access.
create or replace function public.support_inbox(
  p_queue text default 'support'
)
returns table(
  conversation_id uuid,
  requester_id text,
  requester_role text,
  requester_name text,
  requester_email text,
  requester_state text,
  requester_lga text,
  subject text,
  status text,
  category text,
  context_type text,
  context_id text,
  context_snapshot jsonb,
  priority text,
  assigned_staff_id text,
  assigned_staff_name text,
  last_message text,
  last_message_time timestamptz,
  unread_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  actor public.profiles;
  v_queue text;
  v_creator boolean:=false;
  v_admin boolean:=false;
begin
  if not public._property_document_session_active() then raise exception 'A trusted active session is required' using errcode='42501';end if;
  if p_queue not in(
    'all','operations','property_operations','reservation_operations',
    'field_operations','worker_operations','finance_operations',
    'security_operations','support'
  ) then
    raise exception 'Invalid communication context';
  end if;

  select * into actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if actor.user_id is null then raise exception 'Authentication required'; end if;

  v_creator:=public.user_has_active_workspace(actor.user_id,'creator');
  v_admin:=public.user_has_active_workspace(actor.user_id,'admin');
  v_queue:=case when p_queue in(
    'operations','property_operations','reservation_operations'
  ) then 'property_operations' else p_queue end;

  if p_queue='all' and not (v_creator or v_admin) then
    raise exception 'Creator or Admin access required';
  end if;

  if p_queue<>'all'
     and not v_creator
     and not v_admin
     and not (
       public.user_has_active_workspace(actor.user_id,'staff')
       and public.user_has_active_workspace(actor.user_id,v_queue)
     ) then
    raise exception 'This communication context is outside your work area';
  end if;

  return query
  select
    c.id,
    c.partner_id,
    coalesce(c.requester_role,p.role),
    coalesce(p.full_name,p.username,p.email),
    p.email,
    p.state,
    coalesce(nullif(p.local_government,''),p.city),
    c.subject,
    c.status,
    c.category,
    c.context_type,
    c.context_id,
    c.context_snapshot,
    c.priority,
    case when c.channel_kind='field_operations'
      then c.assigned_field_officer_id else c.assigned_staff_id end,
    coalesce(s.full_name,s.username),
    (
      select case
        when nullif(btrim(m.content),'') is not null then m.content
        when cardinality(m.attachments)>0 then 'Attachment'
        else ''
      end
      from public.partner_support_messages m
      where m.conversation_id=c.id
        and coalesce(m.visibility,'customer')<>'internal'
      order by m.created_at desc
      limit 1
    ),
    (
      select m.created_at
      from public.partner_support_messages m
      where m.conversation_id=c.id
        and coalesce(m.visibility,'customer')<>'internal'
      order by m.created_at desc
      limit 1
    ),
    (
      select count(*)
      from public.partner_support_messages m
      where m.conversation_id=c.id
        and not coalesce(m.is_read,false)
        and m.sender_id<>actor.user_id
    ),
    c.created_at
  from public.partner_support_conversations c
  join public.profiles p on p.user_id=c.partner_id
  left join public.operational_cases oc
    on oc.operational_case_id=c.operational_case_id
  left join public.profiles s
    on s.user_id=case
      when c.channel_kind='field_operations' then c.assigned_field_officer_id
      else c.assigned_staff_id
    end
  where exists(
    select 1
    from public.partner_support_messages m
    where m.conversation_id=c.id
  )
    and (
      p_queue='all'
      or case
        when c.channel_kind in('reservation_operations','property_operations')
          then 'property_operations'
        when c.channel_kind='support_case' then 'support'
        else c.channel_kind
      end=v_queue
    )
    and (
      v_creator
      or public.current_actor_in_scope(
        coalesce(nullif(oc.state_scope,''),p.state),
        coalesce(nullif(p.local_government,''),p.city)
      )
    )
  order by
    case
      when c.assigned_field_officer_id=actor.user_id
        or c.assigned_staff_id=actor.user_id then 0
      when c.assigned_staff_id is null then 1
      else 2
    end,
    c.updated_at desc;
end
$$;


