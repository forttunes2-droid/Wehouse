-- D-006 / H-005: a Short Let is a published supply record whose sellability is
-- decided by requested dates. A reservation or current occupant must not turn
-- the whole listing into a globally reserved/occupied publication state.
-- Long Let keeps its existing listing-wide reservation/occupancy behavior.

create or replace function public.get_discoverable_listings()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select coalesce(jsonb_agg(
    (to_jsonb(l)-'address'-'gps_latitude'-'gps_longitude'-'location_accuracy_m'-'owner_id'-'partner_id'-'chat_agent_id'-'contact_phone'-'reserved_by'-'occupied_by'-'current_reservation_id'-'inspection_request_id')
    ||jsonb_build_object(
      'address',null,
      'gps_latitude',case when l.gps_latitude is null then null else round(l.gps_latitude,2) end,
      'gps_longitude',case when l.gps_longitude is null then null else round(l.gps_longitude,2) end,
      'location_exact',false,
      'partner_display_name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
    ) order by l.created_at desc
  ),'[]'::jsonb)
  from public.listings l
  left join public.profiles p on p.user_id=coalesce(l.partner_id,l.owner_id)
  where l.deleted_at is null
    and l.inspection_request_id is not null
    and l.approved_at is not null
    and (
      (
        l.sub_type='short_let'
        and coalesce(l.status,'') not in ('maintenance','closed','rejected','pending_approval')
        and coalesce(l.availability_status,'') not in ('maintenance','closed')
      )
      or
      (
        coalesce(l.sub_type,'long_stay')<>'short_let'
        and l.status='available'
      )
    );
$$;

