-- One contextual WeHouse inbox, routed by the record that started the conversation.
create or replace function public.classify_conversation_channel()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  source_type text := coalesce(new.context_snapshot->>'source_type','');
begin
  new.channel_kind:=case
    when new.context_type in (
      'apartment_reservation','apartment_payment','reservation','hotel_booking',
      'property_listing','property_inspection'
    ) then 'property_operations'
    when source_type in (
      'apartment_reservation','apartment_payment','reservation','hotel_booking',
      'property_listing','property_inspection'
    ) then 'property_operations'
    else 'support_case'
  end;
  if new.channel_kind='support_case' and new.case_number is null then
    new.case_number:='WHC-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10));
  end if;
  return new;
end;
$$;

revoke all on function public.classify_conversation_channel() from public, anon, authenticated;
grant execute on function public.classify_conversation_channel() to service_role;

-- Correct existing property and stay conversations; this changes their work queue,
-- not their history, participants or messages.
update public.partner_support_conversations
set channel_kind='property_operations', updated_at=now()
where context_type in (
    'apartment_reservation','apartment_payment','reservation','hotel_booking',
    'property_listing','property_inspection'
  )
   or coalesce(context_snapshot->>'source_type','') in (
    'apartment_reservation','apartment_payment','reservation','hotel_booking',
    'property_listing','property_inspection'
  );

