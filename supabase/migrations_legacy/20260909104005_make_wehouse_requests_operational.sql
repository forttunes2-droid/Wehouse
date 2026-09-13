-- Make WeHouse conversations operational cases instead of direction-labelled chat.

alter table public.partner_support_conversations
  drop constraint if exists partner_support_conversations_status_check;

alter table public.partner_support_conversations
  add constraint partner_support_conversations_status_check
  check (status in (
    'open',
    'assigned',
    'in_progress',
    'waiting_for_user',
    'escalated',
    'resolved',
    'closed'
  ));

alter table public.support_case_events
  drop constraint if exists support_case_events_event_type_check;

alter table public.support_case_events
  add constraint support_case_events_event_type_check
  check (event_type in (
    'assigned',
    'work_started',
    'information_requested',
    'requester_replied',
    'escalated',
    'resolved',
    'resolution_accepted',
    'closed',
    'reopened'
  ));

-- Reopening is explicit below, so the legacy automatic event would duplicate it.
drop trigger if exists partner_support_log_reopen
on public.partner_support_conversations;
revoke all on function public.log_automatic_support_reopen()
from public,anon,authenticated;

create or replace function public.notify_support_case_message()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_case public.partner_support_conversations;
  v_recipient text;
  v_sender_is_requester boolean;
  v_target_status text;
  v_title text;
begin
  select * into v_case
  from public.partner_support_conversations
  where id=new.conversation_id;

  if v_case.id is null then return new; end if;

  v_sender_is_requester:=new.sender_id=v_case.partner_id;
  v_target_status:=coalesce(new.action_metadata->>'to_status','');
  v_recipient:=case
    when v_sender_is_requester then coalesce(v_case.assigned_field_officer_id,v_case.assigned_staff_id)
    else v_case.partner_id
  end;

  v_title:=case
    when v_sender_is_requester and new.action_metadata->>'event_type'='resolution_accepted'
      then 'Requester confirmed this is solved'
    when v_sender_is_requester and new.action_metadata->>'event_type'='reopened'
      then 'Requester still needs help'
    when v_sender_is_requester then 'Request reply needs attention'
    when new.action_type='status_change' and v_target_status='assigned'
      then 'WeHouse is handling your request'
    when new.action_type='status_change' and v_target_status='waiting_for_user'
      then 'WeHouse needs information from you'
    when new.action_type='status_change' and v_target_status='escalated'
      then 'Your request was escalated'
    when new.action_type='status_change' and v_target_status='resolved'
      then 'WeHouse resolved your request'
    when new.action_type='status_change' and v_target_status='closed'
      then 'Your request was closed'
    else 'WeHouse replied to your request'
  end;

  if v_recipient is not null and v_recipient<>new.sender_id then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key
    ) values(
      v_recipient,'support_case_message',v_title,
      coalesce(nullif(btrim(new.content),''),'New attachment'),v_case.id::text,
      'wehouse_case',v_case.id::text,'conversation',
      jsonb_build_object(
        'conversation_id',v_case.id,
        'context_type',v_case.context_type,
        'context_id',v_case.context_id
      ),
      'support-message:'||new.id::text
    ) on conflict do nothing;
  end if;

  return new;
end;
$function$;

revoke all on function public.notify_support_case_message() from public,anon,authenticated;

