-- Canonicalize the Friends domain after the historical Companion implementation.
-- Read-only checks on 2026-10-19 found no relationships, messages, request logs,
-- encryption envelopes or Friend media in Test; Production has no Friend schema.
-- Rename empty Test objects and establish the Friend-first API/schema for both.

DO $$ BEGIN
  IF to_regclass('public.friends') IS NULL AND to_regclass('public.companions') IS NOT NULL THEN
    ALTER TABLE public.companions RENAME TO friends;
  END IF;
  IF to_regclass('public.friend_messages') IS NULL AND to_regclass('public.companion_messages') IS NOT NULL THEN
    ALTER TABLE public.companion_messages RENAME TO friend_messages;
  END IF;
  IF to_regclass('public.friend_request_log') IS NULL AND to_regclass('public.companion_request_log') IS NOT NULL THEN
    ALTER TABLE public.companion_request_log RENAME TO friend_request_log;
  END IF;
  IF to_regclass('public.friend_messages') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='friend_messages' AND column_name='companion_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='friend_messages' AND column_name='friend_id') THEN
    ALTER TABLE public.friend_messages RENAME COLUMN companion_id TO friend_id;
  END IF;
END $$;

DO $$
DECLARE item record; new_name text;
BEGIN
  FOR item IN
    SELECT conrelid, conname FROM pg_constraint
    WHERE conrelid IN (to_regclass('public.friends'),to_regclass('public.friend_messages'),to_regclass('public.friend_request_log'))
      AND conname ILIKE 'companion%'
  LOOP
    new_name := replace(replace(item.conname,'companions','friends'),'companion','friend');
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',item.conrelid::regclass,item.conname,new_name);
  END LOOP;
  FOR item IN
    SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('i','S') AND c.relname ILIKE 'companion%'
  LOOP
    new_name := replace(replace(item.relname,'companions','friends'),'companion','friend');
    IF to_regclass(format('public.%I',new_name)) IS NULL THEN
      IF item.relkind='i' THEN EXECUTE format('ALTER INDEX public.%I RENAME TO %I',item.relname,new_name);
      ELSE EXECUTE format('ALTER SEQUENCE public.%I RENAME TO %I',item.relname,new_name); END IF;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.conversation_key_envelopes
  DROP CONSTRAINT IF EXISTS conversation_key_envelopes_conversation_kind_check;
UPDATE public.conversation_key_envelopes SET conversation_kind='friend' WHERE conversation_kind='companion';
UPDATE storage.objects SET name=replace(name,'e2ee/companion/','e2ee/friend/') WHERE bucket_id='chat-files' AND name LIKE 'e2ee/companion/%';

DROP FUNCTION IF EXISTS private.friend_chat_access(uuid,boolean);
DROP FUNCTION IF EXISTS public.create_my_shared_long_let(uuid,uuid[],text[]);
-- friend is a mutual relationship (request, then accept) that is separate from Roommate.
-- It exists only to choose who pays with you. It shares no tables, status or chat with Roommate.
-- Also caps payers on a shared payment group at 3 and never above the booking's guest count.

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_low text not null,
  user_high text not null,
  requested_by text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friends_ordered_pair check (user_low < user_high),
  constraint friends_requester_in_pair check (requested_by in (user_low, user_high)),
  constraint friends_status_check check (status in ('pending','accepted','declined','removed')),
  constraint friends_unique_pair unique (user_low, user_high)
);

alter table public.friends enable row level security;
revoke all on table public.friends from public, anon, authenticated;
grant all on table public.friends to service_role;

create or replace function public.are_friends(p_user_a text, p_user_b text)
returns boolean language sql stable security definer set search_path = 'pg_catalog','public' as $$
  select exists(
    select 1 from public.friends c
    where c.user_low = least(p_user_a, p_user_b)
      and c.user_high = greatest(p_user_a, p_user_b)
      and c.status = 'accepted'
  )
$$;
revoke all on function public.are_friends(text,text) from public, anon, authenticated;
grant execute on function public.are_friends(text,text) to service_role;

create or replace function public.send_friend_request(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  lo text; hi text; c public.friends;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_user_id is null or p_user_id = actor then
    raise exception 'Choose another person';
  end if;
  if not exists(select 1 from public.profiles p where p.user_id = p_user_id and p.account_kind = 'consumer'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
    raise exception 'That person cannot receive a friend request';
  end if;
  if exists(select 1 from public.roommate_user_blocks b
      where (b.blocker_user_id = actor and b.blocked_user_id = p_user_id)
         or (b.blocker_user_id = p_user_id and b.blocked_user_id = actor)) then
    raise exception 'That person cannot receive a friend request';
  end if;

  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  select * into c from public.friends where user_low = lo and user_high = hi for update;
  if c.id is null then
    insert into public.friends(user_low, user_high, requested_by) values (lo, hi, actor) returning * into c;
  elsif c.status in ('pending','accepted') then
    null;
  elsif c.status = 'declined' and c.responded_at > now() - interval '30 days' then
    raise exception 'That person cannot receive a friend request';
  else
    update public.friends set status = 'pending', requested_by = actor, responded_at = null, updated_at = now()
    where id = c.id returning * into c;
  end if;
  return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
end $$;

create or replace function public.send_friend_request_by_username(p_username text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare target text;
begin
  select p.user_id into target from public.profiles p
  where lower(p.username) = lower(btrim(coalesce(p_username, ''))) and btrim(coalesce(p_username, '')) <> ''
    and p.account_kind = 'consumer'
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
  limit 1;
  if target is null then raise exception 'That person cannot receive a friend request'; end if;
  return public.send_friend_request(target);
end $$;

create or replace function public.respond_to_friend_request(p_friend_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.friends;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into c from public.friends where id = p_friend_id for update;
  if c.id is null or c.status <> 'pending' or c.requested_by = actor or actor not in (c.user_low, c.user_high) then
    raise exception 'Pending friend request not found';
  end if;
  update public.friends
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now(), updated_at = now()
  where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;

create or replace function public.remove_friend(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); n integer;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  update public.friends set status = 'removed', responded_at = now(), updated_at = now()
  where user_low = least(actor, p_user_id) and user_high = greatest(actor, p_user_id)
    and status in ('pending','accepted');
  get diagnostics n = row_count;
  return jsonb_build_object('removed', n > 0);
end $$;

create or replace function public.list_my_friends()
returns jsonb language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id();
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'friend_id', c.id,
      'user_id', other.user_id,
      'full_name', other.full_name,
      'username', other.username,
      'status', c.status,
      'requested_by_me', c.requested_by = actor
    ) order by c.updated_at desc)
    from public.friends c
    join public.profiles other on other.user_id = case when c.user_low = actor then c.user_high else c.user_low end
    where actor in (c.user_low, c.user_high) and c.status in ('pending','accepted')
  ), '[]'::jsonb);
end $$;

revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.send_friend_request_by_username(text) from public, anon;
revoke all on function public.respond_to_friend_request(uuid,boolean) from public, anon;
revoke all on function public.remove_friend(text) from public, anon;
revoke all on function public.list_my_friends() from public, anon;
grant execute on function public.send_friend_request(text) to authenticated, service_role;
grant execute on function public.send_friend_request_by_username(text) to authenticated, service_role;
grant execute on function public.respond_to_friend_request(uuid,boolean) to authenticated, service_role;
grant execute on function public.remove_friend(text) to authenticated, service_role;
grant execute on function public.list_my_friends() to authenticated, service_role;

-- Payer cap: at most 3 payers per shared payment group, and never more than the booking's guests.
create or replace function public.guard_shared_payment_member_cap()
returns trigger language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare current_count integer; guests integer;
begin
  if new.invitation_state in ('declined','removed') then return new; end if;
  select count(*) into current_count from public.shared_payment_members m
  where m.shared_payment_group_id = new.shared_payment_group_id
    and m.invitation_state not in ('declined','removed')
    and m.shared_payment_member_id is distinct from new.shared_payment_member_id;
  select g.guest_count into guests from public.shared_payment_groups g
  where g.shared_payment_group_id = new.shared_payment_group_id;
  if current_count + 1 > 3 then
    raise exception 'At most 3 people can pay for one stay';
  end if;
  if guests is not null and current_count + 1 > guests then
    raise exception 'Paying people cannot exceed the number of guests';
  end if;
  return new;