create or replace function public.get_public_listing_detail(p_listing_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_listing public.listings;
  v_actor public.profiles;
  v_partner_name text;
  v_internal boolean:=false;
  v_paid boolean:=false;
  v_public boolean:=false;
begin
  select * into v_listing
  from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.deleted_at is null
  limit 1;
  if v_listing.id is null then return null; end if;

  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
  into v_partner_name
  from public.profiles p
  where p.user_id=coalesce(v_listing.partner_id,v_listing.owner_id);

  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal:=v_listing.owner_id=v_actor.user_id
      or v_listing.partner_id=v_actor.user_id
      or v_actor.role='creator'
      or (v_actor.role='admin' and public.current_actor_in_scope(v_listing.state,v_listing.city))
      or (v_actor.role='staff' and public.current_staff_has_permission('operations') and public.current_actor_in_scope(v_listing.state,v_listing.city));

    v_paid:=exists(
      select 1
      from public.reservations r
      where r.user_id=v_actor.user_id
        and r.listing_id in (v_listing.id::text,v_listing.listing_id)
        and (r.paid_at is not null or r.manual_payment_status in ('paid','completed'))
        and r.status not in ('cancelled','expired')
    );
  end if;

  v_public:=v_listing.approved_at is not null
    and v_listing.inspection_request_id is not null
    and (
      (
        v_listing.sub_type='short_let'
        and coalesce(v_listing.status,'') not in ('maintenance','closed','rejected','pending_approval')
        and coalesce(v_listing.availability_status,'') not in ('maintenance','closed')
      )
      or
      (
        coalesce(v_listing.sub_type,'long_stay')<>'short_let'
        and v_listing.status='available'
      )
    );

  if not v_internal and not v_public then return null; end if;
  if v_internal then
    return to_jsonb(v_listing)||jsonb_build_object('location_exact',true,'partner_display_name',v_partner_name);
  end if;

  return (to_jsonb(v_listing)-'address'-'gps_latitude'-'gps_longitude'-'location_accuracy_m'-'owner_id'-'partner_id'-'chat_agent_id'-'contact_phone'-'reserved_by'-'occupied_by'-'current_reservation_id'-'inspection_request_id')
    ||jsonb_build_object(
      'address',case when v_paid then v_listing.address else null end,
      'gps_latitude',case when v_listing.gps_latitude is null then null when v_paid then v_listing.gps_latitude else round(v_listing.gps_latitude,2) end,
      'gps_longitude',case when v_listing.gps_longitude is null then null when v_paid then v_listing.gps_longitude else round(v_listing.gps_longitude,2) end,
      'location_accuracy_m',case when v_paid then v_listing.location_accuracy_m else null end,
      'location_exact',v_paid,
      'partner_display_name',v_partner_name
    );
end;
$$;

create or replace function public.get_short_stay_unavailable_listing_ids(
  p_check_in date,
  p_check_out date
)
returns table(listing_id text)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_check_in is null or p_check_out is null or p_check_out<=p_check_in then
    raise exception 'Valid dates required';
  end if;

  return query
  select distinct r.listing_id
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id
  where l.sub_type='short_let'
    and r.stay_type='short_let'
    and r.status = any(array['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
    and (r.status<>'payment_pending' or r.payment_expires_at is null or r.payment_expires_at>now())
    and daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(p_check_in,p_check_out,'[)');
end;
$$;

create or replace function public.activate_short_stay(
  p_reservation_id text,
  p_actual_check_in date default current_date
)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
  v_payment_id uuid;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and role in ('staff','admin','creator')
    and coalesce(deleted,false)=false
    and coalesce(suspended,false)=false
    and coalesce(banned,false)=false
  limit 1;
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  select * into v_res
  from public.reservations
  where id=p_reservation_id and stay_type='short_let'
  for update;
  if v_res is null then raise exception 'Short Stay reservation not found'; end if;

  select * into v_listing
  from public.listings
  where id::text=v_res.listing_id
  for update;
  if v_listing is null or v_listing.sub_type<>'short_let' then
    raise exception 'Short Stay listing not found';
  end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Listing is outside your assigned State/LGA';
  end if;
  if v_listing.status in ('maintenance','closed','rejected','pending_approval')
     or v_listing.availability_status in ('maintenance','closed') then
    raise exception 'This Short Stay is not available for check-in';
  end if;
  if v_res.status<>'ready_for_move_in' or v_res.rent_payment_status<>'paid' or v_res.rent_paid_at is null then
    raise exception 'Short Stay payment must be verified before check-in';
  end if;
  if p_actual_check_in<v_res.stay_check_in or p_actual_check_in>=v_res.stay_check_out then
    raise exception 'Check-in must fall inside the reserved stay dates';
  end if;
  if exists(
    select 1
    from public.reservations other
    where other.listing_id=v_res.listing_id
      and other.id<>v_res.id
      and other.stay_type='short_let'
      and other.status='occupied'
  ) then
    raise exception 'Property is currently occupied';
  end if;

  update public.reservations
  set status='occupied',
      tenancy_start_date=p_actual_check_in,
      tenancy_end_date=v_res.stay_check_out,
      move_out_grace_until=v_res.stay_check_out,
      occupancy_started_at=now(),
      updated_at=now()
  where id=v_res.id
  returning * into v_result;

  -- Occupancy metadata is operational. Publication/sellability remain unchanged;
  -- future dates are filtered by overlapping reservations instead.
  update public.listings
  set occupied_by=v_res.user_id,
      occupied_at=now(),
      tenancy_ends_at=v_res.stay_check_out,
      reserved_by=null,
      reservation_expiry=null,
      current_reservation_id=v_res.id,
      updated_at=now()
  where id=v_listing.id;

  select id into v_payment_id
  from public.booking_payments
  where paystack_reference=v_res.rent_payment_reference
    and purpose='apartment_rent'
    and status in ('paid','completed')
  limit 1;
  if v_payment_id is not null and exists(
    select 1 from public.property_partner_earning_releases
    where payment_id=v_payment_id and status='pending'
  ) then
    perform public.release_property_partner_earning(v_payment_id,'short_stay_check_in_confirmed');
  end if;
  return v_result;
end;
$$;

create or replace function public.complete_short_stay(
  p_reservation_id text,
  p_next_status text default 'available'
)
returns public.reservations
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
begin
  if p_next_status not in ('maintenance','available','closed') then
    raise exception 'Invalid next property status';
  end if;
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and role in ('staff','admin','creator')
    and coalesce(deleted,false)=false
    and coalesce(suspended,false)=false
    and coalesce(banned,false)=false
  limit 1;
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  select * into v_res
  from public.reservations
  where id=p_reservation_id and stay_type='short_let' and status='occupied'
  for update;
  if v_res is null then raise exception 'Active Short Stay not found'; end if;

  select * into v_listing from public.listings where id::text=v_res.listing_id for update;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Listing is outside your assigned State/LGA';
  end if;

  update public.reservations
  set status='completed',
      completed_at=now(),
      processed_by=v_actor.user_id,
      processed_at=now(),
      security_deposit_status=case when coalesce(security_deposit_snapshot,0)>0 then 'refund_due' else 'not_required' end,
      updated_at=now()
  where id=v_res.id
  returning * into v_result;

  update public.listings
  set status=p_next_status,
      availability_status=p_next_status,
      occupied_by=null,
      occupied_at=null,
      tenancy_ends_at=null,
      reserved_by=null,
      reservation_expiry=null,
      reservation_fee_paid=false,
      chat_unlocked=false,
      current_reservation_id=null,
      updated_at=now()
  where id=v_listing.id;

  return v_result;
end;
$$;

create or replace function public.confirm_my_move_in(p_reservation_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_reservation public.reservations;
  v_start date:=current_date;
  v_end date;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text and role='user'
  limit 1;
  if v_actor is null or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then
    raise exception 'Active user account required';
  end if;

  select * into v_reservation
  from public.reservations
  where id=p_reservation_id and user_id=v_actor.user_id
  for update;
  if v_reservation.id is null then raise exception 'Reservation not found'; end if;
  if v_reservation.stay_type='short_let' then
    raise exception 'Short Let check-in must be confirmed by Housing Operations using the booking code';
  end if;
  if v_reservation.status='occupied' then
    return jsonb_build_object('success',true,'already_confirmed',true,'status','occupied','tenancy_start_date',v_reservation.tenancy_start_date,'tenancy_end_date',v_reservation.tenancy_end_date);
  end if;
  if v_reservation.status<>'ready_for_move_in' then
    raise exception 'This home is not ready for move-in confirmation';
  end if;
  if v_reservation.rent_payment_status not in ('paid','upfront_paid') then
    raise exception 'Rent payment must be confirmed first';
  end if;

  v_end:=(v_start+make_interval(years=>greatest(1,coalesce(v_reservation.rental_plan_years,1))))::date;
  update public.reservations
  set status='occupied',tenancy_start_date=v_start,tenancy_end_date=v_end,occupancy_started_at=now(),updated_at=now()
  where id=v_reservation.id;

  -- Long Let intentionally remains listing-wide occupied.
  update public.listings
  set status='occupied',availability_status='unavailable',occupied_by=v_actor.user_id,occupied_at=now(),tenancy_ends_at=v_end,reserved_by=null,reservation_expiry=null,updated_at=now()
  where id::text=v_reservation.listing_id;
  if not found then raise exception 'Reservation listing was not found'; end if;

  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values('USER_MOVE_IN_CONFIRMED','reservations',v_reservation.id,jsonb_build_object('booking_code',v_reservation.booking_code,'tenancy_start_date',v_start,'tenancy_end_date',v_end)::text,v_actor.user_id,v_actor.email);

  return jsonb_build_object('success',true,'status','occupied','tenancy_start_date',v_start,'tenancy_end_date',v_end);
end;
$$;

-- Repair only Short Lets whose global state was clearly written by an active
-- Short Let reservation. Explicit maintenance/closed decisions are untouched.
update public.listings l
set status='available',
    availability_status='available',
    updated_at=now()
where l.sub_type='short_let'
  and l.approved_at is not null
  and l.status in ('reserved','occupied','unavailable')
  and exists(
    select 1
    from public.reservations r
    where r.listing_id=l.id::text
      and r.stay_type='short_let'
      and r.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
      and (l.current_reservation_id is null or l.current_reservation_id=r.id)
  );

revoke all on function public.get_discoverable_listings() from public;
revoke all on function public.get_public_listing_detail(text) from public;
revoke all on function public.get_short_stay_unavailable_listing_ids(date,date) from public,anon;
revoke all on function public.activate_short_stay(text,date) from public,anon;
revoke all on function public.complete_short_stay(text,text) from public,anon;
revoke all on function public.confirm_my_move_in(text) from public,anon;

grant execute on function public.get_discoverable_listings() to anon,authenticated,service_role;
grant execute on function public.get_public_listing_detail(text) to anon,authenticated,service_role;
grant execute on function public.get_short_stay_unavailable_listing_ids(date,date) to authenticated,service_role;
grant execute on function public.activate_short_stay(text,date) to authenticated,service_role;
grant execute on function public.complete_short_stay(text,text) to authenticated,service_role;
grant execute on function public.confirm_my_move_in(text) to authenticated,service_role;