create or replace function public.claim_my_communication_case(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor public.profiles;
  current_case public.partner_support_conversations;
  owner_state text;
  owner_lga text;
  required_permission text;
  handler_name text;
begin
  select * into actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and role='staff'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if actor.user_id is null then raise exception 'Active Staff account required'; end if;

  select c.* into current_case
  from public.partner_support_conversations c
  where c.id=p_conversation_id
  for update of c;
  if current_case.id is null then raise exception 'Conversation not found'; end if;

  select p.state,coalesce(nullif(p.local_government,''),p.city)
  into owner_state,owner_lga
  from public.profiles p
  where p.user_id=current_case.partner_id;

  if lower(btrim(coalesce(actor.assigned_state,'')))<>lower(btrim(coalesce(owner_state,'')))
     or lower(btrim(coalesce(actor.assigned_lga,'')))<>lower(btrim(coalesce(owner_lga,''))) then
    raise exception 'Conversation is outside your branch';
  end if;

  required_permission:=case
    when current_case.channel_kind in ('property_operations','reservation_operations') then 'operations'
    when current_case.channel_kind='field_operations' then 'field_officer'
    else 'support'
  end;
  if not public.current_staff_has_permission(required_permission) then
    raise exception 'Conversation is outside your work area';
  end if;

  if current_case.channel_kind='field_operations' then
    if current_case.assigned_field_officer_id is distinct from actor.user_id then
      raise exception 'Only the assigned Field Officer can open this request';
    end if;
    return true;
  end if;

  if current_case.assigned_staff_id is not null
     and current_case.assigned_staff_id<>actor.user_id then
    raise exception 'This request is already assigned to another team member';
  end if;

  if current_case.assigned_staff_id is null then
    update public.partner_support_conversations
    set assigned_staff_id=actor.user_id,
        status=case when status='open' then 'assigned' else status end,
        updated_at=now()
    where id=p_conversation_id;

    handler_name:=coalesce(nullif(btrim(actor.full_name),''),nullif(btrim(actor.username),''),'A WeHouse team member');

    insert into public.support_case_events(
      conversation_id,event_type,actor_id,from_status,to_status,note,metadata
    ) values(
      p_conversation_id,'assigned',actor.user_id,current_case.status,
      case when current_case.status='open' then 'assigned' else current_case.status end,
      handler_name||' is handling this request.',
      jsonb_build_object('handler_name',handler_name)
    );

    insert into public.partner_support_messages(
      conversation_id,sender_id,sender_role,content,action_type,action_metadata,created_at
    ) values(
      p_conversation_id,actor.user_id,'staff',
      handler_name||' from WeHouse is now handling your request.',
      'status_change',
      jsonb_build_object(
        'event_type','assigned',
        'from_status',current_case.status,
        'to_status',case when current_case.status='open' then 'assigned' else current_case.status end,
        'actor_name',handler_name
      ),
      now()
    );
  end if;

  return true;
end;
$function$;

revoke all on function public.claim_my_communication_case(uuid) from public,anon;
grant execute on function public.claim_my_communication_case(uuid) to authenticated,service_role;

create or replace function public.send_support_message(
  p_conversation_id uuid,
  p_content text default '',
  p_attachments text[] default '{}',
  p_attachment_types text[] default '{}',
  p_action_type text default null,
  p_action_metadata jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_case public.partner_support_conversations;
  v_id uuid;
  v_sender_role text;
  v_context_id text;
  v_snapshot jsonb;
  v_is_requester boolean;
  v_safe_action_type text;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;

  select * into v_case
  from public.partner_support_conversations
  where id=p_conversation_id
  for update;
  if v_case.id is null then raise exception 'Conversation not found'; end if;

  v_is_requester:=v_actor.user_id=v_case.partner_id;
  if not (
    v_is_requester
    or v_actor.user_id=v_case.assigned_staff_id
    or v_actor.user_id=v_case.assigned_field_officer_id
    or v_actor.role in ('admin','creator')
  ) then raise exception 'Not authorised'; end if;

  if v_case.status in ('resolved','closed') then
    if v_is_requester then
      raise exception 'Choose I still need help before sending another message';
    end if;
    raise exception 'Reopen the request before sending another reply';
  end if;

  if nullif(btrim(coalesce(p_content,'')),'') is null
     and coalesce(cardinality(p_attachments),0)=0 then
    raise exception 'Message or attachment is required';
  end if;
  if coalesce(cardinality(p_attachments),0)<>coalesce(cardinality(p_attachment_types),0) then
    raise exception 'Attachment metadata mismatch';
  end if;

  v_sender_role:=case
    when v_is_requester then coalesce(v_case.requester_role,v_actor.role)
    when v_actor.user_id=v_case.assigned_field_officer_id then 'field_officer'
    when v_actor.role='creator' then 'creator'
    when v_actor.role='admin' then 'admin'
    else 'staff'
  end;
  v_safe_action_type:=case when p_action_type='message' then 'message' else null end;

  if v_is_requester and v_case.status='waiting_for_user' then
    update public.partner_support_conversations
    set status='in_progress',updated_at=now()
    where id=p_conversation_id;
    insert into public.support_case_events(
      conversation_id,event_type,actor_id,from_status,to_status,note
    ) values(
      p_conversation_id,'requester_replied',v_actor.user_id,'waiting_for_user','in_progress',
      'The requester supplied more information.'
    );
  elsif not v_is_requester and v_case.status in ('open','assigned') then
    update public.partner_support_conversations
    set status='in_progress',updated_at=now()
    where id=p_conversation_id;
    insert into public.support_case_events(
      conversation_id,event_type,actor_id,from_status,to_status,note
    ) values(
      p_conversation_id,'work_started',v_actor.user_id,v_case.status,'in_progress',
      'WeHouse started working on this request.'
    );
  end if;

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,attachment_types,
    action_type,action_metadata,created_at
  ) values(
    p_conversation_id,v_actor.user_id,v_sender_role,coalesce(btrim(p_content),''),
    coalesce(p_attachments,'{}'),coalesce(p_attachment_types,'{}'),
    v_safe_action_type,coalesce(p_action_metadata,'{}'::jsonb),now()
  ) returning id into v_id;

  if v_is_requester then
    v_context_id:=nullif(btrim(coalesce(p_action_metadata->>'context_id','')),'');
    v_snapshot:=coalesce(p_action_metadata->'context_snapshot','{}'::jsonb);
    update public.partner_support_conversations
    set updated_at=now(),
        category=coalesce(nullif(btrim(coalesce(p_action_metadata->>'category','')),''),category),
        context_type=coalesce(
          nullif(btrim(coalesce(p_action_metadata->>'context_type','')),''),
          context_type
        ),
        context_id=coalesce(v_context_id,context_id),
        context_snapshot=case
          when v_snapshot<>'{}'::jsonb then v_snapshot
          else context_snapshot
        end
    where id=p_conversation_id;
  else
    update public.partner_support_conversations set updated_at=now() where id=p_conversation_id;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.send_support_message(uuid,text,text[],text[],text,jsonb) from public,anon;
grant execute on function public.send_support_message(uuid,text,text[],text[],text,jsonb) to authenticated,service_role;

create or replace function public.transition_my_support_case(
  p_conversation_id uuid,
  p_action text,
  p_note text default null
)
returns public.partner_support_conversations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor public.profiles;
  current_case public.partner_support_conversations;
  result public.partner_support_conversations;
  assigned_handler text;
  required_permission text;
  next_status text;
  event_name text;
  public_message text;
  clean_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  select * into actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if actor.user_id is null or actor.role not in ('staff','admin','creator') then
    raise exception 'Active WeHouse team account required';
  end if;

  select * into current_case
  from public.partner_support_conversations
  where id=p_conversation_id
  for update;
  if current_case.id is null then raise exception 'Request not found'; end if;

  assigned_handler:=case
    when current_case.channel_kind='field_operations' then current_case.assigned_field_officer_id
    else current_case.assigned_staff_id
  end;

  if actor.role='staff' then
    if assigned_handler is distinct from actor.user_id then
      raise exception 'Only the assigned team member can update this request';
    end if;
    required_permission:=case
      when current_case.channel_kind in ('property_operations','reservation_operations') then 'operations'
      when current_case.channel_kind='field_operations' then 'field_officer'
      else 'support'
    end;
    if not public.current_staff_has_permission(required_permission) then
      raise exception 'Request is outside your Staff responsibility';
    end if;
  end if;

  if p_action='start' then
    if current_case.status not in ('open','assigned') then
      raise exception 'Only a new or assigned request can be started';
    end if;
    next_status:='in_progress';
    event_name:='work_started';
    public_message:='WeHouse has started working on your request.';
  elsif p_action='request_info' then
    if current_case.status not in ('assigned','in_progress','escalated') then
      raise exception 'Information can only be requested while work is active';
    end if;
    if clean_note is null then raise exception 'Say exactly what information is needed'; end if;
    next_status:='waiting_for_user';
    event_name:='information_requested';
    public_message:='WeHouse needs information from you:'||E'\n\n'||clean_note;
  elsif p_action='escalate' then
    if current_case.status not in ('assigned','in_progress','waiting_for_user') then
      raise exception 'This request cannot be escalated from its current state';
    end if;
    if clean_note is null then raise exception 'An escalation reason is required'; end if;
    next_status:='escalated';
    event_name:='escalated';
    public_message:='WeHouse escalated your request for additional review:'||E'\n\n'||clean_note;
  elsif p_action='resolve' then
    if current_case.status not in ('assigned','in_progress','waiting_for_user','escalated') then
      raise exception 'Only active work can be resolved';
    end if;
    if clean_note is null then raise exception 'Explain the outcome before resolving this request'; end if;
    next_status:='resolved';
    event_name:='resolved';
    public_message:='WeHouse marked your request as resolved:'||E'\n\n'||clean_note;
  elsif p_action='close' then
    if current_case.status<>'resolved' then raise exception 'Resolve the request before closing it'; end if;
    next_status:='closed';
    event_name:='closed';
    public_message:='WeHouse closed this request after resolution.';
  else
    raise exception 'Unsupported request action';
  end if;

  update public.partner_support_conversations
  set status=next_status,
      priority=case when p_action='escalate' then 'high' else priority end,
      resolved_at=case
        when p_action='resolve' then now()
        when next_status not in ('resolved','closed') then null
        else resolved_at
      end,
      closed_at=case
        when p_action='close' then now()
        when next_status<>'closed' then null
        else closed_at
      end,
      updated_at=now()
  where id=p_conversation_id
  returning * into result;

  insert into public.support_case_events(
    conversation_id,event_type,actor_id,from_status,to_status,note,metadata
  ) values(
    p_conversation_id,event_name,actor.user_id,current_case.status,next_status,clean_note,
    jsonb_build_object(
      'actor_name',coalesce(nullif(btrim(actor.full_name),''),nullif(btrim(actor.username),''),'WeHouse'),
      'actor_role',actor.role
    )
  );

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,action_type,action_metadata,created_at
  ) values(
    p_conversation_id,actor.user_id,
    case when actor.role in ('admin','creator') then actor.role else 'staff' end,
    public_message,'status_change',
    jsonb_build_object(
      'event_type',event_name,
      'from_status',current_case.status,
      'to_status',next_status,
      'note',clean_note,
      'actor_name',coalesce(nullif(btrim(actor.full_name),''),nullif(btrim(actor.username),''),'WeHouse')
    ),
    now()
  );

  return result;