create or replace function public.support_inbox(p_queue text default 'support')
returns table(
  conversation_id uuid, requester_id text, requester_role text,
  requester_name text, requester_email text, requester_state text,
  requester_lga text, subject text, status text, category text,
  context_type text, context_id text, context_snapshot jsonb, priority text,
  assigned_staff_id text, assigned_staff_name text, last_message text,
  last_message_time timestamptz, unread_count bigint, created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.profiles;
  required_permission text;
begin
  if p_queue not in ('all','operations','property_operations','reservation_operations','support') then
    raise exception 'Invalid communication context';
  end if;

  select * into actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if actor.user_id is null then raise exception 'Authentication required'; end if;

  required_permission := case
    when p_queue in ('operations','property_operations','reservation_operations') then 'operations'
    when p_queue='support' then 'support'
    else null
  end;
  if p_queue='all' and actor.role not in ('creator','admin') then
    raise exception 'Creator or Admin access required';
  end if;
  if p_queue<>'all' and actor.role not in ('creator','admin')
     and not (actor.role='staff' and public.current_staff_has_permission(required_permission)) then
    raise exception 'This communication context is outside your work area';
  end if;

  return query
  select c.id,c.partner_id,coalesce(c.requester_role,p.role),
    coalesce(p.full_name,p.username,p.email),p.email,p.state,
    coalesce(nullif(p.local_government,''),p.city),c.subject,c.status,c.category,
    c.context_type,c.context_id,c.context_snapshot,c.priority,c.assigned_staff_id,
    coalesce(s.full_name,s.username),
    (select case when nullif(btrim(m.content),'') is not null then m.content when cardinality(m.attachments)>0 then 'Attachment' else '' end
      from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select m.created_at from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select count(*) from public.partner_support_messages m where m.conversation_id=c.id and not coalesce(m.is_read,false) and m.sender_id<>actor.user_id),
    c.created_at
  from public.partner_support_conversations c
  join public.profiles p on p.user_id=c.partner_id
  left join public.profiles s on s.user_id=c.assigned_staff_id
  where exists(select 1 from public.partner_support_messages m where m.conversation_id=c.id)
    and case p_queue
      when 'all' then true
      when 'operations' then c.channel_kind in ('property_operations','reservation_operations')
      when 'property_operations' then c.channel_kind='property_operations'
      when 'reservation_operations' then c.channel_kind='reservation_operations'
      else coalesce(c.channel_kind,'support_case')='support_case'
    end
    and (
      actor.role='creator'
      or (
        lower(btrim(coalesce(p.state,'')))=lower(btrim(coalesce(actor.assigned_state,'')))
        and lower(btrim(coalesce(nullif(p.local_government,''),p.city,'')))=lower(btrim(coalesce(actor.assigned_lga,'')))
      )
    )
    and (actor.role<>'staff' or c.assigned_staff_id is null or c.assigned_staff_id=actor.user_id)
  order by case when c.assigned_staff_id=actor.user_id then 0 when c.assigned_staff_id is null then 1 else 2 end,
    c.updated_at desc;
end;
$$;

revoke all on function public.support_inbox(text) from public, anon;
grant execute on function public.support_inbox(text) to authenticated, service_role;

create or replace function public.claim_my_communication_case(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.profiles;
  channel text;
  owner_id text;
  owner_state text;
  owner_lga text;
  required_permission text;
begin
  select * into actor from public.profiles where auth_id=(select auth.uid())::text limit 1;
  if actor.user_id is null or actor.role<>'staff' then raise exception 'Active Staff account required'; end if;
  select c.channel_kind,p.user_id,p.state,coalesce(nullif(p.local_government,''),p.city)
    into channel,owner_id,owner_state,owner_lga
  from public.partner_support_conversations c join public.profiles p on p.user_id=c.partner_id
  where c.id=p_conversation_id for update of c;
  if owner_id is null then raise exception 'Conversation not found'; end if;
  if actor.assigned_state is distinct from owner_state or actor.assigned_lga is distinct from owner_lga then
    raise exception 'Conversation is outside your branch';
  end if;
  required_permission := case when channel in ('property_operations','reservation_operations') then 'operations' else 'support' end;
  if not public.current_staff_has_permission(required_permission) then
    raise exception 'Conversation is outside your work area';
  end if;
  update public.partner_support_conversations
    set assigned_staff_id=actor.user_id,updated_at=now()
  where id=p_conversation_id and (assigned_staff_id is null or assigned_staff_id=actor.user_id);
  if not found then raise exception 'This conversation is already assigned to another team member'; end if;
  return true;
end;
$$;

revoke all on function public.claim_my_communication_case(uuid) from public, anon;
grant execute on function public.claim_my_communication_case(uuid) to authenticated, service_role;

alter table public.property_access_challenges
  add column if not exists duration_seconds integer;
alter table public.inspection_requests
  add column if not exists access_evidence_duration_seconds integer;

create or replace function public.submit_my_property_access_challenge(p_challenge_id uuid, p_video_path text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  v_actor public.profiles;
  v_row public.property_access_challenges;
  v_duration integer;
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  select * into v_row from public.property_access_challenges where id=p_challenge_id and partner_id=v_actor.user_id for update;
  if v_row.id is null then raise exception 'Property access challenge not found'; end if;
  if v_row.status='submitted' and v_row.video_path is not null then
    return jsonb_build_object('success',true,'status','submitted','already_submitted',true,'video_path',v_row.video_path,'duration_seconds',v_row.duration_seconds);
  end if;
  if v_row.status='consumed' then raise exception 'This property was already submitted'; end if;
  if v_row.status<>'prepared' then raise exception 'Create a new one-use recording code'; end if;
  if v_row.expires_at<=now() then update public.property_access_challenges set status='expired' where id=v_row.id; raise exception 'The one-use code expired. Create a new code and record again'; end if;
  if split_part(p_video_path,'/',1)<>v_actor.user_id or split_part(p_video_path,'/',2)<>p_challenge_id::text then raise exception 'Invalid private property access path'; end if;
  v_duration := nullif((regexp_match(p_video_path, '-([0-9]+)s[.][a-z0-9]+$'))[1],'')::integer;
  if coalesce(v_duration,0)<20 then raise exception 'Record at least 20 seconds of continuous entrance-to-interior access evidence'; end if;
  if not exists(select 1 from storage.objects where bucket_id='property-access-private' and name=p_video_path) then raise exception 'Private property access recording was not found'; end if;
  update public.property_access_challenges set video_path=p_video_path,duration_seconds=v_duration,status='submitted',submitted_at=now() where id=v_row.id;
  return jsonb_build_object('success',true,'status','submitted','already_submitted',false,'video_path',p_video_path,'duration_seconds',v_duration);
end;
$$;

revoke all on function public.submit_my_property_access_challenge(uuid,text) from public, anon;
grant execute on function public.submit_my_property_access_challenge(uuid,text) to authenticated, service_role;

create or replace function public.submit_my_property_access_correction(p_request_id uuid, p_challenge_id uuid, p_video_path text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_challenge public.property_access_challenges;
  v_previous_path text;
  v_duration integer;
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text
    and role='property_partner' and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  select * into v_request from public.inspection_requests where id=p_request_id and owner_id=v_actor.user_id for update;
  if v_request.id is null then raise exception 'Property submission not found'; end if;
  if v_request.access_evidence_status<>'rejected' or v_request.lifecycle_stage<>'changes_requested' then raise exception 'Replacement evidence is not currently requested'; end if;
  select * into v_challenge from public.property_access_challenges
    where id=p_challenge_id and partner_id=v_actor.user_id and request_id=p_request_id for update;
  if v_challenge.id is null or v_challenge.status<>'prepared' then raise exception 'This one-use correction code is unavailable'; end if;
  if v_challenge.expires_at<=now() then update public.property_access_challenges set status='expired' where id=p_challenge_id; raise exception 'The one-use code expired. Create a new code and record again'; end if;
  if split_part(p_video_path,'/',1)<>v_actor.user_id or split_part(p_video_path,'/',2)<>p_challenge_id::text then raise exception 'Invalid private property access path'; end if;
  v_duration := nullif((regexp_match(p_video_path, '-([0-9]+)s[.][a-z0-9]+$'))[1],'')::integer;
  if coalesce(v_duration,0)<20 then raise exception 'Record at least 20 seconds of continuous entrance-to-interior access evidence'; end if;
  if not exists(select 1 from storage.objects where bucket_id='property-access-private' and name=p_video_path) then raise exception 'Private property access recording was not found'; end if;
  v_previous_path:=v_request.access_evidence_video_path;
  update public.property_access_challenges set video_path=p_video_path,duration_seconds=v_duration,status='consumed',submitted_at=now(),consumed_at=now() where id=p_challenge_id;
  update public.inspection_requests set access_evidence_video_path=p_video_path,access_evidence_duration_seconds=v_duration,access_evidence_status='submitted',updated_at=now() where id=p_request_id;
  if v_previous_path is not null and v_previous_path<>p_video_path then delete from storage.objects where bucket_id='property-access-private' and name=v_previous_path; end if;
  return jsonb_build_object('success',true,'status','submitted','duration_seconds',v_duration);
end;
$$;

revoke all on function public.submit_my_property_access_correction(uuid,uuid,text) from public, anon;
grant execute on function public.submit_my_property_access_correction(uuid,uuid,text) to authenticated, service_role;

-- Public reactions belong to Worker showcase posts, not to the Worker profile.
create table if not exists public.worker_showcase_reactions (
  post_id uuid not null references public.worker_showcase_posts(id) on delete cascade,
  user_id text not null references public.profiles(user_id) on delete cascade,
  emoji text not null check (emoji in ('👍','❤️','👏')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id,user_id)
);

alter table public.worker_showcase_reactions enable row level security;
drop policy if exists worker_showcase_reactions_no_direct_access on public.worker_showcase_reactions;
create policy worker_showcase_reactions_no_direct_access
on public.worker_showcase_reactions for all to authenticated
using (false) with check (false);
revoke all on table public.worker_showcase_reactions from public, anon, authenticated;
grant all on table public.worker_showcase_reactions to service_role;

create or replace function public.get_worker_showcase_reactions(p_worker_id text)
returns table(post_id uuid, emoji text, reaction_count bigint, mine boolean)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with actor as (
    select user_id from public.profiles where auth_id=(select auth.uid())::text limit 1
  )
  select r.post_id,r.emoji,count(*)::bigint,
    bool_or(r.user_id=(select user_id from actor))
  from public.worker_showcase_reactions r
  join public.worker_showcase_posts p on p.id=r.post_id
  where p.worker_id=p_worker_id and p.deleted_at is null and p.hidden_at is null
  group by r.post_id,r.emoji;
$$;

revoke all on function public.get_worker_showcase_reactions(text) from public, anon;
grant execute on function public.get_worker_showcase_reactions(text) to authenticated, service_role;

create or replace function public.set_my_worker_showcase_reaction(p_post_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.profiles;
begin
  select * into actor from public.profiles where auth_id=(select auth.uid())::text
    and role='user' and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if actor.user_id is null then raise exception 'Regular user account required'; end if;
  if not exists(select 1 from public.worker_showcase_posts where id=p_post_id and deleted_at is null and hidden_at is null) then
    raise exception 'Work post not found';
  end if;
  if p_emoji is null or btrim(p_emoji)='' then
    delete from public.worker_showcase_reactions where post_id=p_post_id and user_id=actor.user_id;
  elsif p_emoji in ('👍','❤️','👏') then
    insert into public.worker_showcase_reactions(post_id,user_id,emoji)
    values(p_post_id,actor.user_id,p_emoji)
    on conflict(post_id,user_id) do update set emoji=excluded.emoji,updated_at=now();
  else
    raise exception 'Unsupported reaction';
  end if;
  return coalesce((
    select jsonb_object_agg(emoji,reaction_count)
    from (
      select emoji,count(*)::integer reaction_count
      from public.worker_showcase_reactions where post_id=p_post_id group by emoji
    ) totals
  ),'{}'::jsonb);
end;
$$;

revoke all on function public.set_my_worker_showcase_reaction(uuid,text) from public, anon;
grant execute on function public.set_my_worker_showcase_reaction(uuid,text) to authenticated, service_role;

-- A paid hotel stay has its own guest-to-hotel conversation. This is not a
-- WeHouse Operations case: Message WeHouse remains a separate contextual action.
create table if not exists public.hotel_booking_conversations (
  id uuid primary key default gen_random_uuid(),
  booking_id integer not null unique references public.hotel_bookings(booking_id) on delete cascade,
  hotel_id integer not null references public.hotels(hotel_id) on delete cascade,
  guest_user_id text not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hotel_booking_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.hotel_booking_conversations(id) on delete cascade,
  sender_id text not null references public.profiles(user_id) on delete cascade,
  content text not null default '',
  attachments text[] not null default '{}',
  attachment_types text[] not null default '{}',
  reactions jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint hotel_booking_message_has_content check (
    nullif(btrim(content),'') is not null or cardinality(attachments)>0
  ),
  constraint hotel_booking_message_attachment_shape check (
    cardinality(attachments)=cardinality(attachment_types) and cardinality(attachments)<=6
  )
);

create index if not exists hotel_booking_conversations_guest_idx
  on public.hotel_booking_conversations(guest_user_id,updated_at desc);
create index if not exists hotel_booking_conversations_hotel_idx
  on public.hotel_booking_conversations(hotel_id,updated_at desc);
create index if not exists hotel_booking_messages_timeline_idx
  on public.hotel_booking_messages(conversation_id,created_at);
create index if not exists hotel_booking_messages_unread_idx
  on public.hotel_booking_messages(conversation_id,is_read,sender_id,created_at desc);

create or replace function public.can_access_hotel_booking_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with actor as (
    select user_id from public.profiles
    where auth_id=(select auth.uid())::text
      and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
    limit 1
  )
  select exists(
    select 1
    from public.hotel_booking_conversations c
    join public.hotels h on h.hotel_id=c.hotel_id
    cross join actor a
    where c.id=p_conversation_id
      and (
        c.guest_user_id=a.user_id
        or h.owner_id=a.user_id
        or exists(
          select 1 from public.hotel_team_members tm
          where tm.hotel_id=c.hotel_id and tm.member_user_id=a.user_id and tm.status='active'
        )
      )
  );
$$;

revoke all on function public.can_access_hotel_booking_conversation(uuid) from public, anon;
grant execute on function public.can_access_hotel_booking_conversation(uuid) to authenticated, service_role;

alter table public.hotel_booking_conversations enable row level security;
alter table public.hotel_booking_messages enable row level security;

drop policy if exists hotel_booking_conversations_read_participants on public.hotel_booking_conversations;
create policy hotel_booking_conversations_read_participants
on public.hotel_booking_conversations for select to authenticated
using (public.can_access_hotel_booking_conversation(id));

drop policy if exists hotel_booking_messages_read_participants on public.hotel_booking_messages;
create policy hotel_booking_messages_read_participants
on public.hotel_booking_messages for select to authenticated
using (public.can_access_hotel_booking_conversation(conversation_id));

revoke all on table public.hotel_booking_conversations from public, anon;
revoke all on table public.hotel_booking_messages from public, anon;
grant select on table public.hotel_booking_conversations to authenticated;
grant select on table public.hotel_booking_messages to authenticated;
grant all on table public.hotel_booking_conversations to service_role;
grant all on table public.hotel_booking_messages to service_role;

create or replace function public.open_my_hotel_booking_conversation(p_booking_id integer)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id text;
  booking public.hotel_bookings;
  result_id uuid;
begin
  select user_id into actor_id from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if actor_id is null then raise exception 'Active WeHouse account required'; end if;
  select * into booking from public.hotel_bookings where booking_id=p_booking_id for share;
  if booking.booking_id is null or booking.user_id<>actor_id then raise exception 'Hotel booking not found'; end if;
  if booking.payment_status<>'paid' or booking.status not in ('confirmed','checked_in','checked_out','completed') then
    raise exception 'Chat with the hotel opens after this stay is paid and confirmed';
  end if;
  insert into public.hotel_booking_conversations(booking_id,hotel_id,guest_user_id)
  values(booking.booking_id,booking.hotel_id,booking.user_id)
  on conflict(booking_id) do update set updated_at=public.hotel_booking_conversations.updated_at
  returning id into result_id;
  return result_id;
end;
$$;

revoke all on function public.open_my_hotel_booking_conversation(integer) from public, anon;
grant execute on function public.open_my_hotel_booking_conversation(integer) to authenticated, service_role;

create or replace function public.get_my_hotel_booking_conversations()
returns table(
  conversation_id uuid, booking_id integer, hotel_id integer, hotel_name text,
  hotel_image text, booking_code text, booking_status text, payment_status text,
  check_in date, check_out date, room_name text, guest_user_id text,
  guest_name text, other_party_label text, last_message text,
  last_message_time timestamptz, unread_count bigint, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare actor_id text;
begin
  select user_id into actor_id from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if actor_id is null then raise exception 'Active WeHouse account required'; end if;
  return query
  select c.id,b.booking_id,h.hotel_id,h.name,h.images[1],b.booking_code,b.status,b.payment_status,
    b.check_in,b.check_out,r.room_type,b.user_id,coalesce(b.guest_name,g.full_name,g.username,'Guest'),
    case when b.user_id=actor_id then h.name else coalesce(b.guest_name,g.full_name,g.username,'Guest') end,
    lm.content,lm.created_at,
    (select count(*) from public.hotel_booking_messages m
      where m.conversation_id=c.id and not m.is_read and m.sender_id<>actor_id),c.updated_at
  from public.hotel_booking_conversations c
  join public.hotel_bookings b on b.booking_id=c.booking_id
  join public.hotels h on h.hotel_id=c.hotel_id
  join public.hotel_rooms r on r.room_id=b.room_id
  join public.profiles g on g.user_id=b.user_id
  left join lateral (
    select case when nullif(btrim(m.content),'') is not null then m.content else 'Attachment' end content,m.created_at
    from public.hotel_booking_messages m where m.conversation_id=c.id order by m.created_at desc limit 1
  ) lm on true
  where public.can_access_hotel_booking_conversation(c.id)
    and lm.created_at is not null
  order by greatest(c.updated_at,lm.created_at) desc;
end;
$$;

revoke all on function public.get_my_hotel_booking_conversations() from public, anon;
grant execute on function public.get_my_hotel_booking_conversations() to authenticated, service_role;

create or replace function public.get_hotel_booking_messages(p_conversation_id uuid)
returns table(
  id uuid, sender_id text, sender_name text, sender_role text, content text,
  attachments text[], attachment_types text[], reactions jsonb,
  is_read boolean, created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.can_access_hotel_booking_conversation(p_conversation_id) then raise exception 'Hotel conversation access denied'; end if;
  return query
  select m.id,m.sender_id,coalesce(p.full_name,p.username,'Member'),
    case when m.sender_id=c.guest_user_id then 'guest' else 'hotel' end,
    m.content,m.attachments,m.attachment_types,m.reactions,m.is_read,m.created_at
  from public.hotel_booking_messages m
  join public.hotel_booking_conversations c on c.id=m.conversation_id
  join public.profiles p on p.user_id=m.sender_id
  where m.conversation_id=p_conversation_id order by m.created_at;
end;
$$;

revoke all on function public.get_hotel_booking_messages(uuid) from public, anon;
grant execute on function public.get_hotel_booking_messages(uuid) to authenticated, service_role;

create or replace function public.send_hotel_booking_message(
  p_conversation_id uuid, p_content text default '', p_attachments text[] default '{}', p_attachment_types text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor_id text; message_id uuid; booking public.hotel_bookings;
begin
  select user_id into actor_id from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if actor_id is null or not public.can_access_hotel_booking_conversation(p_conversation_id) then raise exception 'Hotel conversation access denied'; end if;
  select b.* into booking from public.hotel_booking_conversations c join public.hotel_bookings b on b.booking_id=c.booking_id
    where c.id=p_conversation_id for share of b;
  if booking.payment_status<>'paid' or booking.status not in ('confirmed','checked_in','checked_out','completed') then
    raise exception 'This hotel conversation is not currently open';
  end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null and cardinality(coalesce(p_attachments,'{}'))=0 then raise exception 'Write a message or attach a file'; end if;
  if cardinality(coalesce(p_attachments,'{}'))<>cardinality(coalesce(p_attachment_types,'{}')) or cardinality(coalesce(p_attachments,'{}'))>6 then raise exception 'Invalid attachments'; end if;
  if exists(select 1 from unnest(coalesce(p_attachments,'{}')) path where split_part(path,'/',1)<>p_conversation_id::text or split_part(path,'/',2)<>actor_id) then
    raise exception 'Invalid private hotel attachment path';
  end if;
  insert into public.hotel_booking_messages(conversation_id,sender_id,content,attachments,attachment_types)
  values(p_conversation_id,actor_id,btrim(coalesce(p_content,'')),coalesce(p_attachments,'{}'),coalesce(p_attachment_types,'{}'))
  returning id into message_id;
  update public.hotel_booking_conversations set updated_at=now() where id=p_conversation_id;
  return message_id;
end;
$$;

revoke all on function public.send_hotel_booking_message(uuid,text,text[],text[]) from public, anon;
grant execute on function public.send_hotel_booking_message(uuid,text,text[],text[]) to authenticated, service_role;

create or replace function public.mark_hotel_booking_messages_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor_id text;
begin
  select user_id into actor_id from public.profiles where auth_id=(select auth.uid())::text limit 1;
  if actor_id is null or not public.can_access_hotel_booking_conversation(p_conversation_id) then raise exception 'Hotel conversation access denied'; end if;
  update public.hotel_booking_messages set is_read=true
  where conversation_id=p_conversation_id and sender_id<>actor_id and not is_read;
end;
$$;

revoke all on function public.mark_hotel_booking_messages_read(uuid) from public, anon;
grant execute on function public.mark_hotel_booking_messages_read(uuid) to authenticated, service_role;

create or replace function public.set_hotel_booking_message_reaction(p_conversation_id uuid,p_message_id uuid,p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor_id text; result jsonb;
begin
  select user_id into actor_id from public.profiles where auth_id=(select auth.uid())::text limit 1;
  if actor_id is null or not public.can_access_hotel_booking_conversation(p_conversation_id) then raise exception 'Hotel conversation access denied'; end if;
  if nullif(p_emoji,'') is not null and p_emoji not in ('👍','❤️','😂','😮','😢','🙏') then raise exception 'Unsupported reaction'; end if;
  update public.hotel_booking_messages
  set reactions=case when nullif(p_emoji,'') is null then reactions-actor_id else jsonb_set(reactions,array[actor_id],to_jsonb(p_emoji),true) end
  where id=p_message_id and conversation_id=p_conversation_id returning reactions into result;
  if result is null then raise exception 'Message not found'; end if;
  return result;
end;
$$;

revoke all on function public.set_hotel_booking_message_reaction(uuid,uuid,text) from public, anon;
grant execute on function public.set_hotel_booking_message_reaction(uuid,uuid,text) to authenticated, service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hotel-chat-files','hotel-chat-files',false,26214400,array['image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/mpeg','audio/ogg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists hotel_chat_files_read_participants on storage.objects;
create policy hotel_chat_files_read_participants on storage.objects for select to authenticated
using(
  bucket_id='hotel-chat-files' and exists(
    select 1 from public.hotel_booking_conversations c
    where c.id::text=(storage.foldername(name))[1]
      and public.can_access_hotel_booking_conversation(c.id)
  )
);
drop policy if exists hotel_chat_files_insert_participants on storage.objects;
create policy hotel_chat_files_insert_participants on storage.objects for insert to authenticated
with check(
  bucket_id='hotel-chat-files'
  and exists(
    select 1 from public.hotel_booking_conversations c
    where c.id::text=(storage.foldername(name))[1]
      and public.can_access_hotel_booking_conversation(c.id)
  )
  and (storage.foldername(name))[2]=public.current_profile_user_id()
);
drop policy if exists hotel_chat_files_delete_own on storage.objects;
create policy hotel_chat_files_delete_own on storage.objects for delete to authenticated
using(
  bucket_id='hotel-chat-files'
  and exists(
    select 1 from public.hotel_booking_conversations c
    where c.id::text=(storage.foldername(name))[1]
      and public.can_access_hotel_booking_conversation(c.id)
  )
  and (storage.foldername(name))[2]=public.current_profile_user_id()
);

do $$
begin
  alter publication supabase_realtime add table public.hotel_booking_messages;
exception when duplicate_object then null;
end $$;
