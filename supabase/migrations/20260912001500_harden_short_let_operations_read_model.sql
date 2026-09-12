-- Keep Short Let occupancy visible to Operations without putting that occupancy
-- back onto the published listing row. Also close the legacy customer move-in
-- path that could write listing-wide occupied state for a dated Short Let.

create or replace function public.get_my_short_stay_operations_v2()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Housing operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'reservation_id',r.id,
    'booking_code',r.booking_code,
    'status',r.status,
    'payment_status',r.rent_payment_status,
    'reservation_fee_paid',(r.manual_payment_status in ('paid','completed') and r.paid_at is not null),
    'check_in',r.stay_check_in,
    'check_out',r.stay_check_out,
    'nights',r.stay_nights,
    'guest_count',coalesce(r.guest_count,1),
    'nightly_rate',r.nightly_rate_snapshot,
    'stay_rent_total',r.stay_rent_total,
    'security_deposit',r.security_deposit_snapshot,
    'security_deposit_status',r.security_deposit_status,
    'customer_user_id',r.user_id,
    'customer_name',coalesce(p.full_name,p.username,p.email),
    'customer_phone',p.phone,
    'listing_id',l.id,
    'listing_title',l.title,
    'state',l.state,
    'lga',l.city,
    'address',l.address,
    -- Compatibility field for the existing Operations UI only. The actual
    -- listing remains available/published; this value describes this stay.
    'listing_status',case when r.status='occupied' then 'occupied' else l.status end,
    'publication_status',l.status
  ) order by r.stay_check_in asc,r.created_at asc),'[]'::jsonb)
  into v_result
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id
  left join public.profiles p on p.user_id=r.user_id
  where r.stay_type='short_let'
    and r.status in ('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
    and (v_actor.role='creator' or public.current_actor_in_scope(l.state,l.city));
  return v_result;
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
    and r.status=any(array['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied']::text[])
    and (
      r.status<>'payment_pending'
      or r.payment_expires_at is null
      or r.payment_expires_at>now()
      or exists(
        select 1 from public.booking_payments bp
        where bp.paystack_reference=r.payment_reference
          and bp.status in ('paid','completed')
      )
    )
    and daterange(r.stay_check_in,r.stay_check_out,'[)') && daterange(p_check_in,p_check_out,'[)');
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
    raise exception 'Short Let check-in is confirmed by Housing Operations with the booking code';
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

  -- Long Let intentionally keeps listing-wide occupancy.
  update public.listings
  set status='occupied',availability_status='unavailable',occupied_by=v_actor.user_id,occupied_at=now(),tenancy_ends_at=v_end,reserved_by=null,reservation_expiry=null,updated_at=now()
  where id::text=v_reservation.listing_id;
  if not found then raise exception 'Reservation listing was not found'; end if;

  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values('USER_MOVE_IN_CONFIRMED','reservations',v_reservation.id,jsonb_build_object('booking_code',v_reservation.booking_code,'tenancy_start_date',v_start,'tenancy_end_date',v_end)::text,v_actor.user_id,v_actor.email);

  return jsonb_build_object('success',true,'status','occupied','tenancy_start_date',v_start,'tenancy_end_date',v_end);
end;
$$;

comment on function public.get_my_short_stay_operations_v2()
is 'Operations read model: reservation occupancy may display as occupied while the published Short Let listing remains date-sellable.';