end;
$function$;

revoke all on function public.transition_my_support_case(uuid,text,text) from public,anon;
grant execute on function public.transition_my_support_case(uuid,text,text) to authenticated,service_role;

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

create or replace function public.complete_my_support_case(p_conversation_id uuid)
returns public.partner_support_conversations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor public.profiles;
  current_case public.partner_support_conversations;
  result public.partner_support_conversations;
begin
  select * into actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if actor.user_id is null then raise exception 'Authentication required'; end if;

  select * into current_case
  from public.partner_support_conversations
  where id=p_conversation_id
  for update;
  if current_case.id is null or current_case.partner_id<>actor.user_id then
    raise exception 'Request not found';
  end if;
  if current_case.status<>'resolved' then
    raise exception 'Only a resolved request can be confirmed as solved';
  end if;

  update public.partner_support_conversations
  set status='closed',closed_at=now(),updated_at=now()
  where id=p_conversation_id
  returning * into result;

  insert into public.support_case_events(
    conversation_id,event_type,actor_id,from_status,to_status,note
  ) values(
    p_conversation_id,'resolution_accepted',actor.user_id,'resolved','closed',
    'The requester confirmed this is solved.'
  );

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,action_type,action_metadata,created_at
  ) values(
    p_conversation_id,actor.user_id,coalesce(current_case.requester_role,actor.role),
    'This solved my request.','status_change',
    jsonb_build_object(
      'event_type','resolution_accepted',
      'from_status','resolved',
      'to_status','closed'
    ),now()
  );

  return result;
