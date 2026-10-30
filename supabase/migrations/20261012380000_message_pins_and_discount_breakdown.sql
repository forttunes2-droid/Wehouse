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
    select exists(select 1 from public.companions c where c.id = p_thread and actor in (c.user_low, c.user_high)
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
    when 'friend' then exists(select 1 from public.companion_messages m where m.id = p_message and m.companion_id = p_thread)
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