end $$;
revoke all on function public.guard_shared_payment_member_cap() from public, anon, authenticated;
grant execute on function public.guard_shared_payment_member_cap() to service_role;

drop trigger if exists shared_payment_member_cap on public.shared_payment_members;
create trigger shared_payment_member_cap
  before insert or update of invitation_state on public.shared_payment_members
  for each row execute function public.guard_shared_payment_member_cap();

-- Short Let cost sharing is chosen from friends, never from Roommate conversations.
-- Payers (booker included) are capped at 3 and can never exceed the reserved guest count.
-- Reserve date is never split. Only the stay and the refundable deposit are shared.

drop function if exists public.create_my_shared_short_let(text, uuid[]);

create or replace function public.create_my_shared_short_let(p_reservation_id text, p_user_ids text[])
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
 r public.reservations; l public.listings; actor text := public.current_profile_user_id();
 peer text; peers text[] := '{}'::text[]; people text[];
 requested_peers text[]; existing_peers text[]; member_count integer; capacity integer;
 gid uuid := gen_random_uuid(); mid uuid; total numeric(12,2); eligible numeric(12,2);
 refundable numeric(12,2); share numeric(12,2); eligible_share numeric(12,2);
 refundable_share numeric(12,2); assigned numeric(12,2) := 0;
 eligible_assigned numeric(12,2) := 0; refundable_assigned numeric(12,2) := 0;
 i integer; deadline timestamptz;
begin
 if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required'; end if;
 select * into r from public.reservations where id = p_reservation_id and user_id = actor and stay_type = 'short_let';
 if r.id is null then raise exception 'Your Short Let reservation was not found'; end if;
 perform 1 from public.listings where id::text = r.listing_id for update;
 select * into r from public.reservations where id = p_reservation_id and user_id = actor and stay_type = 'short_let' for update;
 select * into l from public.listings where id::text = r.listing_id and deleted_at is null and sub_type = 'short_let' for share;
 if l.id is null then raise exception 'Short Let not found'; end if;
 if r.status not in ('reserved','ready_for_move_in') or r.reservation_fee_status <> 'paid'
   or r.manual_payment_status not in ('paid','completed') or r.reservation_fee_paid_at is null then
   raise exception 'Pay Reserve date before splitting the remaining stay cost'; end if;
 if r.short_stay_balance_due_at is null or r.short_stay_balance_due_at <= now() then raise exception 'The stay balance deadline has passed. Reserve the dates again'; end if;
 if r.rent_payment_status in ('payment_pending','paid','upfront_paid') or r.rent_payment_reference is not null
   or exists(select 1 from public.booking_payments p where p.metadata->>'reservation_id' = r.id
     and p.purpose = 'apartment_rent' and p.status not in ('failed','cancelled','expired','refunded','reversed')) then
   raise exception 'Finish or cancel the existing stay checkout before splitting costs'; end if;
 if coalesce(cardinality(p_user_ids), 0) < 1
   or cardinality(p_user_ids) >= coalesce(r.guest_count, 0)
   or cardinality(p_user_ids) >= 3
   or cardinality(p_user_ids) <> (select count(distinct x) from unnest(p_user_ids) x) then
   raise exception 'Choose distinct friends within the reserved guest count, with at most 3 paying people'; end if;

 foreach peer in array p_user_ids loop
   if peer is null or peer = actor then raise exception 'Choose each friend once'; end if;
   if not public.are_friends(actor, peer) then
     raise exception 'Only accepted friends can share a Short Let stay'; end if;
   if not exists(select 1 from public.profiles p where p.user_id = peer and p.account_kind = 'consumer'
     and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
     raise exception 'Every invited person must have an active Personal account'; end if;
   peers := array_append(peers, peer);
 end loop;

 requested_peers := array(select unnest(peers) order by 1);
 if r.shared_payment_group_id is not null then
   select array_agg(m.user_id order by m.user_id) into existing_peers
   from public.shared_housing_members m where m.group_id = r.shared_payment_group_id and m.user_id <> actor;
   if existing_peers is distinct from requested_peers then raise exception 'This stay already has a different shared payment'; end if;
   return public.get_my_shared_housing_group(r.shared_payment_group_id);
 end if;

 capacity := coalesce(l.max_guests, 0); people := array_prepend(actor, peers); member_count := cardinality(people);
 if member_count < 2 or member_count > capacity or member_count > 3 then raise exception 'Selected paying guests exceed this Short Let capacity'; end if;
 eligible := round(coalesce(r.stay_rent_total, 0), 2); refundable := round(coalesce(r.security_deposit_snapshot, 0), 2); total := eligible + refundable;
 if eligible <= 0 or refundable < 0 or total <= 0 then raise exception 'Stored Short Let balance is invalid'; end if;
 deadline := r.short_stay_balance_due_at;

 insert into public.shared_housing_groups(
   id,listing_id,created_by,status,member_limit,total_amount,conversation_id,payment_phase,
   reservation_fee_total,contract_total,expires_at,reservation_id,product_type,canonical_group_id,
   stay_check_in,stay_check_out,guest_count,checkout_attempt,created_at,updated_at
 ) values(gid,l.id,actor,'inviting',member_count,total,null,
   'short_stay',0,total,deadline,r.id,'short_let',gid,r.stay_check_in,r.stay_check_out,r.guest_count,1,now(),now());

 insert into public.shared_payment_groups(
   shared_payment_group_id,product_type,listing_id,reservation_id,created_by,total_amount,capacity,status,
   checkout_expires_at,legacy_group_id,conversation_id,payment_phase,stay_check_in,stay_check_out,
   guest_count,checkout_attempt,created_at,updated_at
 ) values(gid,'short_let',l.id::text,r.id,actor,total,capacity,'inviting',deadline,gid,null,
   'short_stay',r.stay_check_in,r.stay_check_out,r.guest_count,1,now(),now());

 for i in 1..member_count loop
   mid := gen_random_uuid();
   share := (floor(total*100/member_count) + case when i <= mod((total*100)::bigint, member_count) then 1 else 0 end)/100;
   eligible_share := (floor(eligible*100/member_count) + case when i <= mod((eligible*100)::bigint, member_count) then 1 else 0 end)/100;
   refundable_share := share - eligible_share;
   insert into public.shared_housing_members(
     id,group_id,user_id,invitation_status,share_amount,payment_status,canonical_member_id,
     eligible_partner_share,refundable_share,created_at,updated_at
   ) values(mid,gid,people[i],case when i = 1 then 'accepted' else 'invited' end,share,'not_started',
     mid,eligible_share,refundable_share,now(),now());
   insert into public.shared_payment_members(
     shared_payment_member_id,shared_payment_group_id,user_id,share_amount,invitation_state,payment_state,
     legacy_member_id,eligible_partner_share,refundable_share,created_at,updated_at
   ) values(mid,gid,people[i],share,case when i = 1 then 'accepted' else 'invited' end,'not_started',
     mid,eligible_share,refundable_share,now(),now());
   assigned := assigned + share; eligible_assigned := eligible_assigned + eligible_share; refundable_assigned := refundable_assigned + refundable_share;
 end loop;
 if round(assigned,2) <> total or round(eligible_assigned,2) <> eligible or round(refundable_assigned,2) <> refundable then
   raise exception 'Shared Short Let split did not reconcile'; end if;
 update public.reservations set shared_payment_group_id = gid, updated_at = now() where id = r.id;
 return public.get_my_shared_housing_group(gid);
end $$;

revoke all on function public.create_my_shared_short_let(text, text[]) from public, anon;
grant execute on function public.create_my_shared_short_let(text, text[]) to authenticated, service_role;

-- friend rules (C-029, C-030): a bucket of at most 5, cancel with a 30-day wait, and a private encrypted chat.
-- There is no block: friend is a connection state that either side can cancel.
-- Nothing here reads or writes Roommate tables. The server only stores ciphertext.

create table if not exists public.friend_messages (
  id uuid primary key default gen_random_uuid(),
  friend_id uuid not null references public.friends(id) on delete cascade,
  sender_id text not null,
  ciphertext text not null,
  encryption_iv text not null,
  encryption_version integer not null default 1,
  encrypted_attachments jsonb not null default '[]'::jsonb,
  reply_to_id uuid references public.friend_messages(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists friend_messages_thread_idx on public.friend_messages(friend_id, created_at);

alter table public.friend_messages enable row level security;
revoke all on table public.friend_messages from public, anon, authenticated;
grant all on table public.friend_messages to service_role;

-- Bucket size: accepted friends plus requests the user has sent and not yet had answered.
create or replace function public.friend_bucket_count(p_user_id text)
returns integer language sql stable security definer set search_path = 'pg_catalog','public' as $$
  select count(*)::integer from public.friends c
  where p_user_id in (c.user_low, c.user_high)
    and (c.status = 'accepted' or (c.status = 'pending' and c.requested_by = p_user_id))
$$;
revoke all on function public.friend_bucket_count(text) from public, anon, authenticated;
grant execute on function public.friend_bucket_count(text) to service_role;

-- The one place to change how long a cancelled or declined pair must wait before asking again.
create or replace function public.friend_rerequest_wait()
returns interval language sql immutable set search_path = 'pg_catalog' as $$ select interval '30 days' $$;
revoke all on function public.friend_rerequest_wait() from public, anon, authenticated;
grant execute on function public.friend_rerequest_wait() to service_role;

create or replace function public.send_friend_request(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  lo text; hi text; c public.friends;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_user_id is null or p_user_id = actor then
    raise exception 'Choose another person';
  end if;
  if not exists(select 1 from public.profiles p where p.user_id = p_user_id and p.account_kind = 'consumer'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
    raise exception 'That person cannot receive a friend request';
  end if;
  -- Serialise bucket changes for both people so concurrent requests cannot push a list past 5.
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || least(actor, p_user_id)));
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || greatest(actor, p_user_id)));

  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  select * into c from public.friends where user_low = lo and user_high = hi for update;
  if c.id is not null and c.status in ('pending','accepted') then
    return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
  end if;
  if c.id is not null and c.status in ('declined','removed') and c.responded_at > now() - public.friend_rerequest_wait() then
    raise exception 'That person cannot receive a friend request';
  end if;
  if public.friend_bucket_count(actor) >= 5 then
    raise exception 'Your friend list is full. Remove a friend to add another';
  end if;
  if public.friend_bucket_count(p_user_id) >= 5 then
    raise exception 'That person cannot receive a friend request';
  end if;

  if c.id is null then
    insert into public.friends(user_low, user_high, requested_by) values (lo, hi, actor) returning * into c;
  else
    update public.friends set status = 'pending', requested_by = actor, responded_at = null, updated_at = now()
    where id = c.id returning * into c;
  end if;
  return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
end $$;

create or replace function public.respond_to_friend_request(p_friend_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.friends;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into c from public.friends where id = p_friend_id;
  if c.id is not null then
    perform pg_advisory_xact_lock(hashtext('friend_bucket:' || c.user_low));
    perform pg_advisory_xact_lock(hashtext('friend_bucket:' || c.user_high));
  end if;
  select * into c from public.friends where id = p_friend_id for update;
  if c.id is null or c.status <> 'pending' or c.requested_by = actor or actor not in (c.user_low, c.user_high) then
    raise exception 'Pending friend request not found';
  end if;
  if p_accept then
    if public.friend_bucket_count(actor) >= 5 then
      raise exception 'Your friend list is full. Remove a friend to add another';
    end if;
  end if;
  update public.friends
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now(), updated_at = now()
  where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;

create or replace function public.send_friend_encrypted_message(
  p_friend_id uuid, p_ciphertext text, p_encryption_iv text,
  p_encrypted_attachments jsonb default '[]'::jsonb, p_reply_to_id uuid default null)
returns uuid language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.friends; peer text; mid uuid;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if nullif(p_ciphertext, '') is null or nullif(p_encryption_iv, '') is null then
    raise exception 'Encrypted payload is required';
  end if;
  select * into c from public.friends where id = p_friend_id;
  if c.id is null or c.status <> 'accepted' or actor not in (c.user_low, c.user_high) then
    raise exception 'Conversation access denied';
  end if;
  peer := case when c.user_low = actor then c.user_high else c.user_low end;
  if p_reply_to_id is not null and not exists(
    select 1 from public.friend_messages where id = p_reply_to_id and friend_id = c.id) then
    raise exception 'Reply target is not in this conversation';
  end if;
  insert into public.friend_messages(friend_id, sender_id, ciphertext, encryption_iv, encrypted_attachments, reply_to_id)
  values (c.id, actor, p_ciphertext, p_encryption_iv, coalesce(p_encrypted_attachments, '[]'::jsonb), p_reply_to_id)
  returning id into mid;
  return mid;
end $$;

create or replace function public.get_friend_encrypted_messages(p_friend_id uuid)
returns table(id uuid, sender_id text, ciphertext text, encryption_iv text, encryption_version integer,
  encrypted_attachments jsonb, reply_to_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); c public.friends;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  select * into c from public.friends where friends.id = p_friend_id;
  if c.id is null or c.status <> 'accepted' or actor not in (c.user_low, c.user_high) then
    raise exception 'Conversation access denied';
  end if;
  return query
    select m.id, m.sender_id, m.ciphertext, m.encryption_iv, m.encryption_version,
           m.encrypted_attachments, m.reply_to_id, m.created_at
    from public.friend_messages m where m.friend_id = c.id order by m.created_at;
end $$;

revoke all on function public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid),
  public.get_friend_encrypted_messages(uuid) from public, anon, authenticated;
grant execute on function public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid),
  public.get_friend_encrypted_messages(uuid) to authenticated, service_role;

