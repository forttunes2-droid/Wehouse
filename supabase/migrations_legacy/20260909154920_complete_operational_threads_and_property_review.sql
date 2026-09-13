-- Keep operational conversations attached to their records, provide private
-- work notes, and make Field Operations evidence an explicit review step.

alter table public.partner_support_messages
  add column if not exists visibility text not null default 'customer';

alter table public.partner_support_messages
  drop constraint if exists partner_support_messages_visibility_check;
alter table public.partner_support_messages
  add constraint partner_support_messages_visibility_check
  check (visibility in ('customer','internal'));

drop function if exists public.get_support_messages(uuid);
create function public.get_support_messages(p_conversation_id uuid)
returns table(
  id uuid,
  sender_id text,
  sender_name text,
  sender_role text,
  content text,
  attachments text[],
  attachment_types text[],
  action_type text,
  action_metadata jsonb,
  visibility text,
  is_read boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_conv public.partner_support_conversations;
  v_team boolean:=false;
begin
  select p.* into v_actor from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;

  select c.* into v_conv from public.partner_support_conversations c
  where c.id=p_conversation_id;
  if v_conv.id is null then raise exception 'Conversation not found'; end if;

  v_team:=v_actor.role in ('staff','admin','creator');
  if not (
    v_actor.user_id=v_conv.partner_id
    or v_actor.user_id=v_conv.assigned_staff_id
    or v_actor.user_id=v_conv.assigned_field_officer_id
    or v_actor.role in ('admin','creator')
    or (v_actor.role='staff' and v_conv.assigned_staff_id is null and (
      (v_conv.channel_kind in ('property_operations','reservation_operations') and public.current_staff_has_permission('operations'))
      or (v_conv.channel_kind='field_operations' and public.current_staff_has_permission('field_officer'))
      or (v_conv.channel_kind not in ('property_operations','reservation_operations','field_operations') and public.current_staff_has_permission('support'))
    ))
  ) then raise exception 'Not authorised'; end if;

  return query
  select m.id,m.sender_id,coalesce(p.full_name,p.username,'WeHouse'),m.sender_role,
    m.content,m.attachments,m.attachment_types,m.action_type,
    coalesce(m.action_metadata,'{}'::jsonb),m.visibility,m.is_read,m.created_at
  from public.partner_support_messages m
  left join public.profiles p on p.user_id=m.sender_id
  where m.conversation_id=p_conversation_id
    and (m.visibility='customer' or v_team)
  order by m.created_at;
end;
$function$;

revoke all on function public.get_support_messages(uuid) from public,anon;
grant execute on function public.get_support_messages(uuid) to authenticated,service_role;

drop function if exists public.send_support_message(uuid,text,text[],text[],text,jsonb);
create function public.send_support_message(
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
as $function$
declare
  v_actor public.profiles;
  v_case public.partner_support_conversations;
  v_id uuid;
  v_sender_role text;
  v_context_id text;
  v_snapshot jsonb;
  v_is_requester boolean;
  v_operational boolean;
  v_safe_action_type text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;

  select * into v_case from public.partner_support_conversations
  where id=p_conversation_id for update;
  if v_case.id is null then raise exception 'Conversation not found'; end if;

  v_is_requester:=v_actor.user_id=v_case.partner_id;
  v_operational:=v_case.channel_kind in ('property_operations','reservation_operations','field_operations');
  if not (
    v_is_requester
    or v_actor.user_id=v_case.assigned_staff_id
    or v_actor.user_id=v_case.assigned_field_officer_id
    or v_actor.role in ('admin','creator')
  ) then raise exception 'Not authorised'; end if;
  if p_visibility not in ('customer','internal') then raise exception 'Invalid message visibility'; end if;
  if p_visibility='internal' and v_is_requester then raise exception 'Only the WeHouse team can add internal work notes'; end if;

  if not v_operational and v_case.status in ('resolved','closed') then
    if v_is_requester then raise exception 'Choose I still need help before sending another message'; end if;
    raise exception 'Reopen the help request before sending another reply';
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

  -- Generic help has a case lifecycle. Operational threads take their state
  -- from the linked booking, tenancy, service job or property record.
  if not v_operational and p_visibility='customer' then
    if v_is_requester and v_case.status='waiting_for_user' then
      update public.partner_support_conversations
      set status='in_progress',updated_at=now() where id=p_conversation_id;
      insert into public.support_case_events(
        conversation_id,event_type,actor_id,from_status,to_status,note
      ) values(
        p_conversation_id,'requester_replied',v_actor.user_id,
        'waiting_for_user','in_progress','The requester supplied more information.'
      );
    elsif not v_is_requester and v_case.status in ('open','assigned') then
      update public.partner_support_conversations
      set status='in_progress',updated_at=now() where id=p_conversation_id;
      insert into public.support_case_events(
        conversation_id,event_type,actor_id,from_status,to_status,note
      ) values(
        p_conversation_id,'work_started',v_actor.user_id,
        v_case.status,'in_progress','WeHouse started working on this help request.'
      );
    end if;
  end if;

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,attachment_types,
    action_type,action_metadata,visibility,created_at
  ) values(
    p_conversation_id,v_actor.user_id,v_sender_role,coalesce(btrim(p_content),''),
    coalesce(p_attachments,'{}'),coalesce(p_attachment_types,'{}'),
    v_safe_action_type,coalesce(p_action_metadata,'{}'::jsonb),p_visibility,now()
  ) returning id into v_id;

  if v_is_requester and p_visibility='customer' then
    v_context_id:=nullif(btrim(coalesce(p_action_metadata->>'context_id','')),'');
    v_snapshot:=coalesce(p_action_metadata->'context_snapshot','{}'::jsonb);
    update public.partner_support_conversations
    set updated_at=now(),
        category=coalesce(nullif(btrim(coalesce(p_action_metadata->>'category','')),''),category),
        context_type=coalesce(nullif(btrim(coalesce(p_action_metadata->>'context_type','')),''),context_type),
        context_id=coalesce(v_context_id,context_id),
        context_snapshot=case when v_snapshot<>'{}'::jsonb then v_snapshot else context_snapshot end
    where id=p_conversation_id;
  else
    update public.partner_support_conversations set updated_at=now()
    where id=p_conversation_id;
  end if;
  return v_id;
end;
$function$;

revoke all on function public.send_support_message(uuid,text,text[],text[],text,jsonb,text) from public,anon;
grant execute on function public.send_support_message(uuid,text,text[],text[],text,jsonb,text) to authenticated,service_role;

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
  operational boolean;
begin
  select * into actor from public.profiles
  where auth_id=(select auth.uid())::text and role='staff'
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if actor.user_id is null then raise exception 'Active Staff account required'; end if;

  select c.* into current_case from public.partner_support_conversations c
  where c.id=p_conversation_id for update of c;
  if current_case.id is null then raise exception 'Conversation not found'; end if;

  select p.state,coalesce(nullif(p.local_government,''),p.city)
  into owner_state,owner_lga from public.profiles p
  where p.user_id=current_case.partner_id;
  if public.wehouse_state_key(actor.assigned_state)<>public.wehouse_state_key(owner_state)
     or public.wehouse_lga_key(actor.assigned_lga)<>public.wehouse_lga_key(owner_lga) then
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
      raise exception 'Only the assigned Field Officer can open this record';
    end if;
    return true;
  end if;
  if current_case.assigned_staff_id is not null
     and current_case.assigned_staff_id<>actor.user_id then
    raise exception 'This work is already assigned to another team member';
  end if;

  operational:=current_case.channel_kind in ('property_operations','reservation_operations','field_operations');
  if current_case.assigned_staff_id is null then
    update public.partner_support_conversations
    set assigned_staff_id=actor.user_id,
        status=case when not operational and status='open' then 'assigned' else status end,
        updated_at=now()
    where id=p_conversation_id;

    if not operational then
      handler_name:=coalesce(nullif(btrim(actor.full_name),''),nullif(btrim(actor.username),''),'A WeHouse team member');
      insert into public.support_case_events(
        conversation_id,event_type,actor_id,from_status,to_status,note,metadata
      ) values(
        p_conversation_id,'assigned',actor.user_id,current_case.status,'assigned',
        handler_name||' is handling this help request.',jsonb_build_object('handler_name',handler_name)
      );
      insert into public.partner_support_messages(
        conversation_id,sender_id,sender_role,content,action_type,action_metadata,visibility,created_at
      ) values(
        p_conversation_id,actor.user_id,'staff',
        handler_name||' from WeHouse is handling your help request.','status_change',
        jsonb_build_object('event_type','assigned','from_status',current_case.status,'to_status','assigned','actor_name',handler_name),
        'customer',now()
      );
    end if;
  end if;
  return true;
end;
$function$;

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
  v_operational boolean;
begin
  select * into v_case from public.partner_support_conversations
  where id=new.conversation_id;
  if v_case.id is null then return new; end if;
  v_sender_is_requester:=new.sender_id=v_case.partner_id;
  v_operational:=v_case.channel_kind in ('property_operations','reservation_operations','field_operations');

  if new.visibility='internal' then
    v_recipient:=case
      when new.sender_id=v_case.assigned_field_officer_id then v_case.assigned_staff_id
      else v_case.assigned_field_officer_id
    end;
    v_title:='Internal work note';
  else
    v_target_status:=coalesce(new.action_metadata->>'to_status','');
    v_recipient:=case when v_sender_is_requester
      then coalesce(v_case.assigned_field_officer_id,v_case.assigned_staff_id)
      else v_case.partner_id end;
    v_title:=case
      when v_operational and v_sender_is_requester then 'New message on an active record'
      when v_operational then 'WeHouse updated your record conversation'
      when v_sender_is_requester and new.action_metadata->>'event_type'='resolution_accepted' then 'Requester confirmed this is solved'
      when v_sender_is_requester and new.action_metadata->>'event_type'='reopened' then 'Requester still needs help'
      when v_sender_is_requester then 'Help request reply needs attention'
      when new.action_type='status_change' and v_target_status='waiting_for_user' then 'WeHouse needs information from you'
      when new.action_type='status_change' and v_target_status='escalated' then 'Your help request was escalated'
      when new.action_type='status_change' and v_target_status='resolved' then 'WeHouse resolved your help request'
      else 'WeHouse replied to your help request'
    end;
  end if;

  if v_recipient is not null and v_recipient<>new.sender_id then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key
    ) values(
      v_recipient,
      case when new.visibility='internal' then 'internal_work_note' else 'support_case_message' end,
      v_title,coalesce(nullif(btrim(new.content),''),'New attachment'),v_case.id::text,
      case when new.visibility='internal' then 'internal_work_note' else 'wehouse_conversation' end,
      v_case.id::text,'conversation',
      jsonb_build_object('conversation_id',v_case.id,'context_type',v_case.context_type,'context_id',v_case.context_id),
      'support-message:'||new.id::text
    ) on conflict do nothing;
  end if;
  return new;
