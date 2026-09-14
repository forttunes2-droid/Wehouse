-- Exact location and arrival/handover actions are available only when the
-- accommodation payment is both provider-verified and represented by the
-- canonical Payment Protection record.

create or replace function public.get_public_hotel_detail(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_hotel public.hotels;
  v_actor public.profiles;
  v_internal boolean := false;
  v_current_paid_stay boolean := false;
  v_rooms jsonb;
  v_facilities jsonb;
begin
  select * into v_hotel
  from public.hotels hotel
  where hotel.hotel_id = p_hotel_id;
  if v_hotel.hotel_id is null then return null; end if;

  select * into v_actor
  from public.profiles profile
  where profile.auth_id = (select auth.uid())::text
    and not coalesce(profile.deleted, false)
    and not coalesce(profile.suspended, false)
    and not coalesce(profile.banned, false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal := v_hotel.owner_id = v_actor.user_id
      or exists (
        select 1
        from public.hotel_team_members member
        where member.hotel_id = v_hotel.hotel_id
          and member.member_user_id = v_actor.user_id
          and member.status = 'active'
      )
      or v_actor.role = 'creator'
      or (v_actor.role = 'admin' and public.current_actor_in_scope(v_hotel.state, v_hotel.city))
      or (
        v_actor.role = 'staff'
        and public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_hotel.state, v_hotel.city)
      );

    v_current_paid_stay := exists (
      select 1
      from public.hotel_bookings booking
      join public.payment_protection_transactions protection
        on protection.id = booking.payment_protection_id
      where booking.hotel_id = v_hotel.hotel_id
        and booking.user_id = v_actor.user_id
        and booking.payment_status = 'paid'
        and booking.status in ('confirmed', 'checked_in')
        and protection.subject_type = 'hotel_stay'
        and protection.subject_id = booking.booking_id::text
        and protection.payer_user_id = booking.user_id
        and protection.paystack_reference = booking.payment_reference
        and protection.protected_ledger_transaction_id is not null
        and protection.status = protection.protection_state
        and protection.protection_state in (
          'protected', 'release_eligible', 'release_pending', 'released',
          'disputed', 'risk_held', 'partially_released'
        )
    );
  end if;

  if v_hotel.status <> 'active' and not v_internal and not v_current_paid_stay then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(room) || jsonb_build_object(
        'rate_plans', coalesce((
          select jsonb_agg(to_jsonb(plan) order by plan.price_per_night, plan.rate_plan_id)
          from public.hotel_rate_plans plan
          where plan.room_id = room.room_id
            and (plan.active or v_internal or v_current_paid_stay)
        ), '[]'::jsonb)
      ) order by room.price_per_night
    ),
    '[]'::jsonb
  ) into v_rooms
  from public.hotel_rooms room
  where room.hotel_id = v_hotel.hotel_id;

  select coalesce(
    jsonb_agg(to_jsonb(venue) order by venue.kind, venue.name),
    '[]'::jsonb
  ) into v_facilities
  from public.hotel_venues venue
  where venue.hotel_id = v_hotel.hotel_id
    and (venue.active or v_internal);

  if v_internal then
    return to_jsonb(v_hotel) || jsonb_build_object(
      'hotel_rooms', v_rooms,
      'venues', v_facilities,
      'location_exact', true
    );
  end if;

  return (
    to_jsonb(v_hotel)
      - 'address' - 'gps_latitude' - 'gps_longitude' - 'owner_id'
      - 'inspection_request_id' - 'approved_by'
  ) || jsonb_build_object(
    'address', case when v_current_paid_stay then v_hotel.address else null end,
    'gps_latitude', case
      when v_hotel.gps_latitude is null then null
      when v_current_paid_stay then v_hotel.gps_latitude
      else round(v_hotel.gps_latitude, 2)
    end,
    'gps_longitude', case
      when v_hotel.gps_longitude is null then null
      when v_current_paid_stay then v_hotel.gps_longitude
      else round(v_hotel.gps_longitude, 2)
    end,
    'hotel_rooms', v_rooms,
    'venues', v_facilities,
    'location_exact', v_current_paid_stay
  );
end;
$$;

revoke all on function public.get_public_hotel_detail(integer) from public;
grant execute on function public.get_public_hotel_detail(integer) to anon, authenticated, service_role;