-- Long Let cost sharing can now be chosen from Roommates (accepted roommate conversations) or friends.
-- Payers (booker included) are capped at 3 and can never exceed the property's occupant capacity.
-- Replaces the Roommate-only entry point for new Long Let groups; existing groups are untouched.

create or replace function public.create_my_shared_long_let(
  p_listing_id uuid,
  p_roommate_conversation_ids uuid[] default '{}'::uuid[],
  p_friend_user_ids text[] default '{}'::text[]
) returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  v_actor public.profiles; v_listing public.listings; v_conversation public.conversations;
  v_conversation_id uuid; v_peer text; v_peers text[] := '{}'::text[]; v_people text[];
  v_capacity integer; v_member_count integer; v_total numeric(12,2); v_fee numeric(12,2);
  v_group_id uuid := gen_random_uuid(); v_member_id uuid; v_share numeric(12,2);
  v_assigned numeric(12,2) := 0; v_index integer; v_single_conversation uuid;
begin
  select * into v_actor from public.profiles
  where auth_id = (select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'An active Personal account is required';
  end if;
  p_roommate_conversation_ids := coalesce(p_roommate_conversation_ids, '{}'::uuid[]);
  p_friend_user_ids := coalesce(p_friend_user_ids, '{}'::text[]);
  if cardinality(p_roommate_conversation_ids) + cardinality(p_friend_user_ids) < 1 then
    raise exception 'Choose at least one Roommate or friend';
  end if;

  select * into v_listing from public.listings where id = p_listing_id and deleted_at is null for update;
  if v_listing.id is null or v_listing.property_type <> 'apartment' or v_listing.sub_type <> 'long_stay'
    or v_listing.status <> 'available' or v_listing.availability_status <> 'available' then
    raise exception 'This property is unavailable';
  end if;
  v_capacity := coalesce(v_listing.max_occupants, 0);
  if v_capacity < 2 then raise exception 'This property cannot accept two paying occupants'; end if;

  foreach v_conversation_id in array p_roommate_conversation_ids loop
    select * into v_conversation from public.conversations
    where id = v_conversation_id and conversation_type = 'roommate'
      and coalesce(status,'active') in ('active','accepted')
      and v_actor.user_id in (participant_a, participant_b);
    if v_conversation.id is null then raise exception 'Every Roommate must have an accepted roommate conversation'; end if;
    v_peer := case when v_conversation.participant_a = v_actor.user_id then v_conversation.participant_b else v_conversation.participant_a end;
    if v_peer = any(v_peers) then raise exception 'Choose each person once'; end if;
    if exists(select 1 from public.roommate_user_blocks b
      where (b.blocker_user_id = v_actor.user_id and b.blocked_user_id = v_peer)
         or (b.blocker_user_id = v_peer and b.blocked_user_id = v_actor.user_id)) then
      raise exception 'A blocked person cannot join a shared payment';
    end if;
    v_peers := array_append(v_peers, v_peer);
  end loop;

  foreach v_peer in array p_friend_user_ids loop
    if v_peer is null or v_peer = v_actor.user_id or v_peer = any(v_peers) then raise exception 'Choose each person once'; end if;
    if not public.are_friends(v_actor.user_id, v_peer) then
      raise exception 'Only accepted friends can share this stay'; end if;
    v_peers := array_append(v_peers, v_peer);
  end loop;

  if exists(select 1 from unnest(v_peers) pp where not exists(
      select 1 from public.profiles p where p.user_id = pp and p.account_kind = 'consumer'
        and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false))) then
    raise exception 'Every invited person must have an active Personal account';
  end if;

  v_people := array_prepend(v_actor.user_id, v_peers);
  v_member_count := cardinality(v_people);
  if v_member_count > 3 then raise exception 'At most 3 people can pay for one property'; end if;
  if v_member_count > v_capacity then raise exception 'This property accepts only % occupants', v_capacity; end if;
  if exists(
    select 1 from public.shared_housing_groups g
    join public.shared_housing_members m on m.group_id = g.id
    where g.listing_id = v_listing.id and m.user_id = v_actor.user_id
      and g.status not in ('cancelled','expired','refunded')
  ) then raise exception 'You already have an active shared payment for this property'; end if;

  select coalesce(nullif(value,'')::numeric,10000) into v_fee
  from public.platform_settings where key = 'reservation_fee' and coalesce(is_active,true) limit 1;
  v_total := round(coalesce(v_fee,10000),2);
  if v_total <= 0 then raise exception 'Creator reservation fee is not configured'; end if;

  v_single_conversation := case when cardinality(p_roommate_conversation_ids) = 1 and cardinality(p_friend_user_ids) = 0
    then p_roommate_conversation_ids[1] else null end;

  insert into public.shared_housing_groups(
    id,listing_id,created_by,status,member_limit,total_amount,conversation_id,payment_phase,
    reservation_fee_total,contract_total,expires_at,product_type,canonical_group_id,
    guest_count,checkout_attempt,created_at,updated_at
  ) values(
    v_group_id,v_listing.id,v_actor.user_id,'inviting',v_member_count,v_total,v_single_conversation,'reservation_fee',
    v_total,round(v_listing.price + coalesce(v_listing.security_deposit_amount,0),2),
    now() + interval '72 hours','long_let',v_group_id,v_member_count,1,now(),now()
  );
  insert into public.shared_payment_groups(
    shared_payment_group_id,product_type,listing_id,created_by,total_amount,capacity,status,
    checkout_expires_at,legacy_group_id,conversation_id,payment_phase,guest_count,checkout_attempt,created_at,updated_at
  ) values(
    v_group_id,'long_let',v_listing.id::text,v_actor.user_id,v_total,v_capacity,'inviting',
    now() + interval '72 hours',v_group_id,v_single_conversation,'reservation_fee',v_member_count,1,now(),now()
  );

  for v_index in 1..v_member_count loop
    v_member_id := gen_random_uuid();
    v_share := case when v_index = v_member_count then v_total - v_assigned else round(v_total / v_member_count, 2) end;
    insert into public.shared_housing_members(
      id,group_id,user_id,invitation_status,share_amount,payment_status,canonical_member_id,
      eligible_partner_share,refundable_share,created_at,updated_at
    ) values(
      v_member_id,v_group_id,v_people[v_index],case when v_index = 1 then 'accepted' else 'invited' end,
      v_share,'not_started',v_member_id,0,v_share,now(),now()
    );
    insert into public.shared_payment_members(
      shared_payment_member_id,shared_payment_group_id,user_id,share_amount,invitation_state,payment_state,
      legacy_member_id,eligible_partner_share,refundable_share,created_at,updated_at
    ) values(
      v_member_id,v_group_id,v_people[v_index],v_share,case when v_index = 1 then 'accepted' else 'invited' end,
      'not_started',v_member_id,0,v_share,now(),now()
    );
    v_assigned := v_assigned + v_share;
  end loop;
  return public.get_my_shared_housing_group(v_group_id);