end;
$function$;

revoke all on function public.complete_my_support_case(uuid) from public,anon;
grant execute on function public.complete_my_support_case(uuid) to authenticated,service_role;

create or replace function public.reopen_my_support_case(
  p_conversation_id uuid,
  p_note text default null
)
returns public.partner_support_conversations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor public.profiles;
  current_case public.partner_support_conversations;
  result public.partner_support_conversations;
  next_status text;
  clean_note text:=coalesce(nullif(btrim(coalesce(p_note,'')),''),'I still need help with this request.');
begin
  select * into actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if actor.user_id is null then raise exception 'Authentication required'; end if;

  select * into current_case
  from public.partner_support_conversations
  where id=p_conversation_id
  for update;
  if current_case.id is null or current_case.partner_id<>actor.user_id then
    raise exception 'Request not found';
  end if;
  if current_case.status not in ('resolved','closed') then
    raise exception 'This request is already active';
  end if;

  next_status:=case
    when coalesce(current_case.assigned_field_officer_id,current_case.assigned_staff_id) is null then 'open'
    else 'in_progress'
  end;

  update public.partner_support_conversations
  set status=next_status,resolved_at=null,closed_at=null,updated_at=now()
  where id=p_conversation_id
  returning * into result;

  insert into public.support_case_events(
    conversation_id,event_type,actor_id,from_status,to_status,note
  ) values(
    p_conversation_id,'reopened',actor.user_id,current_case.status,next_status,clean_note
  );

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,action_type,action_metadata,created_at
  ) values(
    p_conversation_id,actor.user_id,coalesce(current_case.requester_role,actor.role),
    clean_note,'status_change',
    jsonb_build_object(
      'event_type','reopened',
      'from_status',current_case.status,
      'to_status',next_status
    ),now()
  );

  return result;
end;
$function$;

revoke all on function public.reopen_my_support_case(uuid,text) from public,anon;
grant execute on function public.reopen_my_support_case(uuid,text) to authenticated,service_role;
