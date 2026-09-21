-- Make operational communication scope follow workspace grants exactly.
-- State grants cover the full State; branch grants cover one LGA only.

begin;

create or replace function public.current_actor_can_access_operational_conversation(
  p_conversation_id uuid,
  p_require_assignment boolean default false
)
returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_case public.operational_cases;
  v_domain text;
  v_state text;
  v_lga text;
  v_assigned_user_id text;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then return false; end if;

  select * into v_conversation
  from public.partner_support_conversations
  where id=p_conversation_id;
  if v_conversation.id is null then return false; end if;

  if v_actor.user_id=v_conversation.partner_id then
    return not p_require_assignment;
  end if;

  if v_conversation.operational_case_id is not null then
    select * into v_case
    from public.operational_cases
    where operational_case_id=v_conversation.operational_case_id;
  end if;

  v_domain:=coalesce(
    v_case.owning_domain,
    public.canonical_operational_domain(v_conversation.channel_kind)
  );

  select
    coalesce(nullif(btrim(v_case.state_scope),''),nullif(btrim(p.state),'')),
    coalesce(nullif(btrim(p.local_government),''),nullif(btrim(p.city),''))
  into v_state,v_lga
  from public.profiles p
  where p.user_id=v_conversation.partner_id;

  v_assigned_user_id:=coalesce(
    v_case.assigned_user_id,
    v_conversation.assigned_staff_id,
    v_conversation.assigned_field_officer_id
  );

  if p_require_assignment and v_assigned_user_id is distinct from v_actor.user_id then
    return false;
  end if;

  if public.user_has_active_workspace(v_actor.user_id,'creator') then
    return true;
  end if;

  if public.user_has_active_workspace(v_actor.user_id,'admin') then
    return public.current_actor_in_scope(v_state,v_lga);
  end if;

  if public.user_has_active_workspace(v_actor.user_id,'staff') then
    return v_domain is not null
      and public.user_has_active_workspace(v_actor.user_id,v_domain)
      and public.current_actor_in_scope(v_state,v_lga);
  end if;

  return false;
end
$$;

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

revoke all on function public.current_actor_can_access_operational_conversation(uuid,boolean)
  from public,anon;
grant execute on function public.current_actor_can_access_operational_conversation(uuid,boolean)
  to authenticated,service_role;
revoke all on function public.support_inbox(text) from public,anon;
grant execute on function public.support_inbox(text) to authenticated,service_role;

commit;