end $$;

revoke all on function public.create_my_shared_long_let(uuid, uuid[], text[]) from public, anon;
grant execute on function public.create_my_shared_long_let(uuid, uuid[], text[]) to authenticated, service_role;

-- The old Roommate-only Long Let entry points stay for existing clients but now share the 3-payer cap through
-- the shared_payment_member_cap trigger.

-- Lets accepted friends set up the same end-to-end encryption key exchange used by Roommate and Worker chats.
-- conversation_id for kind 'friend' is friends.id.
alter table public.conversation_key_envelopes drop constraint if exists conversation_key_envelopes_conversation_kind_check;
alter table public.conversation_key_envelopes add constraint conversation_key_envelopes_conversation_kind_check
  check (conversation_kind = any (array['roommate'::text,'worker'::text,'friend'::text]));

create or replace function public.establish_private_conversation_key(p_conversation_kind text, p_conversation_id uuid, p_envelopes jsonb) returns boolean
language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); first_user text; second_user text; envelope_count integer;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if p_conversation_kind='roommate' then
    select participant_a,participant_b into first_user,second_user from public.conversations where id=p_conversation_id and actor in(participant_a,participant_b);
  elsif p_conversation_kind='worker' then
    select user_id,worker_id into first_user,second_user from public.booking_conversations where id=p_conversation_id and actor in(user_id,worker_id);
  elsif p_conversation_kind='friend' then
    select user_low,user_high into first_user,second_user from public.friends where id=p_conversation_id and status='accepted' and actor in(user_low,user_high);
  else raise exception 'Unsupported private conversation kind'; end if;
  if first_user is null or second_user is null then raise exception 'Conversation access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_conversation_kind||':'||p_conversation_id::text,0));
  if exists(select 1 from public.conversation_key_envelopes where conversation_kind=p_conversation_kind and conversation_id=p_conversation_id) then return false; end if;
  select count(*) into envelope_count from jsonb_array_elements(coalesce(p_envelopes,'[]'::jsonb));
  if envelope_count<>2 then raise exception 'Exactly two participant envelopes are required'; end if;
  if not exists(select 1 from jsonb_array_elements(p_envelopes) e where e->>'recipient_user_id'=first_user)
     or not exists(select 1 from jsonb_array_elements(p_envelopes) e where e->>'recipient_user_id'=second_user)
     or exists(select 1 from jsonb_array_elements(p_envelopes) e where e->>'recipient_user_id' not in(first_user,second_user)) then raise exception 'Envelope recipients must be the conversation participants'; end if;
  insert into public.conversation_key_envelopes(conversation_kind,conversation_id,recipient_user_id,recipient_key_version,sender_ephemeral_public_key_jwk,wrapped_key,wrap_iv)
  select p_conversation_kind,p_conversation_id,e->>'recipient_user_id',(e->>'recipient_key_version')::integer,e->'sender_ephemeral_public_key_jwk',e->>'wrapped_key',e->>'wrap_iv'
  from jsonb_array_elements(p_envelopes) e join public.user_encryption_identities identity on identity.user_id=e->>'recipient_user_id' and identity.key_version=(e->>'recipient_key_version')::integer;
  if not found then raise exception 'Current participant encryption identities are required'; end if;
  if (select count(*) from public.conversation_key_envelopes where conversation_kind=p_conversation_kind and conversation_id=p_conversation_id)<>2 then raise exception 'Both current participant keys are required'; end if;
  return true;
end; $$;

create or replace function public.get_private_chat_peer_public_key(p_conversation_kind text, p_conversation_id uuid, p_peer_user_id text) returns table(user_id text, key_version integer, public_key_jwk jsonb)
language plpgsql security definer set search_path to '' as $$
declare actor text:=public.current_profile_user_id(); begin if actor is null then raise exception 'Active WeHouse profile required'; end if;
if p_conversation_kind='roommate' then if not exists(select 1 from public.conversations c where c.id=p_conversation_id and actor in(c.participant_a,c.participant_b) and p_peer_user_id in(c.participant_a,c.participant_b)) then raise exception 'Conversation access denied'; end if;
elsif p_conversation_kind='worker' then if not exists(select 1 from public.booking_conversations c where c.id=p_conversation_id and actor in(c.user_id,c.worker_id) and p_peer_user_id in(c.user_id,c.worker_id)) then raise exception 'Conversation access denied'; end if;
elsif p_conversation_kind='friend' then if not exists(select 1 from public.friends c where c.id=p_conversation_id and c.status='accepted' and actor in(c.user_low,c.user_high) and p_peer_user_id in(c.user_low,c.user_high)) then raise exception 'Conversation access denied'; end if;
else raise exception 'Unsupported private conversation kind'; end if;
return query select i.user_id,i.key_version,i.public_key_jwk from public.user_encryption_identities i where i.user_id=p_peer_user_id; end $$;