end;
$function$;

drop policy if exists support_message_read on public.partner_support_messages;
create policy support_message_read on public.partner_support_messages
for select to authenticated
using (
  private.can_access_support_conversation(conversation_id)
  and (
    visibility='customer'
    or exists(
      select 1 from public.profiles actor
      where actor.auth_id=(select auth.uid())::text
        and actor.role in ('staff','admin','creator')
        and not coalesce(actor.deleted,false)
        and not coalesce(actor.suspended,false)
        and not coalesce(actor.banned,false)
    )
  )
);

create or replace function private.can_read_support_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public','storage'
as $function$
  select private.can_access_support_object(p_name)
    and (
      exists(
        select 1 from public.profiles actor
        where actor.auth_id=(select auth.uid())::text
          and actor.role in ('staff','admin','creator')
          and not coalesce(actor.deleted,false)
          and not coalesce(actor.suspended,false)
          and not coalesce(actor.banned,false)
      )
      or not exists(
        select 1 from public.partner_support_messages message
        where message.visibility='internal' and p_name=any(coalesce(message.attachments,'{}'))
      )
    )
$function$;
revoke all on function private.can_read_support_object(text) from public,anon,authenticated;
grant execute on function private.can_read_support_object(text) to authenticated;

drop policy if exists support_files_read on storage.objects;
create policy support_files_read on storage.objects
for select to authenticated
using (bucket_id='support-files' and private.can_read_support_object(name));

