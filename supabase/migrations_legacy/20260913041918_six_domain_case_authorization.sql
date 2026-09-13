-- Make communication access follow the six canonical operational domains.
-- Queue visibility is domain/state scoped. Assignment records ownership but
-- does not hide a record from other authorised members of the same queue.

create or replace function public.canonical_operational_domain(p_channel text)
returns text
language sql
immutable
security invoker
set search_path to 'pg_catalog','public'
as $$
  select case p_channel
    when 'operations' then 'property_operations'
    when 'reservation_operations' then 'property_operations'
    when 'property_operations' then 'property_operations'
    when 'field_operations' then 'field_operations'
    when 'worker_operations' then 'worker_operations'
    when 'finance_operations' then 'finance_operations'
    when 'security_operations' then 'security_operations'
    when 'support_case' then 'support'
    when 'support' then 'support'
    else null
  end
$$;

create or replace function public.current_actor_can_access_operational_conversation(
  p_conversation_id uuid,
  p_require_assignment boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_case public.operational_cases;
  v_domain text;
  v_state text;
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
    select * into v_case from public.operational_cases
    where operational_case_id=v_conversation.operational_case_id;
  end if;
  v_domain:=coalesce(
    v_case.owning_domain,
    public.canonical_operational_domain(v_conversation.channel_kind)
  );
  select coalesce(nullif(btrim(v_case.state_scope),''),nullif(btrim(p.state),''))
  into v_state
  from public.profiles p where p.user_id=v_conversation.partner_id;
  v_assigned_user_id:=coalesce(
    v_case.assigned_user_id,
    v_conversation.assigned_staff_id,
    v_conversation.assigned_field_officer_id
  );

  if p_require_assignment and v_assigned_user_id is distinct from v_actor.user_id then
    return false;
  end if;

  if public.current_actor_has_workspace('creator',null) then return true; end if;

  if v_actor.role='admin' then
    return nullif(btrim(coalesce(v_state,'')),'') is not null
      and public.current_actor_has_workspace('admin',v_state);
  end if;

  if v_actor.role='staff' then
    return v_domain is not null
      and nullif(btrim(coalesce(v_state,'')),'') is not null
      and public.current_actor_has_workspace(v_domain,v_state);
  end if;
  return false;
end
$$;

create or replace function private.can_access_support_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public','private'
as $$
  select public.current_actor_can_access_operational_conversation(
    p_conversation_id,false
  )
$$;

create or replace function public.claim_my_communication_case(
  p_conversation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
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
     or (v_conversation.assigned_field_officer_id is not null
        and v_conversation.assigned_field_officer_id<>v_actor.user_id)
     or (v_case.assigned_user_id is not null
        and v_case.assigned_user_id<>v_actor.user_id) then
    raise exception 'This work is already assigned to another team member';
  end if;

  v_domain:=coalesce(
    v_case.owning_domain,
    public.canonical_operational_domain(v_conversation.channel_kind)
  );
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
$$;

create or replace function public.get_support_messages(p_conversation_id uuid)
returns table(
  id uuid,sender_id text,sender_name text,sender_role text,content text,
  attachments text[],attachment_types text[],action_type text,
  action_metadata jsonb,visibility text,is_read boolean,created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_team boolean;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;
  select * into v_conversation from public.partner_support_conversations
  where id=p_conversation_id;
  if v_conversation.id is null then raise exception 'Conversation not found'; end if;
  if not public.current_actor_can_access_operational_conversation(
    p_conversation_id,false
  ) then raise exception 'Not authorised'; end if;
  v_team:=v_actor.user_id<>v_conversation.partner_id;

  return query
  select m.id,m.sender_id,coalesce(p.full_name,p.username,'WeHouse'),
    m.sender_role,m.content,m.attachments,m.attachment_types,m.action_type,
    coalesce(m.action_metadata,'{}'::jsonb),m.visibility,m.is_read,m.created_at
  from public.partner_support_messages m
  left join public.profiles p on p.user_id=m.sender_id
  where m.conversation_id=p_conversation_id
    and (m.visibility='customer' or v_team)
  order by m.created_at;
end
$$;

create or replace function public.send_support_message(
  p_conversation_id uuid,
  p_content text default '',
  p_attachments text[] default '{}',
  p_attachment_types text[] default '{}',
  p_action_type text default null,
  p_action_metadata jsonb default '{}',
  p_visibility text default 'customer'
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
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
  elsif not public.current_actor_can_access_operational_conversation(
    p_conversation_id,true
  ) then
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
$$;

create or replace function public.transition_my_support_case(
  p_conversation_id uuid,p_action text,p_note text default null
)
returns public.partner_support_conversations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_result public.partner_support_conversations;
  v_next_status text;
  v_case_status text;
  v_event text;
  v_public_message text;
  v_clean_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active WeHouse team account required'; end if;
  select * into v_conversation from public.partner_support_conversations
  where id=p_conversation_id for update;
  if v_conversation.id is null then raise exception 'Request not found'; end if;
  if v_conversation.operational_case_id is null
     and v_conversation.channel_kind not in('support','support_case') then
    raise exception 'This is a record conversation, not a case';
  end if;
  if not public.current_actor_can_access_operational_conversation(
    p_conversation_id,true
  ) then raise exception 'Only the assigned team member can update this request'; end if;

  if p_action='start' then
    if v_conversation.status not in('open','assigned') then raise exception 'This request cannot be started from its current state'; end if;
    v_next_status:='in_progress'; v_case_status:='investigating';
    v_event:='work_started'; v_public_message:='WeHouse has started reviewing your request.';
  elsif p_action='request_info' then
    if v_conversation.status not in('assigned','in_progress','escalated') then raise exception 'Information can only be requested while work is active'; end if;
    if v_clean_note is null then raise exception 'Say exactly what information is needed'; end if;
    v_next_status:='waiting_for_user'; v_case_status:='waiting_customer';
    v_event:='information_requested';
    v_public_message:='WeHouse needs information from you:'||E'\n\n'||v_clean_note;
  elsif p_action='escalate' then
    if v_conversation.status not in('assigned','in_progress','waiting_for_user') then raise exception 'This request cannot be escalated from its current state'; end if;
    if v_clean_note is null then raise exception 'An escalation reason is required'; end if;
    v_next_status:='escalated'; v_case_status:='investigating';
    v_event:='escalated';
    v_public_message:='WeHouse escalated your request for additional review:'||E'\n\n'||v_clean_note;
  elsif p_action='resolve' then
    if v_conversation.status not in('assigned','in_progress','waiting_for_user','escalated') then raise exception 'Only active work can be resolved'; end if;
    if v_clean_note is null then raise exception 'Explain the outcome before resolving this request'; end if;
    v_next_status:='resolved'; v_case_status:='resolved';
    v_event:='resolved';
    v_public_message:='WeHouse marked your request as resolved:'||E'\n\n'||v_clean_note;
  elsif p_action='close' then
    if v_conversation.status<>'resolved' then raise exception 'Resolve the request before closing it'; end if;
    v_next_status:='closed'; v_case_status:='closed';
    v_event:='closed'; v_public_message:='WeHouse closed this request after resolution.';
  else
    raise exception 'Unsupported request action';
  end if;

  update public.partner_support_conversations set
    status=v_next_status,
    priority=case when p_action='escalate' then 'high' else priority end,
    resolved_at=case when p_action='resolve' then now()
      when v_next_status not in('resolved','closed') then null else resolved_at end,
    closed_at=case when p_action='close' then now()
      when v_next_status<>'closed' then null else closed_at end,
    updated_at=now()
  where id=p_conversation_id returning * into v_result;

  update public.operational_cases set
    status=v_case_status,
    priority=case when p_action='escalate' then 'high' else priority end,
    resolution_summary=case when p_action='resolve' then v_clean_note else resolution_summary end,
    resolved_at=case when p_action='resolve' then now()
      when v_case_status not in('resolved','closed') then null else resolved_at end,
    closed_at=case when p_action='close' then now()
      when v_case_status<>'closed' then null else closed_at end,
    updated_at=now()
  where operational_case_id=v_conversation.operational_case_id;

  insert into public.support_case_events(
    conversation_id,event_type,actor_id,from_status,to_status,note,metadata
  ) values(p_conversation_id,v_event,v_actor.user_id,v_conversation.status,
    v_next_status,v_clean_note,jsonb_build_object('actor_role',v_actor.role));
  if v_conversation.operational_case_id is not null then
    insert into public.operational_case_events(
      operational_case_id,event_key,event_type,from_status,to_status,
      actor_user_id,public_note,metadata
    ) values(
      v_conversation.operational_case_id,
      'case_transition:'||v_conversation.operational_case_id||':'||v_event||':'
        ||extract(epoch from clock_timestamp())::text,
      v_event,null,v_case_status,v_actor.user_id,v_clean_note,
      jsonb_build_object('legacy_from_status',v_conversation.status,
        'legacy_to_status',v_next_status)
    );
  end if;
  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,action_type,
    action_metadata,visibility,created_at
  ) values(
    p_conversation_id,v_actor.user_id,
    case when v_actor.role in('admin','creator') then v_actor.role else 'staff' end,
    v_public_message,'status_change',jsonb_build_object(
      'event_type',v_event,'from_status',v_conversation.status,
      'to_status',v_next_status,'note',v_clean_note
    ),'customer',now()
  );
  if v_next_status='closed' and v_conversation.canonical_thread_id is not null then
    update public.canonical_threads set state='closed',closed_at=now(),updated_at=now()
    where thread_id=v_conversation.canonical_thread_id;
  end if;
  return v_result;
end
$$;

create or replace function public.get_my_support_case_events(
  p_conversation_id uuid
)
returns table(
  id uuid,event_type text,actor_id text,actor_name text,actor_role text,
  from_status text,to_status text,note text,metadata jsonb,created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if not public.current_actor_can_access_operational_conversation(
    p_conversation_id,false
  ) then raise exception 'Not authorised'; end if;
  return query
  select e.id,e.event_type,e.actor_id,
    coalesce(p.full_name,p.username,e.metadata->>'actor_name','WeHouse'),p.role,
    e.from_status,e.to_status,e.note,coalesce(e.metadata,'{}'::jsonb),e.created_at
  from public.support_case_events e
  left join public.profiles p on p.user_id=e.actor_id
  where e.conversation_id=p_conversation_id
  order by e.created_at;
end
$$;

create or replace function public.complete_my_support_case(
  p_conversation_id uuid
)
returns public.partner_support_conversations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_result public.partner_support_conversations;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  select * into v_conversation from public.partner_support_conversations
  where id=p_conversation_id for update;
  if v_actor.user_id is null or v_conversation.id is null
     or v_conversation.partner_id<>v_actor.user_id then raise exception 'Request not found'; end if;
  if v_conversation.status<>'resolved' then raise exception 'Only a resolved request can be confirmed as solved'; end if;
  update public.partner_support_conversations set status='closed',closed_at=now(),updated_at=now()
  where id=p_conversation_id returning * into v_result;
  update public.operational_cases set status='closed',closed_at=now(),updated_at=now()
  where operational_case_id=v_conversation.operational_case_id;
  insert into public.support_case_events(
    conversation_id,event_type,actor_id,from_status,to_status,note
  ) values(p_conversation_id,'resolution_accepted',v_actor.user_id,
    'resolved','closed','The requester confirmed this is solved.');
  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,action_type,
    action_metadata,visibility,created_at
  ) values(p_conversation_id,v_actor.user_id,
    coalesce(v_conversation.requester_role,v_actor.role),'This solved my request.',
    'status_change',jsonb_build_object('event_type','resolution_accepted',
      'from_status','resolved','to_status','closed'),'customer',now());
  if v_conversation.canonical_thread_id is not null then
    update public.canonical_threads set state='closed',closed_at=now(),updated_at=now()
    where thread_id=v_conversation.canonical_thread_id;
  end if;
  return v_result;
end
$$;

create or replace function public.reopen_my_support_case(
  p_conversation_id uuid,p_note text default null
)
returns public.partner_support_conversations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_result public.partner_support_conversations;
  v_next_status text;
  v_case_status text;
  v_note text:=coalesce(nullif(btrim(coalesce(p_note,'')),''),
    'I still need help with this request.');
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  select * into v_conversation from public.partner_support_conversations
  where id=p_conversation_id for update;
  if v_actor.user_id is null or v_conversation.id is null
     or v_conversation.partner_id<>v_actor.user_id then raise exception 'Request not found'; end if;
  if v_conversation.status not in('resolved','closed') then raise exception 'This request is already active'; end if;
  v_next_status:=case when coalesce(v_conversation.assigned_staff_id,
    v_conversation.assigned_field_officer_id) is null then 'open' else 'in_progress' end;
  v_case_status:=case when v_next_status='open' then 'open' else 'investigating' end;
  update public.partner_support_conversations set status=v_next_status,
    resolved_at=null,closed_at=null,updated_at=now()
  where id=p_conversation_id returning * into v_result;
  update public.operational_cases set status=v_case_status,resolved_at=null,
    closed_at=null,updated_at=now()
  where operational_case_id=v_conversation.operational_case_id;
  insert into public.support_case_events(
    conversation_id,event_type,actor_id,from_status,to_status,note
  ) values(p_conversation_id,'reopened',v_actor.user_id,
    v_conversation.status,v_next_status,v_note);
  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,action_type,
    action_metadata,visibility,created_at
  ) values(p_conversation_id,v_actor.user_id,
    coalesce(v_conversation.requester_role,v_actor.role),v_note,
    'status_change',jsonb_build_object('event_type','reopened',
      'from_status',v_conversation.status,'to_status',v_next_status),
    'customer',now());
  if v_conversation.canonical_thread_id is not null then
    update public.canonical_threads set state='open',closed_at=null,updated_at=now()
    where thread_id=v_conversation.canonical_thread_id;
  end if;
  return v_result;
end
$$;

revoke all on function public.canonical_operational_domain(text) from public,anon;
revoke all on function public.current_actor_can_access_operational_conversation(uuid,boolean) from public,anon;
revoke all on function private.can_access_support_conversation(uuid) from public,anon,authenticated;
revoke all on function public.claim_my_communication_case(uuid) from public,anon;
revoke all on function public.get_support_messages(uuid) from public,anon;
revoke all on function public.send_support_message(uuid,text,text[],text[],text,jsonb,text) from public,anon;
revoke all on function public.transition_my_support_case(uuid,text,text) from public,anon;
revoke all on function public.get_my_support_case_events(uuid) from public,anon;
revoke all on function public.complete_my_support_case(uuid) from public,anon;
revoke all on function public.reopen_my_support_case(uuid,text) from public,anon;
grant execute on function public.canonical_operational_domain(text) to authenticated,service_role;
grant execute on function public.current_actor_can_access_operational_conversation(uuid,boolean) to authenticated,service_role;
grant execute on function private.can_access_support_conversation(uuid) to authenticated;
grant execute on function public.claim_my_communication_case(uuid) to authenticated,service_role;
grant execute on function public.get_support_messages(uuid) to authenticated,service_role;
grant execute on function public.send_support_message(uuid,text,text[],text[],text,jsonb,text) to authenticated,service_role;
grant execute on function public.transition_my_support_case(uuid,text,text) to authenticated,service_role;
grant execute on function public.get_my_support_case_events(uuid) to authenticated,service_role;
grant execute on function public.complete_my_support_case(uuid) to authenticated,service_role;
grant execute on function public.reopen_my_support_case(uuid,text) to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  'approved_client_rpc',
  'Six-domain, state-scoped case/conversation boundary reviewed 2026-09-13.',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'current_actor_can_access_operational_conversation',
  'claim_my_communication_case','get_support_messages','send_support_message',
  'transition_my_support_case','get_my_support_case_events',
  'complete_my_support_case','reopen_my_support_case'
)
on conflict(function_signature) do update set
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,
  captured_at=excluded.captured_at;