revoke all on function public.establish_private_conversation_key(text,uuid,jsonb),public.get_private_chat_peer_public_key(text,uuid,text) from public,anon;
grant execute on function public.establish_private_conversation_key(text,uuid,jsonb),public.get_private_chat_peer_public_key(text,uuid,text) to authenticated,service_role;

-- Hotel-chat reports resolve the other party on the server and require access to that conversation.
create or replace function public.hotel_chat_report_target(p_conversation_id uuid)
returns table(user_id text, display_name text) language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select p.user_id, coalesce(nullif(p.full_name,''),'this person')
  from public.hotel_booking_conversations c join public.hotels h on h.hotel_id=c.hotel_id
  join public.profiles a on a.auth_id=(select auth.uid())::text
  join public.profiles p on p.user_id=case when c.guest_user_id=a.user_id then h.owner_id else c.guest_user_id end
  where c.id=p_conversation_id and public.can_access_hotel_booking_conversation(c.id) limit 1 $$;
revoke all on function public.hotel_chat_report_target(uuid) from public, anon;
grant execute on function public.hotel_chat_report_target(uuid) to authenticated;
create or replace function public.report_content(p_subject_type text,p_subject_user_id text,p_reason text,p_details text default null,p_subject_ref text default null)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare a public.profiles; s public.profiles; v_id uuid; lo text; hi text;
begin
  select * into a from public.profiles p where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false) limit 1;
  if a.user_id is null then raise exception 'Sign in to report'; end if;
  select * into s from public.profiles p where p.user_id=p_subject_user_id and not coalesce(p.deleted,false) limit 1;
  if s.user_id is null or s.user_id=a.user_id then raise exception 'Invalid report'; end if;
  if p_reason is null or p_reason not in ('spam','harassment','scam','unsafe','inappropriate','other') then raise exception 'Choose a report reason'; end if;
  if p_subject_type='roommate_chat' and not exists(select 1 from public.conversations c where c.conversation_type='roommate'
     and a.user_id in(c.participant_a,c.participant_b) and s.user_id in(c.participant_a,c.participant_b)) then
    raise exception 'You can only report people you have a roommate conversation with'; end if;
  if p_subject_type='worker_chat' and not exists(select 1 from public.booking_conversations c
     where a.user_id in(c.user_id,c.worker_id) and s.user_id in(c.user_id,c.worker_id)) then
    raise exception 'You can only report people you have a worker conversation with'; end if;
  if p_subject_type='hotel_chat' and not exists(select 1 from public.hotel_booking_conversations c join public.hotels h on h.hotel_id=c.hotel_id
     where c.id::text=p_subject_ref and public.can_access_hotel_booking_conversation(c.id)
       and s.user_id=case when c.guest_user_id=a.user_id then h.owner_id else c.guest_user_id end) then
    raise exception 'You can only report the other side of your own hotel conversation'; end if;
  if p_subject_type='friend_chat' then
    lo:=least(a.user_id,s.user_id); hi:=greatest(a.user_id,s.user_id);
    if not exists(select 1 from public.friends c where c.user_low=lo and c.user_high=hi) then
      raise exception 'You can only report your own friends'; end if;
  end if;
  insert into public.content_reports(reporter_user_id,subject_user_id,subject_type,subject_ref,reason,details,state_key)
  values(a.user_id,s.user_id,p_subject_type,left(p_subject_ref,200),p_reason,nullif(left(btrim(coalesce(p_details,'')),1000),''),public.wehouse_state_key(s.state))
  returning id into v_id;
  return v_id;
end $$;


-- Friend requests expire if unanswered, and one person can only send a limited number per day.
-- Both numbers live here so they can be changed in one place.
create or replace function public.friend_request_expiry()
returns interval language sql immutable set search_path = 'pg_catalog' as $$ select interval '24 hours' $$;
create or replace function public.friend_daily_request_cap()
returns integer language sql immutable set search_path = 'pg_catalog' as $$ select 10 $$;
revoke all on function public.friend_request_expiry(), public.friend_daily_request_cap() from public, anon, authenticated;
grant execute on function public.friend_request_expiry(), public.friend_daily_request_cap() to service_role;

create table if not exists public.friend_request_log (
  id bigint generated always as identity primary key,
  sender text not null,
  created_at timestamptz not null default now()
);
create index if not exists friend_request_log_sender_idx on public.friend_request_log (sender, created_at desc);
alter table public.friend_request_log enable row level security;
revoke all on public.friend_request_log from public, anon, authenticated;
grant all on public.friend_request_log to service_role;

-- An unanswered request stops holding a slot once it has expired.
create or replace function public.friend_bucket_count(p_user_id text)
returns integer language sql stable security definer set search_path = 'pg_catalog','public' as $$
  select count(*)::integer from public.friends c
  where p_user_id in (c.user_low, c.user_high)
    and (c.status = 'accepted'
         or (c.status = 'pending' and c.requested_by = p_user_id and c.updated_at > now() - public.friend_request_expiry()))
$$;

create or replace function public.send_friend_request(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  lo text; hi text; c public.friends;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_user_id is null or p_user_id = actor then
    raise exception 'Choose another person';
  end if;
  if not exists(select 1 from public.profiles p where p.user_id = p_user_id and p.account_kind = 'consumer'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
    raise exception 'That person cannot receive a friend request';
  end if;
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || least(actor, p_user_id)));
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || greatest(actor, p_user_id)));

  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  select * into c from public.friends where user_low = lo and user_high = hi for update;
  if c.id is not null and (c.status = 'accepted'
      or (c.status = 'pending' and c.updated_at > now() - public.friend_request_expiry())) then
    return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
  end if;
  if c.id is not null and c.status in ('declined','removed') and c.responded_at > now() - public.friend_rerequest_wait() then
    raise exception 'That person cannot receive a friend request';
  end if;
  if (select count(*) from public.friend_request_log l
      where l.sender = actor and l.created_at > now() - interval '24 hours') >= public.friend_daily_request_cap() then
    raise exception 'You have sent many requests today. Try again tomorrow';
  end if;
  if public.friend_bucket_count(actor) >= 5 then
    raise exception 'Your friend list is full. Remove a friend to add another';
  end if;
  if public.friend_bucket_count(p_user_id) >= 5 then
    raise exception 'That person cannot receive a friend request';
  end if;

  if c.id is null then
    insert into public.friends(user_low, user_high, requested_by) values (lo, hi, actor) returning * into c;
  else
    update public.friends set status = 'pending', requested_by = actor, responded_at = null, updated_at = now()
    where id = c.id returning * into c;
  end if;
  insert into public.friend_request_log(sender) values (actor);
  return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
end $$;

create or replace function public.respond_to_friend_request(p_friend_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.friends;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into c from public.friends where id = p_friend_id;
  if c.id is not null then
    perform pg_advisory_xact_lock(hashtext('friend_bucket:' || c.user_low));
    perform pg_advisory_xact_lock(hashtext('friend_bucket:' || c.user_high));
  end if;
  select * into c from public.friends where id = p_friend_id for update;
  if c.id is null or c.status <> 'pending' or c.requested_by = actor or actor not in (c.user_low, c.user_high)
     or c.updated_at <= now() - public.friend_request_expiry() then
    raise exception 'Pending friend request not found';
  end if;
  if p_accept then
    if public.friend_bucket_count(actor) >= 5 then
      raise exception 'Your friend list is full. Remove a friend to add another';
    end if;
  end if;
  update public.friends
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now(), updated_at = now()
  where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;

create or replace function public.list_my_friends()
returns jsonb language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id();
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'friend_id', c.id,
      'user_id', other.user_id,
      'full_name', other.full_name,
      'username', other.username,
      'status', c.status,
      'requested_by_me', c.requested_by = actor
    ) order by c.updated_at desc)
    from public.friends c
    join public.profiles other on other.user_id = case when c.user_low = actor then c.user_high else c.user_low end
    where actor in (c.user_low, c.user_high)
      and (c.status = 'accepted' or (c.status = 'pending' and c.updated_at > now() - public.friend_request_expiry()))
  ), '[]'::jsonb);
