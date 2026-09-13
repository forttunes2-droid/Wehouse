-- Support case transitions are explicit and auditable. Creator receives only
-- escalated support rows; normal cases remain with assigned Support staff.

create table if not exists public.support_case_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.partner_support_conversations(id) on delete cascade,
  event_type text not null check (event_type in ('assigned','work_started','escalated','resolved','closed','reopened')),
  actor_id text references public.profiles(user_id) on delete set null,
  from_status text,
  to_status text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (note is null or char_length(note) <= 2000)
);

create index if not exists support_case_events_conversation_created_idx
  on public.support_case_events(conversation_id, created_at desc);

alter table public.support_case_events enable row level security;
drop policy if exists support_case_events_read_authorized on public.support_case_events;
create policy support_case_events_read_authorized
  on public.support_case_events for select to authenticated
  using (private.can_access_support_conversation(conversation_id));

revoke all on table public.support_case_events from anon;
revoke all on table public.support_case_events from authenticated;
grant select on table public.support_case_events to authenticated;

create or replace function public.claim_my_communication_case(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  actor public.profiles;
  channel text;
  owner_id text;
  owner_state text;
  owner_lga text;
  previous_owner text;
  previous_status text;
begin
  select * into actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if actor.user_id is null or actor.role<>'staff' then raise exception 'Active Staff account required'; end if;
  select c.channel_kind,p.user_id,p.state,coalesce(nullif(p.local_government,''),p.city),c.assigned_staff_id,c.status
    into channel,owner_id,owner_state,owner_lga,previous_owner,previous_status
  from public.partner_support_conversations c
  join public.profiles p on p.user_id=c.partner_id
  where c.id=p_conversation_id for update of c;
  if owner_id is null then raise exception 'Conversation not found'; end if;
  if actor.assigned_state is distinct from owner_state or actor.assigned_lga is distinct from owner_lga then raise exception 'Conversation is outside your branch'; end if;
  if not public.current_staff_has_permission(case when channel='reservation_operations' then 'operations' else 'support' end) then raise exception 'Conversation is outside your Staff responsibility'; end if;
  update public.partner_support_conversations
    set assigned_staff_id=actor.user_id,
        status=case when status='open' then 'assigned' else status end,
        updated_at=now()
  where id=p_conversation_id and (assigned_staff_id is null or assigned_staff_id=actor.user_id);
  if not found then raise exception 'This conversation is already assigned to another Staff member'; end if;
  if previous_owner is distinct from actor.user_id then
    insert into public.support_case_events(conversation_id,event_type,actor_id,from_status,to_status)
    values(p_conversation_id,'assigned',actor.user_id,previous_status,case when previous_status='open' then 'assigned' else previous_status end);
  end if;
  return true;
end
$$;

create or replace function public.transition_my_support_case(
  p_conversation_id uuid,
  p_action text,
  p_note text default null
)
returns public.partner_support_conversations
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  actor public.profiles;
  current_case public.partner_support_conversations;
  result public.partner_support_conversations;
  required_permission text;
  next_status text;
  event_name text;
begin
  select * into actor from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if actor.user_id is null or actor.role <> 'staff' then raise exception 'Active Staff account required'; end if;

  select * into current_case from public.partner_support_conversations
  where id=p_conversation_id for update;
  if current_case.id is null then raise exception 'Case not found'; end if;
  if current_case.assigned_staff_id is distinct from actor.user_id then raise exception 'Only the assigned Staff member can change this case'; end if;

  required_permission := case when current_case.channel_kind='reservation_operations' then 'operations' else 'support' end;
  if not public.current_staff_has_permission(required_permission) then raise exception 'Case is outside your Staff responsibility'; end if;

  if p_action='start' then
    if current_case.status not in ('open','assigned') then raise exception 'Only an open or assigned case can be started'; end if;
    next_status:='in_progress'; event_name:='work_started';
  elsif p_action='escalate' then
    if current_case.status in ('resolved','closed') then raise exception 'Resolve state must be reopened by the requester first'; end if;
    if nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'An escalation reason is required'; end if;
    next_status:='in_progress'; event_name:='escalated';
  elsif p_action='resolve' then
    if current_case.status not in ('assigned','in_progress') then raise exception 'Only assigned work can be resolved'; end if;
    if nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'A resolution note is required'; end if;
    next_status:='resolved'; event_name:='resolved';
  elsif p_action='close' then
    if current_case.status<>'resolved' then raise exception 'Resolve the case before closing it'; end if;
    next_status:='closed'; event_name:='closed';
  else
    raise exception 'Unsupported support transition';
  end if;

  update public.partner_support_conversations
  set status=next_status,
      priority=case when p_action='escalate' then 'high' else priority end,
      resolved_at=case when p_action='resolve' then now() when next_status not in ('resolved','closed') then null else resolved_at end,
      closed_at=case when p_action='close' then now() when next_status<>'closed' then null else closed_at end,
      updated_at=now()
  where id=p_conversation_id
  returning * into result;

  insert into public.support_case_events(conversation_id,event_type,actor_id,from_status,to_status,note)
  values(p_conversation_id,event_name,actor.user_id,current_case.status,next_status,nullif(btrim(coalesce(p_note,'')),''));
  return result;
end
$$;

revoke all on function public.transition_my_support_case(uuid,text,text) from public;
revoke all on function public.transition_my_support_case(uuid,text,text) from anon;
grant execute on function public.transition_my_support_case(uuid,text,text) to authenticated;

create or replace function public.log_automatic_support_reopen()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare actor_id text := public.current_profile_user_id();
begin
  if old.status in ('resolved','closed') and new.status='open' then
    insert into public.support_case_events(conversation_id,event_type,actor_id,from_status,to_status)
    values(new.id,'reopened',actor_id,old.status,new.status);
  end if;
  return new;
end
$$;

drop trigger if exists partner_support_log_reopen on public.partner_support_conversations;
create trigger partner_support_log_reopen
after update of status on public.partner_support_conversations
for each row execute function public.log_automatic_support_reopen();

revoke all on function public.log_automatic_support_reopen() from public, anon, authenticated;

-- The review table is written only by its validated RPC. Direct reads are
-- limited to the customer and Worker on that completed booking.
drop policy if exists worker_booking_reviews_participant_read on public.worker_booking_reviews;
create policy worker_booking_reviews_participant_read
  on public.worker_booking_reviews for select to authenticated
  using (
    exists (
      select 1 from public.worker_bookings booking
      where booking.id=worker_booking_reviews.booking_id
        and public.current_profile_user_id() in (booking.user_id,booking.worker_id)
    )
  );
grant select on table public.worker_booking_reviews to authenticated;

-- Creator's support inbox is an escalation surface, not a copy of Support's
-- normal queue. The restriction is applied before rows leave Postgres.
create or replace function public.support_inbox(p_queue text default 'support')
returns table(conversation_id uuid, requester_id text, requester_role text, requester_name text, requester_email text, requester_state text, requester_lga text, subject text, status text, category text, context_type text, context_id text, context_snapshot jsonb, priority text, assigned_staff_id text, assigned_staff_name text, last_message text, last_message_time timestamptz, unread_count bigint, created_at timestamptz)
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare actor public.profiles; allowed boolean:=false;
begin
  if p_queue not in ('support','reservation_operations') then raise exception 'Invalid communication queue'; end if;
  select * into actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if actor.user_id is null then raise exception 'Authentication required'; end if;
  allowed:=actor.role in ('admin','creator') or (actor.role='staff' and public.current_staff_has_permission(case when p_queue='reservation_operations' then 'operations' else 'support' end));
  if not allowed then raise exception 'This communication queue is outside your Staff responsibility'; end if;
  return query
  select c.id,c.partner_id,coalesce(c.requester_role,p.role),coalesce(p.full_name,p.username,p.email),p.email,p.state,coalesce(nullif(p.local_government,''),p.city),
    c.subject,c.status,c.category,c.context_type,c.context_id,c.context_snapshot,c.priority,c.assigned_staff_id,coalesce(s.full_name,s.username),
    (select case when nullif(btrim(m.content),'') is not null then m.content when cardinality(m.attachments)>0 then 'Attachment' else '' end from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select m.created_at from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select count(*) from public.partner_support_messages m where m.conversation_id=c.id and not coalesce(m.is_read,false) and m.sender_id<>actor.user_id),c.created_at
  from public.partner_support_conversations c
  join public.profiles p on p.user_id=c.partner_id
  left join public.profiles s on s.user_id=c.assigned_staff_id
  where exists(select 1 from public.partner_support_messages m where m.conversation_id=c.id)
    and (case when p_queue='reservation_operations' then c.channel_kind='reservation_operations' else coalesce(c.channel_kind,'support_case') not in ('reservation_operations','property_operations') end)
    and (actor.role<>'creator' or (c.priority in ('high','urgent') and c.status not in ('resolved','closed')))
    and (actor.role='creator' or (p.state=actor.assigned_state and coalesce(nullif(p.local_government,''),p.city)=actor.assigned_lga))
    and (actor.role<>'staff' or c.assigned_staff_id is null or c.assigned_staff_id=actor.user_id)
  order by case when c.assigned_staff_id=actor.user_id then 0 when c.assigned_staff_id is null then 1 else 2 end,c.updated_at desc;
end
$$;