-- Independent field-evidence review.
alter table public.inspection_requests
  add column if not exists field_evidence_review_status text not null default 'not_submitted',
  add column if not exists field_evidence_reviewed_by text references public.profiles(user_id),
  add column if not exists field_evidence_reviewed_at timestamptz,
  add column if not exists field_evidence_review_note text;

alter table public.inspection_requests
  drop constraint if exists inspection_requests_field_evidence_review_status_check;
alter table public.inspection_requests
  add constraint inspection_requests_field_evidence_review_status_check
  check (field_evidence_review_status in ('not_submitted','pending','accepted','changes_requested'));

update public.inspection_requests
set field_evidence_review_status='accepted',
    field_evidence_reviewed_by=coalesce(final_media_reviewed_by,approved_by),
    field_evidence_reviewed_at=coalesce(final_media_reviewed_at,approved_at,published_at)
where published_at is not null;

update public.inspection_requests
set field_evidence_review_status='pending'
where lifecycle_stage='visit_reviewed' and published_at is null;

alter table public.inspection_requests
  drop constraint if exists inspection_requests_lifecycle_stage_check;
update public.inspection_requests
set lifecycle_stage='awaiting_review'
where lifecycle_stage='visit_reviewed' and published_at is null;
alter table public.inspection_requests
  add constraint inspection_requests_lifecycle_stage_check
  check (lifecycle_stage in (
    'access_required','access_review','inspection_ready','inspection',
    'awaiting_review','ready_to_prepare','listing_prepared','live',
    'changes_requested','rejected'
  ));