end $$;

revoke all on function public.send_friend_request(text), public.respond_to_friend_request(uuid,boolean), public.list_my_friends() from public, anon;
grant execute on function public.send_friend_request(text), public.respond_to_friend_request(uuid,boolean), public.list_my_friends() to authenticated, service_role;

-- A Friend is a request that is sent and accepted. Either person can Block, which ends the Friendship,
-- stops chat and shared-payment use, and prevents new requests in either direction. Only the person
-- who blocked can Unblock, and Unblock does not restore the Friendship: they would have to ask again.
alter table public.friends add column if not exists blocked_by text;
alter table public.friends drop constraint if exists friends_status_check;
alter table public.friends add constraint friends_status_check
  check (status in ('pending','accepted','declined','removed','blocked'));

create or replace function public.block_friend(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); lo text; hi text; n integer;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_user_id is null or p_user_id = actor then raise exception 'Choose another person'; end if;
  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || lo));
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || hi));
  update public.friends set status = 'blocked', blocked_by = actor, responded_at = now(), updated_at = now()
  where user_low = lo and user_high = hi and status in ('pending','accepted');
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.friends(user_low, user_high, requested_by, status, blocked_by, responded_at)
    values (lo, hi, actor, 'blocked', actor, now())
    on conflict (user_low, user_high) do update
      set status = 'blocked', blocked_by = actor, responded_at = now(), updated_at = now()
      where public.friends.status <> 'blocked';
  end if;
  return jsonb_build_object('blocked', true);
end $$;

create or replace function public.unblock_friend(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); n integer;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  update public.friends set status = 'removed', blocked_by = null, responded_at = null, updated_at = now()
  where user_low = least(actor, p_user_id) and user_high = greatest(actor, p_user_id)
    and status = 'blocked' and blocked_by = actor;
  get diagnostics n = row_count;
  return jsonb_build_object('unblocked', n > 0);
end $$;

-- A blocked pair gets the same neutral refusal as a full list, so the block is not revealed.
create or replace function public.send_friend_request(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  lo text; hi text; c public.friends;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_user_id is null or p_user_id = actor then
    raise exception 'Choose another person';
  end if;
  if not exists(select 1 from public.profiles p where p.user_id = p_user_id and p.account_kind = 'consumer'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
    raise exception 'That person cannot receive a friend request';
  end if;
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || least(actor, p_user_id)));
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || greatest(actor, p_user_id)));

  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  select * into c from public.friends where user_low = lo and user_high = hi for update;
  if c.id is not null and c.status = 'blocked' then
    raise exception 'That person cannot receive a friend request';
  end if;
  if c.id is not null and (c.status = 'accepted'
      or (c.status = 'pending' and c.updated_at > now() - public.friend_request_expiry())) then
    return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
  end if;
  if c.id is not null and c.status in ('declined','removed') and c.responded_at > now() - public.friend_rerequest_wait() then
    raise exception 'That person cannot receive a friend request';
  end if;
  if (select count(*) from public.friend_request_log l
      where l.sender = actor and l.created_at > now() - interval '24 hours') >= public.friend_daily_request_cap() then
    raise exception 'You have sent many requests today. Try again tomorrow';
  end if;
  if public.friend_bucket_count(actor) >= 5 then
    raise exception 'Your friend list is full. Remove a friend to add another';
  end if;
  if public.friend_bucket_count(p_user_id) >= 5 then
    raise exception 'That person cannot receive a friend request';
  end if;

  if c.id is null then
    insert into public.friends(user_low, user_high, requested_by) values (lo, hi, actor) returning * into c;
  else
    update public.friends set status = 'pending', requested_by = actor, responded_at = null, updated_at = now()
    where id = c.id returning * into c;
  end if;
  insert into public.friend_request_log(sender) values (actor);
  return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
end $$;

-- The list also returns people I blocked, so I can Unblock them. The blocked person never sees the block.
create or replace function public.list_my_friends()
returns jsonb language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id();
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'friend_id', c.id,
      'user_id', other.user_id,
      'full_name', other.full_name,
      'username', other.username,
      'status', c.status,
      'requested_by_me', c.requested_by = actor
    ) order by c.updated_at desc)
    from public.friends c
    join public.profiles other on other.user_id = case when c.user_low = actor then c.user_high else c.user_low end
    where actor in (c.user_low, c.user_high)
      and (c.status = 'accepted'
           or (c.status = 'pending' and c.updated_at > now() - public.friend_request_expiry())
           or (c.status = 'blocked' and c.blocked_by = actor))
  ), '[]'::jsonb);
end $$;

revoke all on function public.block_friend(text), public.unblock_friend(text), public.send_friend_request(text), public.list_my_friends() from public, anon;
grant execute on function public.block_friend(text), public.unblock_friend(text), public.send_friend_request(text), public.list_my_friends() to authenticated, service_role;

-- Friend Block works like WhatsApp: Unblock restores the Friend and the chat history, with no new request.
-- Only Roommate needs a new connection after Cancel.
alter table public.friends add column if not exists status_before_block text;

create or replace function public.block_friend(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); lo text; hi text; n integer;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_user_id is null or p_user_id = actor then raise exception 'Choose another person'; end if;
  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || lo));
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || hi));
  update public.friends
     set status_before_block = status, status = 'blocked', blocked_by = actor, responded_at = now(), updated_at = now()
   where user_low = lo and user_high = hi and status in ('pending','accepted');
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.friends(user_low, user_high, requested_by, status, blocked_by, responded_at, status_before_block)
    values (lo, hi, actor, 'blocked', actor, now(), 'removed')
    on conflict (user_low, user_high) do update
      set status_before_block = case when public.friends.status = 'blocked' then public.friends.status_before_block else 'removed' end,
          status = 'blocked', blocked_by = case when public.friends.status = 'blocked' then public.friends.blocked_by else actor end,
          responded_at = now(), updated_at = now();
  end if;
  return jsonb_build_object('blocked', true);
end $$;

create or replace function public.unblock_friend(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); lo text; hi text; c public.friends;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || lo));
  perform pg_advisory_xact_lock(hashtext('friend_bucket:' || hi));
  select * into c from public.friends where user_low = lo and user_high = hi and status = 'blocked' and blocked_by = actor for update;
  if c.id is null then return jsonb_build_object('unblocked', false); end if;
  if c.status_before_block = 'accepted' then
    update public.friends set status = 'accepted', blocked_by = null, status_before_block = null, updated_at = now() where id = c.id;
  else
    update public.friends set status = 'removed', blocked_by = null, status_before_block = null, responded_at = null, updated_at = now() where id = c.id;
  end if;
  return jsonb_build_object('unblocked', true, 'restored', c.status_before_block = 'accepted');
end $$;
revoke all on function public.block_friend(text), public.unblock_friend(text) from public, anon;
grant execute on function public.block_friend(text), public.unblock_friend(text) to authenticated, service_role;

-- Friend chat gets what Roommate chat has: encrypted images and voice notes, reactions, reply and delete for me.
-- Separate Friend functions: nothing here changes how Roommate or worker chats work.
-- While a Friend is blocked, both people can still read the old chat but nobody can send, react or upload.

alter table public.friend_messages
  add column if not exists reactions jsonb not null default '{}'::jsonb,
  add column if not exists hidden_for text[] not null default '{}'::text[];