create or replace function public.get_my_hotel_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_user text := public.current_profile_user_id();
begin
  if v_user is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;

  return coalesce((
    select jsonb_agg(
      to_jsonb(booking) || jsonb_build_object(
        'hotels', (
          to_jsonb(hotel) - 'address' - 'gps_latitude' - 'gps_longitude'
            - 'owner_id' - 'inspection_request_id' - 'approved_by'
        ) || jsonb_build_object(
          'address', case when protection.id is not null
            and booking.status in ('confirmed', 'checked_in', 'checked_out', 'completed')
            then hotel.address else null end,
          'gps_latitude', case when hotel.gps_latitude is null then null
            when protection.id is not null
              and booking.status in ('confirmed', 'checked_in', 'checked_out', 'completed')
            then hotel.gps_latitude else round(hotel.gps_latitude, 2) end,
          'gps_longitude', case when hotel.gps_longitude is null then null
            when protection.id is not null
              and booking.status in ('confirmed', 'checked_in', 'checked_out', 'completed')
            then hotel.gps_longitude else round(hotel.gps_longitude, 2) end,
          'location_exact', protection.id is not null
            and booking.status in ('confirmed', 'checked_in', 'checked_out', 'completed')
        ),
        'hotel_rooms', to_jsonb(room),
        'hotel_rate_plans', to_jsonb(rate_plan)
      ) order by booking.created_at desc
    )
    from public.hotel_bookings booking
    join public.hotels hotel on hotel.hotel_id = booking.hotel_id
    join public.hotel_rooms room on room.room_id = booking.room_id
    left join public.hotel_rate_plans rate_plan
      on rate_plan.rate_plan_id = booking.rate_plan_id
    left join public.payment_protection_transactions protection
      on protection.id = booking.payment_protection_id
      and booking.payment_status = 'paid'
      and protection.subject_type = 'hotel_stay'
      and protection.subject_id = booking.booking_id::text
      and protection.payer_user_id = booking.user_id
      and protection.paystack_reference = booking.payment_reference
      and protection.protected_ledger_transaction_id is not null
      and protection.status = protection.protection_state
      and protection.protection_state in (
        'protected', 'release_eligible', 'release_pending', 'released',
        'disputed', 'risk_held', 'partially_released'
      )
    where booking.user_id = v_user
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_my_hotel_bookings() from public;
grant execute on function public.get_my_hotel_bookings() to authenticated, service_role;

create or replace function public.get_public_listing_detail(p_listing_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_listing public.listings;
  v_actor public.profiles;
  v_partner_name text;
  v_internal boolean := false;
  v_paid boolean := false;
begin
  select * into v_listing
  from public.listings listing
  where (listing.id::text = p_listing_id or listing.listing_id = p_listing_id)
    and listing.deleted_at is null
  limit 1;
  if v_listing.id is null then return null; end if;

  select coalesce(nullif(btrim(profile.full_name), ''), nullif(btrim(profile.username), ''))
  into v_partner_name
  from public.profiles profile
  where profile.user_id = coalesce(v_listing.partner_id, v_listing.owner_id);

  select * into v_actor
  from public.profiles profile
  where profile.auth_id = (select auth.uid())::text
    and not coalesce(profile.deleted, false)
    and not coalesce(profile.suspended, false)
    and not coalesce(profile.banned, false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal := v_listing.owner_id = v_actor.user_id
      or v_listing.partner_id = v_actor.user_id
      or v_actor.role = 'creator'
      or (v_actor.role = 'admin' and public.current_actor_in_scope(v_listing.state, v_listing.city))
      or (
        v_actor.role = 'staff'
        and public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_listing.state, v_listing.city)
      );

    v_paid := exists (
      select 1
      from public.reservations reservation
      join public.payment_protection_transactions protection
        on protection.id = case
          when reservation.stay_type = 'short_let'
            then reservation.stay_payment_protection_id
          else reservation.year_one_rent_protection_id
        end
      where reservation.user_id = v_actor.user_id
        and reservation.listing_id in (v_listing.id::text, v_listing.listing_id)
        and reservation.manual_payment_status in ('paid', 'completed')
        and reservation.paid_at is not null
        and reservation.rent_payment_status in ('paid', 'upfront_paid')
        and reservation.rent_paid_at is not null
        and reservation.status in (
          'reserved', 'inspection_pending', 'ready_for_move_in',
          'occupied', 'completed'
        )
        and protection.subject_type = case
          when reservation.stay_type = 'short_let'
            then 'short_let_stay'
          else 'long_let_year_one'
        end
        and protection.subject_id = reservation.id::text
        and protection.payer_user_id = reservation.user_id
        and protection.paystack_reference = reservation.rent_payment_reference
        and protection.protected_ledger_transaction_id is not null
        and protection.status = protection.protection_state
        and protection.protection_state in (
          'protected', 'release_eligible', 'release_pending', 'released',
          'disputed', 'risk_held', 'partially_released'
        )
    );
  end if;

  if not v_internal
    and not v_paid
    and not (v_listing.status = 'available' and v_listing.availability_status = 'available')
  then return null; end if;

  if v_internal then
    return to_jsonb(v_listing) || jsonb_build_object(
      'location_exact', true,
      'partner_display_name', v_partner_name
    );
  end if;

  return (
    to_jsonb(v_listing)
      - 'address' - 'gps_latitude' - 'gps_longitude' - 'location_accuracy_m'
      - 'owner_id' - 'partner_id' - 'chat_agent_id' - 'contact_phone'
      - 'reserved_by' - 'occupied_by' - 'current_reservation_id'
      - 'inspection_request_id'
  ) || jsonb_build_object(
    'address', case when v_paid then v_listing.address else null end,
    'gps_latitude', case
      when v_listing.gps_latitude is null then null
      when v_paid then v_listing.gps_latitude
      else round(v_listing.gps_latitude, 2)
    end,
    'gps_longitude', case
      when v_listing.gps_longitude is null then null
      when v_paid then v_listing.gps_longitude
      else round(v_listing.gps_longitude, 2)
    end,
    'location_accuracy_m', case when v_paid then v_listing.location_accuracy_m else null end,
    'location_exact', v_paid,
    'partner_display_name', v_partner_name
  );
end;
$$;

revoke all on function public.get_public_listing_detail(text) from public;
grant execute on function public.get_public_listing_detail(text) to authenticated, service_role;

create or replace function public.enforce_protected_accommodation_handover()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_protection_id uuid;
  v_expected_subject text;
begin
  if not (
    (new.requested_move_in_at is not null
      and (tg_op = 'INSERT' or old.requested_move_in_at is distinct from new.requested_move_in_at))
    or (new.status = 'occupied'
      and (tg_op = 'INSERT' or old.status is distinct from new.status))
  ) then
    return new;
  end if;

  if coalesce(new.stay_type, 'long_stay') = 'short_let' then
    v_protection_id := new.stay_payment_protection_id;
    v_expected_subject := 'short_let_stay';
  else
    v_protection_id := new.year_one_rent_protection_id;
    v_expected_subject := 'long_let_year_one';
  end if;

  if new.manual_payment_status not in ('paid', 'completed')
    or new.paid_at is null
    or new.rent_payment_status not in ('paid', 'upfront_paid')
    or new.rent_paid_at is null
    or v_protection_id is null
    or not exists (
      select 1
      from public.payment_protection_transactions protection
      where protection.id = v_protection_id
        and protection.subject_type = v_expected_subject
        and protection.subject_id = new.id::text
        and protection.payer_user_id = new.user_id
        and protection.status = 'protected'
        and protection.protection_state in ('protected', 'release_eligible', 'release_pending')
    )
  then
    raise exception 'Current Payment Protection is required before accommodation arrival or handover';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_protected_accommodation_handover() from public;

drop trigger if exists reservations_require_protected_accommodation_handover
on public.reservations;
create trigger reservations_require_protected_accommodation_handover
before insert or update of requested_move_in_at, status
on public.reservations
for each row
execute function public.enforce_protected_accommodation_handover();

create or replace function public.enforce_one_marketplace_workspace()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if new.status <> 'active'
    or new.workspace_role not in ('worker', 'property_partner')
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.user_id, 0));

  if exists (
    select 1
    from public.profiles profile
    where profile.user_id = new.user_id
      and (
        profile.account_kind <> 'consumer'
        or profile.role in ('creator', 'admin', 'staff', 'hotel_staff')
      )
  ) then
    raise exception 'Internal WeHouse accounts cannot activate marketplace workspaces';
  end if;

  if exists (
    select 1
    from public.workspace_role_assignments other
    where other.user_id = new.user_id
      and other.status = 'active'
      and other.workspace_role in ('worker', 'property_partner')
      and other.workspace_role <> new.workspace_role
      and other.id <> new.id
  ) then
    raise exception 'Personal accounts may have one professional marketplace workspace at launch';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_one_marketplace_workspace() from public;
grant execute on function public.enforce_one_marketplace_workspace() to service_role;

drop trigger if exists workspace_one_marketplace_role_guard
on public.workspace_role_assignments;
create trigger workspace_one_marketplace_role_guard
before insert or update of user_id, workspace_role, status
on public.workspace_role_assignments
for each row
execute function public.enforce_one_marketplace_workspace();
