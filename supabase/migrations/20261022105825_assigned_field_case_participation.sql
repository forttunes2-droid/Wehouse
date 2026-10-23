-- Field Operations remains Staff. Assignment grants participation, not case ownership.
create or replace function private.current_actor_is_assigned_field_participant(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path='' as $body$
 select public._property_document_session_active() and exists(
  select 1 from public.partner_support_conversations c
  join public.profiles actor on actor.auth_id=(select auth.uid())::text
  join public.profiles requester on requester.user_id=c.partner_id
  left join public.operational_cases o on o.operational_case_id=c.operational_case_id
  where c.id=p_conversation_id and c.assigned_field_officer_id=actor.user_id
   and actor.user_id<>c.partner_id and not coalesce(actor.deleted,false)
   and not coalesce(actor.suspended,false) and not coalesce(actor.banned,false)
   and public.user_has_active_workspace(actor.user_id,'staff')
   and public.user_has_active_workspace(actor.user_id,'field_operations')
   and public.user_workspace_covers(actor.user_id,'field_operations',
    coalesce(nullif(o.state_scope,''),nullif(c.property_state,''),requester.state),
    coalesce(nullif(c.property_city,''),nullif(requester.local_government,''),requester.city))
 );
$body$;
revoke all on function private.current_actor_is_assigned_field_participant(uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.current_actor_can_access_operational_conversation(p_conversation_id uuid, p_require_assignment boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_case public.operational_cases;
  v_domain text;
  v_state text;
  v_lga text;
  v_assigned_user_id text;
begin
  if not public._property_document_session_active() then return false;end if;
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

  if not p_require_assignment and private.current_actor_is_assigned_field_participant(p_conversation_id) then return true;end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.send_support_message(p_conversation_id uuid, p_content text DEFAULT ''::text, p_attachments text[] DEFAULT '{}'::text[], p_attachment_types text[] DEFAULT '{}'::text[], p_action_type text DEFAULT NULL::text, p_action_metadata jsonb DEFAULT '{}'::jsonb, p_visibility text DEFAULT 'customer'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_id uuid;
  v_is_requester boolean;
  v_has_case boolean;
  v_sender_role text;
  v_snapshot jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;
  select * into v_conversation from public.partner_support_conversations
  where id=p_conversation_id for update;
  if v_conversation.id is null then raise exception 'Conversation not found'; end if;

  v_is_requester:=v_actor.user_id=v_conversation.partner_id;
  if v_is_requester then
    if not public.current_actor_can_access_operational_conversation(
      p_conversation_id,false
    ) then raise exception 'Not authorised'; end if;
  elsif not (public.current_actor_can_access_operational_conversation(
    p_conversation_id,true
  ) or private.current_actor_is_assigned_field_participant(p_conversation_id)) then
    raise exception 'Claim this work before replying';
  end if;
  if p_visibility not in('customer','internal') then raise exception 'Invalid message visibility'; end if;
  if p_visibility='internal' and v_is_requester then
    raise exception 'Only the assigned WeHouse team can add internal work notes';
  end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null
     and coalesce(cardinality(p_attachments),0)=0 then
    raise exception 'Message or attachment is required';
  end if;
  if coalesce(cardinality(p_attachments),0)
     <>coalesce(cardinality(p_attachment_types),0) then
    raise exception 'Attachment metadata mismatch';
  end if;

  v_has_case:=v_conversation.operational_case_id is not null
    or v_conversation.channel_kind in('support','support_case');
  if v_has_case and v_conversation.status in('resolved','closed') then
    if v_is_requester then
      raise exception 'Choose I still need help before sending another message';
    end if;
    raise exception 'Reopen the request before sending another reply';
  end if;

  v_sender_role:=case
    when v_is_requester then coalesce(v_conversation.requester_role,v_actor.role)
    when v_actor.role='creator' then 'creator'
    when v_actor.role='admin' then 'admin'
    else 'staff'
  end;
  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,attachment_types,
    action_type,action_metadata,visibility,created_at
  ) values(
    p_conversation_id,v_actor.user_id,v_sender_role,btrim(coalesce(p_content,'')),
    coalesce(p_attachments,'{}'),coalesce(p_attachment_types,'{}'),
    case when p_action_type='message' then 'message' else null end,
    coalesce(p_action_metadata,'{}'::jsonb)
      -'booking_code'-'check_in_code'-'access_code'-'verification_code'
      -'handover_code'-'recovery_code',
    p_visibility,now()
  ) returning partner_support_messages.id into v_id;

  if v_has_case and p_visibility='customer' then
    if v_is_requester and v_conversation.status='waiting_for_user' then
      update public.partner_support_conversations
      set status='in_progress',updated_at=now() where id=p_conversation_id;
      update public.operational_cases set status='investigating',updated_at=now()
      where operational_case_id=v_conversation.operational_case_id;
      insert into public.support_case_events(
        conversation_id,event_type,actor_id,from_status,to_status,note
      ) values(p_conversation_id,'requester_replied',v_actor.user_id,
        'waiting_for_user','in_progress','The requester supplied more information.');
    elsif not v_is_requester and v_conversation.status in('open','assigned') then
      update public.partner_support_conversations
      set status='in_progress',updated_at=now() where id=p_conversation_id;
      update public.operational_cases set status='investigating',updated_at=now()
      where operational_case_id=v_conversation.operational_case_id;
      insert into public.support_case_events(
        conversation_id,event_type,actor_id,from_status,to_status,note
      ) values(p_conversation_id,'work_started',v_actor.user_id,
        v_conversation.status,'in_progress','WeHouse started reviewing this request.');
    else
      update public.partner_support_conversations set updated_at=now()
      where id=p_conversation_id;
    end if;
  elsif v_is_requester and p_visibility='customer' then
    v_snapshot:=coalesce(p_action_metadata->'context_snapshot','{}'::jsonb)
      -'booking_code'-'check_in_code'-'access_code'-'verification_code'
      -'handover_code'-'recovery_code';
    update public.partner_support_conversations set
      context_snapshot=case when v_snapshot<>'{}'::jsonb
        then context_snapshot||v_snapshot else context_snapshot end,
      updated_at=now()
    where id=p_conversation_id;
  else
    update public.partner_support_conversations set updated_at=now()
    where id=p_conversation_id;
  end if;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.claim_my_communication_case(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_case public.operational_cases;
  v_domain text;
  v_handler_name text;
  v_has_case boolean;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active WeHouse team account required'; end if;

  select * into v_conversation
  from public.partner_support_conversations
  where id=p_conversation_id
  for update;
  if v_conversation.id is null then raise exception 'Conversation not found'; end if;
  if not public.current_actor_can_access_operational_conversation(
    p_conversation_id,false
  ) or v_actor.user_id=v_conversation.partner_id then
    raise exception 'Conversation is outside your work area';
  end if;

  if v_conversation.operational_case_id is not null then
    select * into v_case from public.operational_cases
    where operational_case_id=v_conversation.operational_case_id
    for update;
  end if;
  if (v_conversation.assigned_staff_id is not null
        and v_conversation.assigned_staff_id<>v_actor.user_id)
     or (coalesce(v_case.owning_domain,public.canonical_operational_domain(v_conversation.channel_kind))='field_operations'
        and v_conversation.assigned_field_officer_id is not null
        and v_conversation.assigned_field_officer_id<>v_actor.user_id)
     or (v_case.assigned_user_id is not null
        and v_case.assigned_user_id<>v_actor.user_id) then
    raise exception 'This work is already assigned to another team member';
  end if;

  v_domain:=coalesce(
    v_case.owning_domain,
    public.canonical_operational_domain(v_conversation.channel_kind)
  );
  if not public.user_has_active_workspace(v_actor.user_id,'creator')
     and not public.user_has_active_workspace(v_actor.user_id,'admin')
     and not public.user_has_active_workspace(v_actor.user_id,v_domain) then
    raise exception 'Only the owning work area can claim this case';
  end if;

  v_has_case:=v_conversation.operational_case_id is not null
    or v_conversation.channel_kind in('support','support_case');
  v_handler_name:=coalesce(
    nullif(btrim(v_actor.full_name),''),
    nullif(btrim(v_actor.username),''),
    'A WeHouse team member'
  );

  update public.partner_support_conversations
  set assigned_staff_id=v_actor.user_id,
      assigned_field_officer_id=case when v_domain='field_operations'
        then v_actor.user_id else assigned_field_officer_id end,
      status=case when v_has_case and status='open' then 'assigned' else status end,
      updated_at=now()
  where id=p_conversation_id;

  if v_case.operational_case_id is not null then
    update public.operational_cases
    set assigned_user_id=v_actor.user_id,
        status=case when status in('open','triaged') then 'assigned' else status end,
        updated_at=now()
    where operational_case_id=v_case.operational_case_id;
  end if;

  if v_has_case and not exists(
    select 1 from public.support_case_events e
    where e.conversation_id=p_conversation_id
      and e.event_type='assigned' and e.actor_id=v_actor.user_id
  ) then
    insert into public.support_case_events(
      conversation_id,event_type,actor_id,from_status,to_status,note,metadata
    ) values(
      p_conversation_id,'assigned',v_actor.user_id,v_conversation.status,
      case when v_conversation.status='open' then 'assigned' else v_conversation.status end,
      v_handler_name||' is handling this request.',
      jsonb_build_object('handler_name',v_handler_name,'owning_domain',v_domain)
    );
    insert into public.partner_support_messages(
      conversation_id,sender_id,sender_role,content,action_type,
      action_metadata,visibility,created_at
    ) values(
      p_conversation_id,v_actor.user_id,
      case when v_actor.role in('admin','creator') then v_actor.role else 'staff' end,
      v_handler_name||' is handling this '
        ||replace(coalesce(v_domain,'WeHouse'),'_operations','')||' request.',
      'status_change',jsonb_build_object(
        'event_type','assigned','from_status',v_conversation.status,
        'to_status',case when v_conversation.status='open' then 'assigned'
          else v_conversation.status end,
        'actor_name',v_handler_name,'owning_domain',v_domain
      ),'customer',now()
    );
  end if;

  if v_case.operational_case_id is not null then
    insert into public.operational_case_events(
      operational_case_id,event_key,event_type,from_status,to_status,
      actor_user_id,public_note,metadata
    ) values(
      v_case.operational_case_id,
      'case_assigned:'||v_case.operational_case_id||':'||v_actor.user_id,
      'assigned',v_case.status,
      case when v_case.status in('open','triaged') then 'assigned' else v_case.status end,
      v_actor.user_id,v_handler_name||' is handling this request.',
      jsonb_build_object('owning_domain',v_domain)
    ) on conflict(event_key) do nothing;
  end if;
  return true;
end
$function$;
-- Operational case ownership routes a case; the shared message channel does not.
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
    c.context_snapshot||jsonb_build_object('field_assignee_id',c.assigned_field_officer_id),
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
      or coalesce(nullif(oc.owning_domain,''),public.canonical_operational_domain(c.channel_kind))=v_queue
      or (v_queue='field_operations' and c.assigned_field_officer_id is not null
          and (v_creator or v_admin or private.current_actor_is_assigned_field_participant(c.id)))
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