-- Encrypted media paths: e2ee/friend/<friend id>/<file>.bin
create or replace function private.can_access_chat_cipher_object(p_name text,p_write boolean)
returns boolean language plpgsql stable security definer set search_path='pg_catalog','public'
as $$
declare p text[]:=string_to_array(p_name,'/'); c uuid; a text:=public.current_profile_user_id(); peer text;
begin
 if a is null or cardinality(p)<>4 or p[1]<>'e2ee' or p[4] !~ '^[a-zA-Z0-9_-]+\.bin$' then return false; end if;
 begin c:=p[3]::uuid; exception when invalid_text_representation then return false; end;
 if p[2]='roommate' then
  select case when participant_a=a then participant_b else participant_a end into peer from public.conversations
   where id=c and a in(participant_a,participant_b) and conversation_type='roommate'
    and coalesce(status,'active') in('active','accepted');
  if peer is null or exists(select 1 from public.roommate_user_blocks b where (b.blocker_user_id=a and b.blocked_user_id=peer) or (b.blocker_user_id=peer and b.blocked_user_id=a)) then return false; end if;
 elsif p[2]='worker' then
  select case when bc.user_id=a then bc.worker_id else bc.user_id end into peer from public.booking_conversations bc
   join public.worker_bookings b on b.id=bc.booking_id where bc.id=c and a in(bc.user_id,bc.worker_id)
    and (not p_write or b.status not in('approved_released','cancelled','refunded'));
  if peer is null or exists(select 1 from public.worker_user_blocks b where (b.blocker_user_id=a and b.blocked_user_id=peer) or (b.blocker_user_id=peer and b.blocked_user_id=a)) then return false; end if;
 elsif p[2]='friend' then
  if not exists(select 1 from public.friends f where f.id=c and a in(f.user_low,f.user_high)
      and (f.status='accepted' or (not p_write and f.status='blocked' and f.status_before_block='accepted'))) then return false; end if;
 else return false; end if;
 return true;
end $$;
revoke all on function private.can_access_chat_cipher_object(text,boolean) from public,anon;
grant execute on function private.can_access_chat_cipher_object(text,boolean) to authenticated;

create or replace function private.friend_chat_access(p_friend_id uuid, p_write boolean)
returns public.friends language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.current_profile_user_id(); c public.friends;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  select * into c from public.friends where id=p_friend_id;
  if c.id is null or actor not in (c.user_low,c.user_high)
     or not (c.status='accepted' or (not p_write and c.status='blocked' and c.status_before_block='accepted')) then
    raise exception 'Conversation access denied';
  end if;
  return c;
end $$;
revoke all on function private.friend_chat_access(uuid,boolean) from public,anon;
grant execute on function private.friend_chat_access(uuid,boolean) to authenticated;

create or replace function public.send_friend_encrypted_message(
  p_friend_id uuid, p_ciphertext text, p_encryption_iv text,
  p_encrypted_attachments jsonb default '[]'::jsonb, p_reply_to_id uuid default null)
returns uuid language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.friends; mid uuid; item jsonb; items jsonb := coalesce(p_encrypted_attachments, '[]'::jsonb);
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if nullif(p_ciphertext, '') is null or nullif(p_encryption_iv, '') is null then
    raise exception 'Encrypted payload is required';
  end if;
  c := private.friend_chat_access(p_friend_id, true);
  if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>6 then raise exception 'Invalid media list' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item)<>'object'
       or coalesce(item->>'path','') !~ ('^e2ee/friend/'||c.id::text||'/[a-zA-Z0-9_-]+\.bin$')
       or coalesce(item->>'file_iv','') !~ '^[A-Za-z0-9+/]{16}$'
       or coalesce(item->>'metadata_iv','') !~ '^[A-Za-z0-9+/]{16}$'
       or length(coalesce(item->>'metadata_ciphertext','')) not between 24 and 8192
       or coalesce(item->>'metadata_ciphertext','') !~ '^[A-Za-z0-9+/]+={0,2}$' then
      raise exception 'Invalid media for this conversation' using errcode='42501';
    end if;
  end loop;
  if p_reply_to_id is not null and not exists(
    select 1 from public.friend_messages where id = p_reply_to_id and friend_id = c.id) then
    raise exception 'Reply target is not in this conversation';
  end if;
  insert into public.friend_messages(friend_id, sender_id, ciphertext, encryption_iv, encrypted_attachments, reply_to_id)
  values (c.id, actor, p_ciphertext, p_encryption_iv, items, p_reply_to_id)
  returning id into mid;
  return mid;
end $$;

drop function if exists public.get_friend_encrypted_messages(uuid);
create or replace function public.get_friend_encrypted_messages(p_friend_id uuid)
returns table(id uuid, sender_id text, ciphertext text, encryption_iv text, encryption_version integer,
  encrypted_attachments jsonb, reply_to_id uuid, created_at timestamptz, reactions jsonb)
language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); c public.friends;
begin
  c := private.friend_chat_access(p_friend_id, false);
  return query
    select m.id, m.sender_id, m.ciphertext, m.encryption_iv, m.encryption_version,
           m.encrypted_attachments, m.reply_to_id, m.created_at, m.reactions
    from public.friend_messages m
    where m.friend_id = c.id and not (actor = any(m.hidden_for))
    order by m.created_at, m.id;
end $$;

create or replace function public.set_friend_message_reaction(p_friend_id uuid, p_message_id uuid, p_emoji text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); c public.friends; result jsonb;
begin
  if nullif(btrim(coalesce(p_emoji,'')),'') is not null and not public._valid_reaction(p_emoji) then
    raise exception 'Choose a valid emoji reaction';
  end if;
  c := private.friend_chat_access(p_friend_id, true);
  update public.friend_messages
     set reactions = case when nullif(btrim(coalesce(p_emoji,'')),'') is null
       then coalesce(reactions,'{}'::jsonb) - actor
       else jsonb_set(coalesce(reactions,'{}'::jsonb), array[actor], to_jsonb(btrim(p_emoji)), true) end
   where id = p_message_id and friend_id = c.id
   returning reactions into result;
  if result is null then raise exception 'Message was not found'; end if;
  return result;
end $$;

create or replace function public.delete_friend_message_for_me(p_friend_id uuid, p_message_id uuid)
returns boolean language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); c public.friends;
begin
  c := private.friend_chat_access(p_friend_id, false);
  update public.friend_messages set hidden_for = array_append(hidden_for, actor)
   where id = p_message_id and friend_id = c.id and not (actor = any(hidden_for));
  return true;
end $$;

revoke all on function public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid),
  public.get_friend_encrypted_messages(uuid), public.set_friend_message_reaction(uuid,uuid,text),
  public.delete_friend_message_for_me(uuid,uuid) from public, anon;
grant execute on function public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid),
  public.get_friend_encrypted_messages(uuid), public.set_friend_message_reaction(uuid,uuid,text),
  public.delete_friend_message_for_me(uuid,uuid) to authenticated, service_role;

-- Pinned messages for every chat (Roommate, Service, Friend, Hotel, Property host): either person in the
-- conversation may pin, up to 10 pins per conversation. And a public breakdown of who funds a discount.
create table if not exists public.message_pins (
  surface text not null check (surface in ('roommate','worker','friend','hotel','property_host')),
  thread_id uuid not null,
  message_id uuid not null,
  pinned_by text not null,
  created_at timestamptz not null default now(),
  primary key (surface, thread_id, message_id)
);
create index if not exists message_pins_thread_idx on public.message_pins(surface, thread_id, created_at desc);
alter table public.message_pins enable row level security;
revoke all on public.message_pins from public, anon, authenticated;

-- Is the signed-in person part of this conversation? For writes, blocked or closed conversations are refused.
create or replace function private.message_pin_access(p_surface text, p_thread uuid, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); peer text; ok boolean := false;
begin
  if actor is null then return false; end if;
  if p_surface = 'roommate' then
    select case when c.participant_a = actor then c.participant_b else c.participant_a end into peer
      from public.conversations c
     where c.id = p_thread and actor in (c.participant_a, c.participant_b) and c.conversation_type = 'roommate'
       and (not p_write or coalesce(c.status,'active') = 'active');
    ok := peer is not null and not (p_write and exists(select 1 from public.roommate_user_blocks b
      where (b.blocker_user_id = actor and b.blocked_user_id = peer) or (b.blocker_user_id = peer and b.blocked_user_id = actor)));
  elsif p_surface = 'worker' then
    select case when c.user_id = actor then c.worker_id else c.user_id end into peer
      from public.booking_conversations c where c.id = p_thread and actor in (c.user_id, c.worker_id);
    ok := peer is not null and not (p_write and exists(select 1 from public.worker_user_blocks b
      where (b.blocker_user_id = actor and b.blocked_user_id = peer) or (b.blocker_user_id = peer and b.blocked_user_id = actor)));
  elsif p_surface = 'friend' then
    select exists(select 1 from public.friends c where c.id = p_thread and actor in (c.user_low, c.user_high)
      and (c.status = 'accepted' or (not p_write and c.status = 'blocked' and c.status_before_block = 'accepted'))) into ok;
  elsif p_surface = 'hotel' then
    ok := public.can_access_hotel_booking_conversation(p_thread);
  elsif p_surface = 'property_host' then
    ok := public.property_host_conversation_access(p_thread);
  end if;
  return coalesce(ok, false);