create or replace function public.sync_property_submission_lifecycle()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
begin
  if new.published_at is null
     and lower(coalesce(new.status,'')) in ('completed','approved')
     and new.field_evidence_review_status='not_submitted' then
    new.field_evidence_review_status:='pending';
  end if;
  new.lifecycle_stage:=case
    when new.published_at is not null then 'live'
    when lower(coalesce(new.status,''))='rejected' then 'rejected'
    when new.access_evidence_status='rejected' then 'changes_requested'
    when new.field_evidence_review_status='changes_requested' then 'changes_requested'
    when new.access_evidence_status is null or new.access_evidence_status='required' then 'access_required'
    when new.access_evidence_status='submitted' then 'access_review'
    when new.draft_listing_id is not null or new.draft_hotel_id is not null then 'listing_prepared'
    when new.field_evidence_review_status='accepted' then 'ready_to_prepare'
    when new.field_evidence_review_status='pending'
      or new.completed_at is not null
      or lower(coalesce(new.status,'')) in ('completed','approved') then 'awaiting_review'
    when coalesce(new.assigned_field_officer_id,new.field_officer_id,new.assigned_to) is not null
      or new.scheduled_date is not null
      or lower(coalesce(new.status,'')) in ('scheduled','in_progress') then 'inspection'
    when new.access_evidence_status='verified' then 'inspection_ready'
    else 'access_required'
  end;
  new.access_challenge_code:=null;
  new.access_challenge_expires_at:=null;
  return new;
end;
$function$;

