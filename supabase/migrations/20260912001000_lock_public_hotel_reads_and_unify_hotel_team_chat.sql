-- Canonical hotel privacy and guest-communication boundary.
--
-- 1) Public discovery must never SELECT the raw hotels row. RLS filters rows,
--    not columns, and the base row contains private address/GPS/ownership fields.
-- 2) A paid confirmed stay has one deterministic hotel conversation.
-- 3) Guest communication is a hotel/business conversation. The guest, hotel
--    owner, active Manager and active Front desk can access it. WeHouse
--    Operations/Admin/Creator remain outside this direct guest thread and use
--    their separate operations/support records.
-- 4) Sending remains valid only while the stay is confirmed or checked in.
--    After checkout the thread is retained as read-only history.

create or replace function public.current_actor_can_read_hotel_record(
  p_hotel_id integer,
  p_owner_id text,
  p_state text,
  p_city text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
begin
  select profile.* into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;

  if v_actor.user_id is null then return false; end if;

  return p_owner_id=v_actor.user_id
    or v_actor.role='creator'
    or exists (
      select 1
      from public.hotel_team_members member
      where member.hotel_id=p_hotel_id
        and member.member_user_id=v_actor.user_id
        and member.status='active'
        and member.hotel_role in ('manager','staff')
    )
    or (
      (
        v_actor.role='admin'
        or (
          v_actor.role='staff'
          and public.current_staff_has_permission('operations')
        )
      )
      and public.current_actor_in_scope(p_state,p_city)
    );
end;
$$;

-- Raw hotel rows are internal records. Public and ordinary customer hotel
-- discovery goes through the masked SECURITY DEFINER RPCs below.
drop policy if exists hotels_public_active_select on public.hotels;
drop policy if exists hotels_internal_select on public.hotels;

create policy hotels_internal_select on public.hotels
for select to authenticated
using (
  public.current_actor_can_read_hotel_record(hotel_id,owner_id,state,city)
);

revoke select on table public.hotels from anon;
revoke select on table public.hotel_bookings from anon;
revoke select on table public.hotel_team_members from anon;

grant execute on function public.get_discoverable_hotels() to anon,authenticated;
grant execute on function public.get_public_hotel_detail(integer) to anon,authenticated;

create or replace function public.can_access_hotel_booking_conversation(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as (
    select user_id
    from public.profiles
    where auth_id=(select auth.uid())::text
      and not coalesce(deleted,false)
      and not coalesce(suspended,false)
      and not coalesce(banned,false)
    limit 1
  )
  select exists(
    select 1
    from public.hotel_booking_conversations conversation
    join public.hotels hotel on hotel.hotel_id=conversation.hotel_id
    cross join actor
    where conversation.id=p_conversation_id
      and (
        conversation.guest_user_id=actor.user_id
        or hotel.owner_id=actor.user_id
        or exists(
          select 1
          from public.hotel_team_members member
          where member.hotel_id=conversation.hotel_id
            and member.member_user_id=actor.user_id
            and member.hotel_role in ('manager','staff')
            and member.status='active'
        )
      )
  );
$$;

create or replace function public.open_my_hotel_booking_conversation(
  p_booking_id integer
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text;
  v_booking public.hotel_bookings;
  v_owner_id text;
  v_allowed boolean:=false;
  v_conversation_id uuid;
begin
  select profile.user_id into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;

  if v_actor is null then
    raise exception 'Active WeHouse account required';
  end if;

  select booking.* into v_booking
  from public.hotel_bookings booking
  where booking.booking_id=p_booking_id
  for share;

  if v_booking.booking_id is null then
    raise exception 'Hotel booking not found';
  end if;

  select hotel.owner_id into v_owner_id
  from public.hotels hotel
  where hotel.hotel_id=v_booking.hotel_id;

  v_allowed:=v_booking.user_id=v_actor
    or v_owner_id=v_actor
    or exists(
      select 1
      from public.hotel_team_members member
      where member.hotel_id=v_booking.hotel_id
        and member.member_user_id=v_actor
        and member.hotel_role in ('manager','staff')
        and member.status='active'
    );

  if not v_allowed then
    raise exception 'Hotel booking conversation access denied';
  end if;

  if v_booking.payment_status<>'paid'
     or v_booking.status not in ('confirmed','checked_in') then
    raise exception 'Hotel chat is available from confirmation until checkout';
  end if;

  insert into public.hotel_booking_conversations(booking_id,hotel_id,guest_user_id)
  values(v_booking.booking_id,v_booking.hotel_id,v_booking.user_id)
  on conflict(booking_id) do update
  set updated_at=public.hotel_booking_conversations.updated_at
  returning id into v_conversation_id;

  return v_conversation_id;
end;
$$;

-- Ensure the canonical thread exists as soon as the money/stay state makes
-- guest communication valid. This removes the old ordering bug where the
-- hotel's "Message guest" action depended on the guest sending first.
create or replace function public.ensure_hotel_booking_conversation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.payment_status='paid'
     and new.status in ('confirmed','checked_in','checked_out','completed') then
    insert into public.hotel_booking_conversations(booking_id,hotel_id,guest_user_id)
    values(new.booking_id,new.hotel_id,new.user_id)
    on conflict(booking_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_hotel_booking_conversation_after_state on public.hotel_bookings;
create trigger ensure_hotel_booking_conversation_after_state
after insert or update of payment_status,status on public.hotel_bookings
for each row execute function public.ensure_hotel_booking_conversation();

-- Backfill existing paid stays so current and historical records obey the same
-- one-booking/one-thread invariant. Historical threads stay read-only because
-- send_hotel_booking_message already rejects post-checkout writes.
insert into public.hotel_booking_conversations(booking_id,hotel_id,guest_user_id)
select booking.booking_id,booking.hotel_id,booking.user_id
from public.hotel_bookings booking
where booking.payment_status='paid'
  and booking.status in ('confirmed','checked_in','checked_out','completed')
on conflict(booking_id) do nothing;

revoke all on function public.open_my_hotel_booking_conversation(integer) from public,anon;
revoke all on function public.can_access_hotel_booking_conversation(uuid) from public,anon;
revoke all on function public.ensure_hotel_booking_conversation() from public,anon,authenticated;

grant execute on function public.open_my_hotel_booking_conversation(integer) to authenticated,service_role;
grant execute on function public.can_access_hotel_booking_conversation(uuid) to authenticated,service_role;