end $$;
revoke all on function private.message_pin_access(text,uuid,boolean) from public, anon;
grant execute on function private.message_pin_access(text,uuid,boolean) to authenticated, service_role;

create or replace function private.message_exists_in_thread(p_surface text, p_thread uuid, p_message uuid)
returns boolean language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
begin
  return case p_surface
    when 'roommate' then exists(select 1 from public.messages m where m.id = p_message and m.conversation_id = p_thread)
    when 'worker' then exists(select 1 from public.booking_messages m where m.id = p_message and m.conversation_id = p_thread)
    when 'friend' then exists(select 1 from public.friend_messages m where m.id = p_message and m.friend_id = p_thread)
    when 'hotel' then exists(select 1 from public.hotel_booking_messages m where m.id = p_message and m.conversation_id = p_thread)
    when 'property_host' then exists(select 1 from public.property_host_messages m where m.message_id = p_message and m.conversation_id = p_thread)
    else false end;
end $$;
revoke all on function private.message_exists_in_thread(text,uuid,uuid) from public, anon, authenticated;

create or replace function public.set_message_pin(p_surface text, p_thread uuid, p_message uuid, p_pinned boolean)
returns integer language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); n integer;
begin
  if not private.message_pin_access(p_surface, p_thread, true) then raise exception 'Conversation access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_surface || ':' || p_thread::text, 0));
  if p_pinned then
    if not private.message_exists_in_thread(p_surface, p_thread, p_message) then raise exception 'Message was not found'; end if;
    if not exists(select 1 from public.message_pins where surface = p_surface and thread_id = p_thread and message_id = p_message) then
      select count(*) into n from public.message_pins where surface = p_surface and thread_id = p_thread;
      if n >= 10 then raise exception 'You can pin up to 10 messages. Unpin one first.'; end if;
      insert into public.message_pins(surface, thread_id, message_id, pinned_by) values (p_surface, p_thread, p_message, actor);
    end if;
  else
    delete from public.message_pins where surface = p_surface and thread_id = p_thread and message_id = p_message;
  end if;
  select count(*) into n from public.message_pins where surface = p_surface and thread_id = p_thread;
  return n;
end $$;

create or replace function public.get_message_pins(p_surface text, p_thread uuid)
returns table(message_id uuid, pinned_by text, created_at timestamptz)
language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
begin
  if not private.message_pin_access(p_surface, p_thread, false) then raise exception 'Conversation access denied'; end if;
  return query select p.message_id, p.pinned_by, p.created_at from public.message_pins p
    where p.surface = p_surface and p.thread_id = p_thread order by p.created_at desc;
end $$;
revoke all on function public.set_message_pin(text,uuid,uuid,boolean), public.get_message_pins(text,uuid) from public, anon;
grant execute on function public.set_message_pin(text,uuid,uuid,boolean), public.get_message_pins(text,uuid) to authenticated, service_role;

-- Who funds the discount a guest sees today. Percentages only; the commission and ceiling stay private.
create or replace function public.listing_discount_breakdown(p_listing_id uuid, p_on date default current_date)
returns jsonb language sql stable security definer set search_path = 'pg_catalog','public' as $$
  select jsonb_build_object(
    'host_percent', coalesce(b.partner_percent, 0),
    'wehouse_percent', coalesce(b.wehouse_percent, 0),
    'total_percent', coalesce(b.partner_percent, 0) + coalesce(b.wehouse_percent, 0),
    'ends_on', (select min(d.ends_on) from public.listing_discounts d join public.listings l on l.id = p_listing_id
      where d.active and d.starts_on <= p_on and (d.ends_on is null or d.ends_on >= p_on)
        and (d.listing_id = l.id or d.state_key = public.wehouse_state_key(l.state))))
  from public.short_let_discount_breakdown(p_listing_id, p_on, 0) b $$;
revoke all on function public.listing_discount_breakdown(uuid,date) from public, anon;
grant execute on function public.listing_discount_breakdown(uuid,date) to anon, authenticated, service_role;

-- A Friend chat message can carry a client-made id. A retry after a bad network or a
-- double tap with the same id returns the first message instead of sending a second one.
drop function if exists public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid);

create or replace function public.send_friend_encrypted_message(
  p_friend_id uuid, p_ciphertext text, p_encryption_iv text,
  p_encrypted_attachments jsonb default '[]'::jsonb, p_reply_to_id uuid default null,
  p_client_message_id uuid default null)
returns uuid language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.friends; mid uuid; item jsonb; items jsonb := coalesce(p_encrypted_attachments, '[]'::jsonb);
  v_existing public.friend_messages;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if nullif(p_ciphertext, '') is null or nullif(p_encryption_iv, '') is null then
    raise exception 'Encrypted payload is required';
  end if;
  c := private.friend_chat_access(p_friend_id, true);
  if p_client_message_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('friend-msg:' || p_client_message_id::text, 0));
    select * into v_existing from public.friend_messages where id = p_client_message_id;
    if v_existing.id is not null then
      if v_existing.friend_id <> c.id or v_existing.sender_id <> actor then
        raise exception 'This message id is already used' using errcode='22023';
      end if;
      return v_existing.id;
    end if;
  end if;
  if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>6 then raise exception 'Invalid media list' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item)<>'object'
       or coalesce(item->>'path','') !~ ('^e2ee/friend/'||c.id::text||'/[a-zA-Z0-9_-]+\.bin$')
       or coalesce(item->>'file_iv','') !~ '^[A-Za-z0-9+/]{16}$'
       or coalesce(item->>'metadata_iv','') !~ '^[A-Za-z0-9+/]{16}$'
       or length(coalesce(item->>'metadata_ciphertext','')) not between 24 and 8192
       or coalesce(item->>'metadata_ciphertext','') !~ '^[A-Za-z0-9+/]+={0,2}$' then
      raise exception 'Invalid media for this conversation' using errcode='42501';
    end if;
  end loop;
  if p_reply_to_id is not null and not exists(
    select 1 from public.friend_messages where id = p_reply_to_id and friend_id = c.id) then
    raise exception 'Reply target is not in this conversation';
  end if;
  insert into public.friend_messages(id, friend_id, sender_id, ciphertext, encryption_iv, encrypted_attachments, reply_to_id)
  values (coalesce(p_client_message_id, gen_random_uuid()), c.id, actor, p_ciphertext, p_encryption_iv, items, p_reply_to_id)
  returning id into mid;
  return mid;
end $$;

revoke all on function public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid,uuid) from public, anon;
grant execute on function public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid,uuid) to authenticated, service_role;

-- Migrate the report subject to the canonical product term and remove old RPCs.
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_subject_type_check;
UPDATE public.content_reports SET subject_type='friend_chat' WHERE subject_type='companion_chat';
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_subject_type_check
  CHECK (subject_type IN ('roommate_chat','friend_chat','worker_chat','hotel_chat','support_case','profile','message','listing'));

DROP FUNCTION IF EXISTS public.are_companions(text,text);
DROP FUNCTION IF EXISTS public.companion_bucket_count(text);
DROP FUNCTION IF EXISTS public.companion_daily_request_cap();
DROP FUNCTION IF EXISTS public.companion_request_expiry();
DROP FUNCTION IF EXISTS public.companion_rerequest_wait();
DROP FUNCTION IF EXISTS public.delete_companion_message_for_me(uuid,uuid);
DROP FUNCTION IF EXISTS public.get_companion_encrypted_messages(uuid);
DROP FUNCTION IF EXISTS public.list_my_companions();
DROP FUNCTION IF EXISTS public.remove_companion(text);
DROP FUNCTION IF EXISTS public.respond_to_companion_request(uuid,boolean);
DROP FUNCTION IF EXISTS public.send_companion_encrypted_message(uuid,text,text,jsonb,uuid);
DROP FUNCTION IF EXISTS public.send_companion_encrypted_message(uuid,text,text,jsonb,uuid,uuid);
DROP FUNCTION IF EXISTS public.send_companion_request(text);
DROP FUNCTION IF EXISTS public.send_companion_request_by_username(text);
DROP FUNCTION IF EXISTS public.set_companion_message_reaction(uuid,uuid,text);