create or replace function public.update_inspection_status(
  p_inspection_id uuid,
  p_new_status text,
  p_source text default 'user',
  p_report text default null,
  p_condition text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_updated boolean:=false;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active WeHouse account required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('field_officer') then
    raise exception 'Field Officer permission required';
  end if;
  if v_actor.role not in ('staff','admin','creator') then raise exception 'Field Officer access required'; end if;
  if p_source not in ('user','partner') then raise exception 'Invalid inspection source'; end if;
  if p_new_status not in ('in_progress','completed') then raise exception 'Field Officer can only start or submit an inspection'; end if;
  if p_new_status='completed' and nullif(btrim(coalesce(p_report,'')),'') is null then
    raise exception 'Inspection report is required before submission';
  end if;

  if p_source='partner' then
    update public.inspection_requests
    set status=p_new_status,
        completed_at=case when p_new_status='completed' then now() else completed_at end,
        inspection_completed_at=case when p_new_status='completed' then now() else inspection_completed_at end,
        notes=case when p_new_status='completed' then btrim(p_report) else notes end,
        field_evidence_review_status=case when p_new_status='completed' then 'pending' else field_evidence_review_status end,
        field_evidence_reviewed_by=case when p_new_status='completed' then null else field_evidence_reviewed_by end,
        field_evidence_reviewed_at=case when p_new_status='completed' then null else field_evidence_reviewed_at end,
        field_evidence_review_note=case when p_new_status='completed' then null else field_evidence_review_note end,
        rejection_reason=case when p_new_status='completed' then null else rejection_reason end,
        updated_at=now()
    where id=p_inspection_id and (
      v_actor.role in ('admin','creator')
      or coalesce(assigned_field_officer_id,field_officer_id,assigned_to)=v_actor.user_id
    );
    v_updated:=found;
  else
    update public.user_inspection_requests
    set status=p_new_status,
        completed_at=case when p_new_status='completed' then now() else completed_at end,
        report=case when p_new_status='completed' then btrim(p_report) else report end,
        condition=case when p_new_status='completed' then nullif(btrim(coalesce(p_condition,'')),'') else condition end,
        updated_at=now()
    where id=p_inspection_id and (
      v_actor.role in ('admin','creator') or field_officer_id=v_actor.user_id
    );
    v_updated:=found;
  end if;
  if not v_updated then raise exception 'Inspection not found or not assigned to this account'; end if;
  return true;
end;
$function$;

create or replace function public.review_field_inspection_evidence(
  p_inspection_id uuid,
  p_decision text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Property review access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;
  select * into v_request from public.inspection_requests
  where id=p_inspection_id for update;
  if v_request.id is null then raise exception 'Inspection not found'; end if;
  if v_actor.user_id=coalesce(v_request.assigned_field_officer_id,v_request.field_officer_id,v_request.assigned_to) then
    raise exception 'The Field Officer who submitted evidence cannot approve it';
  end if;
  if v_actor.role in ('staff','admin') and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Property is outside your assigned branch';
  end if;
  if v_request.field_evidence_review_status<>'pending' then
    raise exception 'This Field Operations evidence is not awaiting review';
  end if;
  if p_decision='accept' then
    if cardinality(coalesce(v_request.field_photo_urls,'{}'))<4 then
      raise exception 'Four Field Operations photos are required before acceptance';
    end if;
    if nullif(btrim(coalesce(v_request.notes,'')),'') is null then
      raise exception 'A Field Operations report is required before acceptance';
    end if;
    update public.inspection_requests
    set field_evidence_review_status='accepted',field_evidence_reviewed_by=v_actor.user_id,
        field_evidence_reviewed_at=now(),field_evidence_review_note=v_note,
        rejection_reason=null,updated_at=now()
    where id=p_inspection_id;
  elsif p_decision='request_changes' then
    if v_note is null then raise exception 'Explain exactly what Field Operations must correct'; end if;
    update public.inspection_requests
    set status='in_progress',field_evidence_review_status='changes_requested',
        field_evidence_reviewed_by=v_actor.user_id,field_evidence_reviewed_at=now(),
        field_evidence_review_note=v_note,rejection_reason=v_note,updated_at=now()
    where id=p_inspection_id;
    if v_request.assigned_field_officer_id is not null then
      insert into public.notifications(
        recipient_id,type,title,message,related_id,source_type,source_id,
        destination_route,destination_params,event_key
      ) values(
        v_request.assigned_field_officer_id,'field_evidence_changes_requested',
        'Field evidence needs correction',v_note,v_request.id::text,
        'inspection_request',v_request.id::text,'field_inspections',
        jsonb_build_object('inspection_id',v_request.id),
        'field-evidence-correction:'||v_request.id::text||':'||extract(epoch from now())::bigint::text
      ) on conflict do nothing;
    end if;
  else
    raise exception 'Decision must be accept or request_changes';
  end if;
  return true;
end;
$function$;

revoke all on function public.review_field_inspection_evidence(uuid,text,text) from public,anon;
grant execute on function public.review_field_inspection_evidence(uuid,text,text) to authenticated,service_role;

create or replace function public.get_my_property_pipeline_v2(p_stage text default 'all')
returns jsonb
language sql
set search_path to 'pg_catalog','public'
as $function$
  select coalesce(jsonb_agg(
    item||jsonb_build_object(
      'submission_schema_version',ir.submission_schema_version,
      'submission_batch_id',ir.submission_batch_id,
      'hotel_program',coalesce(ir.hotel_program,'{}'::jsonb),
      'lifecycle_stage',ir.lifecycle_stage,
      'field_evidence_review_status',ir.field_evidence_review_status,
      'field_evidence_reviewed_by',ir.field_evidence_reviewed_by,
      'field_evidence_reviewed_at',ir.field_evidence_reviewed_at,
      'field_evidence_review_note',ir.field_evidence_review_note,
      'final_media_reviewed_at',ir.final_media_reviewed_at,
      'final_media_reviewed_by',ir.final_media_reviewed_by,
      'final_media_sources',ir.final_media_sources,
      'final_hotel_media_sources',ir.final_hotel_media_sources,
      'final_room_media_sources',ir.final_room_media_sources
    ) order by (item->>'created_at')::timestamptz desc
  ),'[]'::jsonb)
  from jsonb_array_elements(public.get_my_property_pipeline('all')) item
  join public.inspection_requests ir on ir.id=(item->>'id')::uuid
  where p_stage='all'
    or (p_stage='new' and ir.lifecycle_stage in ('access_required','access_review','inspection_ready'))
    or (p_stage='inspection' and ir.lifecycle_stage='inspection')
    or (p_stage='review' and ir.lifecycle_stage='awaiting_review')
    or (p_stage='ready' and ir.lifecycle_stage='ready_to_prepare')
    or (p_stage='preparing' and ir.lifecycle_stage='listing_prepared')
    or (p_stage='published' and ir.lifecycle_stage='live')
    or (p_stage='rejected' and ir.lifecycle_stage in ('changes_requested','rejected'));
$function$;

create or replace function public.prepare_property_listing(
  p_inspection_id uuid,
  p_public_title text,
  p_editorial_description text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_partner public.profiles;
  v_listing_id uuid;
  v_code text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;
  select * into v_request from public.inspection_requests
  where id=p_inspection_id for update;
  if v_request.id is null or v_request.property_type='hotel' then raise exception 'Accepted apartment inspection required'; end if;
  if v_actor.role in ('staff','admin') and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Property is outside your assigned branch';
  end if;
  if v_request.draft_listing_id is not null then return v_request.draft_listing_id; end if;
  if v_request.lifecycle_stage<>'ready_to_prepare' or v_request.field_evidence_review_status<>'accepted' then
    raise exception 'Field evidence must be independently accepted before preparation';
  end if;
  if nullif(btrim(coalesce(p_public_title,'')),'') is null then raise exception 'Public title is required'; end if;
  if coalesce(v_request.expected_rent,0)<=0 then raise exception 'The Property Partner must supply a valid rent'; end if;
  if v_request.sub_type not in ('short_let','long_stay') then raise exception 'The Property Partner must choose Short Let or Long Let'; end if;
  if v_request.sub_type='short_let' and coalesce(v_request.security_deposit_amount,0)<=0 then
    raise exception 'The Property Partner must supply the Short Let refundable security deposit';
  end if;
  if v_request.sub_type='short_let' and not ('Furnished'=any(coalesce(v_request.amenities,'{}'))) then
    raise exception 'A Short Let must be submitted as furnished';
  end if;
  select * into v_partner from public.profiles
  where user_id=v_request.owner_id and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_partner.user_id is null then raise exception 'Active Property Partner required'; end if;

  v_code:='WHL-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 12));
  insert into public.listings(
    listing_id,title,description,price,currency,state,city,address,images,videos,
    bedrooms,bathrooms,property_type,sub_type,security_deposit_amount,amenities,
    availability_status,owner_id,partner_id,chat_agent_id,status,submitted_by_role,
    reservation_fee_paid,chat_unlocked,gps_latitude,gps_longitude,
    inspection_request_id,created_at,updated_at
  ) values(
    v_code,btrim(p_public_title),coalesce(nullif(btrim(coalesce(p_editorial_description,'')),''),v_request.description),
    v_request.expected_rent,'NGN',v_request.property_state,v_request.property_city,
    v_request.property_address,array[]::text[],array[]::text[],
    coalesce(v_request.bedrooms,1),coalesce(v_request.bathrooms,1),
    v_request.property_type,v_request.sub_type,
    case when v_request.sub_type='short_let' then v_request.security_deposit_amount else null end,
    coalesce(v_request.amenities,array[]::text[]),'pending_approval',
    v_partner.user_id,v_partner.user_id,v_actor.user_id,'pending_approval',
    'property_partner',false,false,v_request.gps_latitude,v_request.gps_longitude,
    v_request.id,now(),now()
  ) returning id into v_listing_id;
  update public.inspection_requests set draft_listing_id=v_listing_id,updated_at=now()
  where id=v_request.id;
  return v_listing_id;
end;
$function$;

create or replace function public.prepare_hotel_listing(
  p_inspection_id uuid,
  p_editorial_description text default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_program jsonb;
  v_rooms jsonb;
  v_room jsonb;
  v_hotel_id integer;
  v_name text;
  v_amenities text[];
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Property Operations permission required';
  end if;
  select * into v_request from public.inspection_requests
  where id=p_inspection_id for update;
  if v_request.id is null or v_request.property_type<>'hotel' then raise exception 'Accepted hotel inspection required'; end if;
  if v_actor.role in ('staff','admin') and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Hotel is outside your assigned branch';
  end if;
  if v_request.draft_hotel_id is not null then return v_request.draft_hotel_id; end if;
  if v_request.lifecycle_stage<>'ready_to_prepare' or v_request.field_evidence_review_status<>'accepted' then
    raise exception 'Field evidence must be independently accepted before preparation';
  end if;
  v_program:=coalesce(v_request.hotel_program,'{}'::jsonb);
  v_rooms:=coalesce(v_program->'room_types','[]'::jsonb);
  v_name:=nullif(btrim(v_program->>'name'),'');
  if v_name is null then raise exception 'The Property Partner must supply the hotel name'; end if;
  if jsonb_typeof(v_rooms)<>'array' or jsonb_array_length(v_rooms)=0 then
    raise exception 'The Property Partner must submit at least one room type';
  end if;
  select coalesce(array_agg(value),array[]::text[]) into v_amenities
  from jsonb_array_elements_text(coalesce(v_program->'amenities','[]'::jsonb));
  insert into public.hotels(
    name,description,state,city,address,images,amenities,owner_id,status,featured,
    gps_latitude,gps_longitude,inspection_request_id,created_at,updated_at
  ) values(
    v_name,coalesce(nullif(btrim(coalesce(p_editorial_description,'')),''),v_request.description),
    v_request.property_state,v_request.property_city,v_request.property_address,
    array[]::text[],v_amenities,v_request.owner_id,'draft',false,
    v_request.gps_latitude,v_request.gps_longitude,v_request.id,now(),now()
  ) returning hotel_id into v_hotel_id;
  for v_room in select value from jsonb_array_elements(v_rooms) loop
    if nullif(btrim(v_room->>'name'),'') is null
       or coalesce((v_room->>'nightly_rate')::integer,0)<=0 then
      raise exception 'Every submitted room needs a name and nightly rate';
    end if;
    insert into public.hotel_rooms(
      hotel_id,room_type,description,price_per_night,max_guests,bed_type,
      images,amenities,total_rooms,created_at,updated_at
    ) values(
      v_hotel_id,btrim(v_room->>'name'),nullif(btrim(v_room->>'description'),''),
      (v_room->>'nightly_rate')::integer,greatest(coalesce((v_room->>'guest_capacity')::integer,2),1),
      nullif(btrim(v_room->>'bed_type'),''),array[]::text[],
      coalesce(array(select jsonb_array_elements_text(coalesce(v_room->'amenities','[]'::jsonb))),array[]::text[]),
      greatest(coalesce((v_room->>'inventory')::integer,1),1),now(),now()
    );
  end loop;
  update public.inspection_requests set draft_hotel_id=v_hotel_id,updated_at=now()
  where id=v_request.id;
  return v_hotel_id;
end;
$function$;

revoke all on function public.prepare_property_listing(uuid,text,text) from public,anon;
revoke all on function public.prepare_hotel_listing(uuid,text) from public,anon;
grant execute on function public.prepare_property_listing(uuid,text,text) to authenticated,service_role;
grant execute on function public.prepare_hotel_listing(uuid,text) to authenticated,service_role;

-- Retire preparation entry points that accepted commercial facts from Staff.
revoke all on function public.post_property_from_inspection(jsonb) from public,anon,authenticated;
revoke all on function public.post_property_from_inspection_v2(jsonb) from public,anon,authenticated;
revoke all on function public.admin_prepare_hotel_from_submission_v2(uuid,text,text,text[]) from public,anon,authenticated;
revoke all on function public.admin_prepare_hotel_from_submission_v3(uuid,text,text) from public,anon,authenticated;

-- Let Property Operations prepare the exact public gallery, while final
-- publication remains Admin/Creator-only.
do $block$
declare v_definition text;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='admin_set_inspected_public_gallery_v2';
  v_definition:=replace(v_definition,
    $$role in ('admin','creator')$$,$$role in ('staff','admin','creator')$$);
  v_definition:=replace(v_definition,
    $$if v_actor is null then raise exception 'Final Admin or Creator review required'; end if;$$,
    $$if v_actor is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then raise exception 'Property Operations permission required'; end if;$$);
  execute v_definition;

  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='admin_set_inspected_hotel_media_v2';
  v_definition:=replace(v_definition,
    $$role in ('admin','creator')$$,$$role in ('staff','admin','creator')$$);
  v_definition:=replace(v_definition,
    $$if v_actor is null then raise exception 'Final Admin or Creator review required'; end if;$$,
    $$if v_actor is null then raise exception 'Property Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then raise exception 'Property Operations permission required'; end if;$$);
  execute v_definition;
end;
$block$;

create or replace function public.prepare_inspected_public_gallery(
  p_inspection_id uuid,p_source_images text[],p_public_images text[]
)
returns boolean
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select public.admin_set_inspected_public_gallery_v2(
    p_inspection_id,p_source_images,p_public_images
  )
$function$;

create or replace function public.prepare_inspected_hotel_media(
  p_inspection_id uuid,
  p_hotel_source_images text[],
  p_hotel_public_images text[],
  p_room_source_galleries jsonb,
  p_room_public_galleries jsonb
)
returns boolean
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select public.admin_set_inspected_hotel_media_v2(
    p_inspection_id,p_hotel_source_images,p_hotel_public_images,
    p_room_source_galleries,p_room_public_galleries
  )
$function$;

revoke all on function public.admin_set_inspected_public_gallery_v2(uuid,text[],text[]) from public,anon,authenticated;
revoke all on function public.admin_set_inspected_hotel_media_v2(uuid,text[],text[],jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.admin_set_inspected_public_gallery_v2(uuid,text[],text[]) to service_role;
grant execute on function public.admin_set_inspected_hotel_media_v2(uuid,text[],text[],jsonb,jsonb) to service_role;
revoke all on function public.prepare_inspected_public_gallery(uuid,text[],text[]) from public,anon;
revoke all on function public.prepare_inspected_hotel_media(uuid,text[],text[],jsonb,jsonb) from public,anon;
grant execute on function public.prepare_inspected_public_gallery(uuid,text[],text[]) to authenticated,service_role;
grant execute on function public.prepare_inspected_hotel_media(uuid,text[],text[],jsonb,jsonb) to authenticated,service_role;

drop policy if exists listing_images_property_operations_insert on storage.objects;
create policy listing_images_property_operations_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='listing-images'
  and (storage.foldername(name))[1]='listings'
  and exists(
    select 1 from public.profiles actor
    join public.inspection_requests request
      on (storage.foldername(name))[2]='final-'||request.id::text
    where actor.auth_id=(select auth.uid())::text
      and actor.role='staff'
      and not coalesce(actor.deleted,false)
      and not coalesce(actor.suspended,false)
      and not coalesce(actor.banned,false)
      and public.current_staff_has_permission('operations')
      and public.current_actor_in_scope(request.property_state,request.property_city)
      and request.lifecycle_stage in ('listing_prepared','live')
  )
);

drop policy if exists listing_images_property_operations_delete on storage.objects;
create policy listing_images_property_operations_delete on storage.objects
for delete to authenticated
using (
  bucket_id='listing-images'
  and (storage.foldername(name))[1]='listings'
  and exists(
    select 1 from public.profiles actor
    join public.inspection_requests request
      on (storage.foldername(name))[2]='final-'||request.id::text
    where actor.auth_id=(select auth.uid())::text
      and actor.role='staff'
      and not coalesce(actor.deleted,false)
      and not coalesce(actor.suspended,false)
      and not coalesce(actor.banned,false)
      and public.current_staff_has_permission('operations')
      and public.current_actor_in_scope(request.property_state,request.property_city)
      and request.lifecycle_stage in ('listing_prepared','live')
  )
);

-- Update activity routing for the explicit review stage.
create or replace function public.notify_property_operations_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_stage text:=lower(coalesce(new.lifecycle_stage,''));
  v_title text;
  v_recipient record;
begin
  if tg_op='INSERT' or (tg_op='UPDATE' and new.lifecycle_stage is not distinct from old.lifecycle_stage) then return new; end if;
  if v_stage not in ('access_review','inspection_ready','awaiting_review','listing_prepared') then return new; end if;
  v_title:=case v_stage
    when 'access_review' then 'Access evidence needs review'
    when 'inspection_ready' then 'Property needs a field assignment'
    when 'awaiting_review' then 'Field evidence needs review'
    when 'listing_prepared' then 'Listing is ready for publication review'
  end;
  for v_recipient in
    select distinct p.user_id,p.role::text role from public.profiles p
    where not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
      and p.user_id is distinct from public.current_profile_user_id()
      and (
        (v_stage='listing_prepared' and p.role in ('admin','creator') and (
          p.role='creator' or public.wehouse_state_key(p.assigned_state)=public.wehouse_state_key(new.property_state)
        ))
        or (v_stage<>'listing_prepared' and (
          (p.role='admin' and public.wehouse_state_key(p.assigned_state)=public.wehouse_state_key(new.property_state)
            and public.wehouse_lga_key(p.assigned_lga)=public.wehouse_lga_key(new.property_city))
          or (p.role='staff' and public.wehouse_state_key(p.assigned_state)=public.wehouse_state_key(new.property_state)
            and public.wehouse_lga_key(p.assigned_lga)=public.wehouse_lga_key(new.property_city)
            and exists(select 1 from public.staff_permissions sp where sp.staff_id=p.user_id and sp.permission='operations' and sp.is_active))
        ))
      )
  loop
    insert into public.notifications(
      recipient_id,type,title,message,read,related_id,source_type,source_id,
      destination_route,destination_params,event_key,workspace_scope,created_at
    ) values(
      v_recipient.user_id,'property_'||v_stage,v_title,
      concat_ws(' · ',nullif(new.property_address,''),nullif(new.request_code,'')),false,
      new.id::text,'inspection_request',new.id::text,'operations_properties',
      jsonb_build_object('inspection_id',new.id,'request_code',new.request_code),
      'operations_property:'||new.id::text||':'||v_stage,
      case when v_recipient.role='creator' then 'creator' when v_recipient.role='admin' then 'admin' else 'staff' end,
      now()
    ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  end loop;
  return new;
end;
$function$;
