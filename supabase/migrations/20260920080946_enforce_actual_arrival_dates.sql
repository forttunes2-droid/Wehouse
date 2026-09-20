begin;

-- Calendar dates belong to the property, not the browser or UTC session.
create or replace function public.property_arrival_allowed(
  p_stay_type text, p_check_in date, p_check_out date,
  p_requested_at timestamptz, p_actual_date date, p_now timestamptz default now()
) returns boolean language sql immutable
set search_path to 'pg_catalog','public'
as $$
  select coalesce(
    p_actual_date = timezone('Africa/Lagos',p_now)::date
    and case when p_stay_type='short_let' then
      p_actual_date >= p_check_in and p_actual_date < p_check_out
    when p_stay_type='long_stay' then
      p_requested_at <= p_now
      and timezone('Africa/Lagos',p_requested_at)::date = p_actual_date
    else false end, false);
$$;
revoke all on function public.property_arrival_allowed(text,date,date,timestamptz,date,timestamptz) from public,anon;
grant execute on function public.property_arrival_allowed(text,date,date,timestamptz,date,timestamptz) to authenticated,service_role;

-- This guard covers alternate write paths too. Scheduling a future appointment
-- is allowed; recording physical entry before that appointment is not.
create or replace function public.enforce_actual_property_arrival()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_entry boolean;
begin
  v_entry := (new.status='occupied' and (tg_op='INSERT' or old.status is distinct from new.status))
    or (new.checked_in_at is not null and (tg_op='INSERT' or old.checked_in_at is null))
    or (new.verified_handover_at is not null and (tg_op='INSERT' or old.verified_handover_at is null))
    or (new.canonical_state in ('checked_in','handover_verified','active')
      and (tg_op='INSERT' or old.canonical_state is distinct from new.canonical_state)
      and (tg_op='INSERT' or old.status is distinct from 'occupied'));
  if v_entry and not public.property_arrival_allowed(
    coalesce(new.stay_type,'long_stay'),new.stay_check_in,new.stay_check_out,
    new.requested_move_in_at,coalesce(new.tenancy_start_date,timezone('Africa/Lagos',now())::date)
  ) then
    raise exception 'Arrival must be recorded today within the booked dates and at or after the requested move-in time (Nigeria time)';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_actual_property_arrival() from public,anon,authenticated;
create trigger reservations_actual_arrival_guard
before insert or update of status,checked_in_at,verified_handover_at,canonical_state on public.reservations
for each row execute function public.enforce_actual_property_arrival();

CREATE OR REPLACE FUNCTION public.verify_branch_booking_code(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
declare
  v_actor public.profiles;
  v_code text:=upper(btrim(coalesce(p_code,'')));
  v_result jsonb;
  v_state text;
  v_lga text;
begin
  if v_code !~ '^[A-Z]{3}WH[0-9]{5}$' then raise exception 'Enter a valid WeHouse booking code'; end if;
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and role in ('staff','admin','creator')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null or not public.user_has_active_workspace(v_actor.user_id,v_actor.role) then raise exception 'Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations module required';
  end if;

  select jsonb_build_object(
    'kind','housing','code',r.booking_code,'status',r.status,'payment_status',r.rent_payment_status,
    'reservation_fee_status',r.manual_payment_status,'stay_type',coalesce(r.stay_type,'long_stay'),
    'customer_name',coalesce(p.full_name,p.username,r.user_email),'customer_phone',coalesce(p.phone,r.user_phone),
    'property_name',coalesce(l.title,r.listing_title),'state',l.state,'lga',l.city,'reservation_id',r.id,
    'listing_id',r.listing_id,'check_in',r.stay_check_in,'check_out',r.stay_check_out,
    'guest_count',coalesce(r.guest_count,1),'requested_move_in_at',r.requested_move_in_at,
    'tenancy_start_date',r.tenancy_start_date,'tenancy_end_date',r.tenancy_end_date,
    'valid',((r.stay_type='short_let' or (r.manual_payment_status in ('paid','completed') and r.paid_at is not null))
      and r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null),
    'can_handover',(coalesce(r.stay_type,'long_stay')='long_stay' and r.status='ready_for_move_in'
      and r.manual_payment_status in ('paid','completed') and r.paid_at is not null
      and r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null
      and public.property_arrival_allowed('long_stay',null,null,r.requested_move_in_at,timezone('Africa/Lagos',now())::date)),
    'can_check_in',(r.stay_type='short_let' and r.status='ready_for_move_in'
      and r.rent_payment_status='paid' and r.rent_paid_at is not null
      and public.property_arrival_allowed('short_let',r.stay_check_in,r.stay_check_out,null,timezone('Africa/Lagos',now())::date))
  ),l.state,l.city
  into v_result,v_state,v_lga
  from public.reservations r
  join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
  left join public.profiles p on p.user_id=r.user_id
  where r.booking_code=v_code
  limit 1;

  if v_result is null then
    select jsonb_build_object(
      'kind','hotel','code',hb.booking_code,'status',hb.status,'payment_status',hb.payment_status,
      'customer_name',coalesce(p.full_name,p.username,hb.guest_name),'customer_phone',coalesce(p.phone,hb.guest_phone),
      'property_name',h.name,'state',h.state,'lga',h.city,'booking_id',hb.booking_id,'hotel_id',hb.hotel_id,
      'check_in',hb.check_in,'check_out',hb.check_out,'guest_count',hb.guest_count,
      'valid',(hb.payment_status='paid' and hb.status not in ('cancelled','refunded')),
      'can_check_in',(hb.payment_status='paid' and hb.status in ('confirmed','paid')
        and timezone(h.timezone,now()) >= hb.check_in + h.check_in_time
        and timezone(h.timezone,now()) < hb.check_out + h.check_out_time)
    ),h.state,h.city
    into v_result,v_state,v_lga
    from public.hotel_bookings hb
    join public.hotels h on h.hotel_id=hb.hotel_id
    left join public.profiles p on p.user_id=hb.user_id
    where hb.booking_code=v_code
    limit 1;
  end if;
  if v_result is null then return null; end if;
  if not public.current_actor_in_scope(v_state,v_lga) then
    raise exception 'This booking belongs to another WeHouse branch';
  end if;
  return v_result;
end;
$_$;

CREATE OR REPLACE FUNCTION public.confirm_short_stay_check_in_by_code(p_booking_code text, p_check_in_date date DEFAULT (timezone('Africa/Lagos',now()))::date) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare v_verified jsonb; v_result public.reservations;
begin
  v_verified:=public.verify_branch_booking_code(p_booking_code);
  if v_verified is null
    or v_verified->>'kind'<>'housing'
    or v_verified->>'stay_type'<>'short_let'
  then
    raise exception 'Enter a valid Short Let booking code';
  end if;
  if coalesce((v_verified->>'can_check_in')::boolean,false) is not true then
    raise exception 'Check-in requires verified stay payment and arrival within the booked dates';
  end if;
  select public.activate_short_stay(v_verified->>'reservation_id',p_check_in_date)
  into v_result;
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION public.confirm_apartment_handover(p_booking_code text, p_start_date date DEFAULT (timezone('Africa/Lagos',now()))::date) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_verified jsonb;
  v_result public.reservations;
  v_res public.reservations;
begin
  v_verified:=public.verify_branch_booking_code(p_booking_code);
  if v_verified is null or v_verified->>'kind'<>'housing' then
    raise exception 'Enter a valid housing move-in code';
  end if;
  if coalesce((v_verified->>'can_handover')::boolean,false) is not true then
    raise exception 'Verified rent and arrival at or after the requested move-in time are required before handover';
  end if;
  if p_start_date is distinct from timezone('Africa/Lagos',(v_verified->>'requested_move_in_at')::timestamptz)::date then
    raise exception 'The tenancy start date must match the customer move-in request';
  end if;
  select * into v_res from public.reservations where id=v_verified->>'reservation_id';
  if v_res.handover_field_officer_id is null or v_res.handover_conversation_id is null then
    raise exception 'Assign Field Operations to the reservation conversation before handover';
  end if;
  select * into v_result from public.activate_apartment_tenancy(v_res.id,p_start_date);
  return v_result;
end;
$$;

CREATE OR REPLACE FUNCTION public.activate_short_stay(p_reservation_id text, p_actual_check_in date DEFAULT (timezone('Africa/Lagos',now()))::date) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_result public.reservations;
  v_protection public.payment_protection_transactions;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.user_has_active_workspace(v_actor.user_id,v_actor.role) then raise exception 'Housing Operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;
  select * into v_res from public.reservations
  where id=p_reservation_id and stay_type='short_let' for update;
  if v_res.id is null then raise exception 'Short Stay reservation not found'; end if;
  select * into v_listing from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id for update;
  if v_listing.id is null or v_listing.sub_type<>'short_let' then
    raise exception 'Short Stay listing not found';
  end if;
  if not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Listing is outside your assigned State/LGA';
  end if;
  if v_listing.status<>'available' or v_listing.availability_status<>'available' then
    raise exception 'This Short Stay is not currently open for guest stays';
  end if;
  if v_res.status<>'ready_for_move_in' or v_res.rent_payment_status<>'paid'
     or v_res.rent_paid_at is null then
    raise exception 'Short Stay payment must be verified before check-in';
  end if;
  if not public.property_arrival_allowed('short_let',v_res.stay_check_in,v_res.stay_check_out,null,p_actual_check_in) then
    raise exception 'Check-in must be recorded today within the reserved stay dates (Nigeria time)';
  end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_res.stay_payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state<>'protected' then
    raise exception 'Current Short Stay Payment Protection is required before check-in';
  end if;
  if exists(
    select 1 from public.reservations reservation
    where reservation.listing_id=v_res.listing_id and reservation.id<>v_res.id
      and reservation.stay_type='short_let' and reservation.status='occupied'
      and daterange(reservation.stay_check_in,reservation.stay_check_out,'[)')
        && daterange(v_res.stay_check_in,v_res.stay_check_out,'[)')
  ) then raise exception 'Those Short Stay dates are already occupied'; end if;

  update public.reservations
  set status='occupied',tenancy_start_date=p_actual_check_in,
      tenancy_end_date=v_res.stay_check_out,move_out_grace_until=v_res.stay_check_out,
      occupancy_started_at=now(),checked_in_at=now(),updated_at=now()
  where id=v_res.id returning * into v_result;

  insert into public.obligation_policy_snapshots(
    subject_type,subject_id,policy_version_id,calculated_value
  ) values(
    'short_let',v_res.id,v_result.arrival_issue_policy_version_id,
    jsonb_build_object('arrival_issue_window_hours',v_result.arrival_issue_window_hours,
      'arrival_issue_deadline_at',v_result.arrival_issue_deadline_at,
      'authorized_check_in_at',v_result.checked_in_at)
  ) on conflict(subject_type,subject_id,policy_version_id) do nothing;

  update public.listings set
    status='available',availability_status='available',reserved_by=null,
    reservation_expiry=null,occupied_by=null,occupied_at=null,tenancy_ends_at=null,
    current_reservation_id=null,updated_at=now()
  where id=v_listing.id and status in ('reserved','occupied');
  return v_result;
end
$$;

CREATE OR REPLACE FUNCTION public.activate_apartment_tenancy(p_reservation_id text, p_start_date date DEFAULT (timezone('Africa/Lagos',now()))::date) RETURNS public.reservations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_actor public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_years integer;
  v_grace integer;
  v_end date;
  v_result public.reservations;
  v_rent_payment_id uuid;
  v_plan_id uuid;
  v_target_year integer;
  v_i integer;
  v_due date;
  v_base numeric;
  v_amount numeric;
  v_annual numeric;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor.user_id IS NULL OR NOT public.user_has_active_workspace(v_actor.user_id,v_actor.role) THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;

  SELECT * INTO v_res FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF v_res.id IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id::text=v_res.listing_id FOR UPDATE;
  IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF COALESCE(v_listing.sub_type,'long_stay')<>'long_stay' THEN RAISE EXCEPTION 'Long-stay tenancy activation is not valid for Short Stay'; END IF;
  IF NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned State/LGA'; END IF;
  IF v_res.status<>'ready_for_move_in' THEN RAISE EXCEPTION 'Inspection must pass before move-in'; END IF;
  IF v_res.manual_payment_status NOT IN ('paid','completed') OR v_res.paid_at IS NULL THEN RAISE EXCEPTION 'Reservation fee is not confirmed'; END IF;
  IF v_res.rent_payment_status NOT IN ('paid','upfront_paid') OR v_res.rent_paid_at IS NULL THEN RAISE EXCEPTION 'Year 1 rent must be verified before move-in'; END IF;

  IF NOT public.property_arrival_allowed('long_stay',null,null,v_res.requested_move_in_at,p_start_date) THEN
    RAISE EXCEPTION 'Handover must be recorded today at or after the requested move-in time (Nigeria time)';
  END IF;

  v_years:=COALESCE(v_res.rental_plan_years,1);
  IF v_years < 1 OR v_years > 5 THEN RAISE EXCEPTION 'Rental tenure must be between 1 and 5 years'; END IF;
  SELECT NULLIF(value,'')::integer INTO v_grace
  FROM public.platform_settings
  WHERE key='tenancy_grace_days' AND COALESCE(is_active,true)=true
  LIMIT 1;
  IF v_grace IS NULL OR v_grace<0 OR v_grace>30 THEN v_grace:=7; END IF;
  v_end:=(p_start_date+make_interval(years=>v_years))::date;

  UPDATE public.reservations
  SET status='occupied',tenancy_start_date=p_start_date,tenancy_end_date=v_end,
      move_out_grace_until=v_end+v_grace,occupancy_started_at=now(),updated_at=now()
  WHERE id=v_res.id
  RETURNING * INTO v_result;

  UPDATE public.listings
  SET status='occupied',availability_status='occupied',occupied_by=v_res.user_id,occupied_at=now(),tenancy_ends_at=v_end,
      reserved_by=NULL,reservation_expiry=NULL,current_reservation_id=v_res.id,updated_at=now()
  WHERE id=v_listing.id;

  UPDATE public.rent_plans
  SET tenancy_start_date=p_start_date,updated_at=now()
  WHERE reservation_id=v_res.id AND status='active';

  IF v_years>1 THEN
    SELECT id INTO v_plan_id
    FROM public.rent_plans
    WHERE reservation_id=v_res.id AND status='active'
    LIMIT 1;
    IF v_plan_id IS NULL THEN RAISE EXCEPTION 'Future-rent plan is missing'; END IF;

    v_annual:=round(COALESCE(v_res.annual_rent_snapshot,v_listing.price),2);
    v_base:=trunc(v_annual/8.0,2);

    FOR v_target_year IN 2..v_years LOOP
      FOR v_i IN 1..8 LOOP
        v_due:=(p_start_date+make_interval(years=>v_target_year-2,months=>4+v_i-1))::date;
        v_amount:=CASE WHEN v_i=8 THEN round(v_annual-(v_base*7),2) ELSE v_base END;
        INSERT INTO public.rent_plan_contributions(
          rent_plan_id,reservation_id,amount,status,target_year,installment_number,due_date,created_at,updated_at
        ) VALUES (
          v_plan_id,v_res.id,v_amount,'scheduled',v_target_year,v_i,v_due,now(),now()
        )
        ON CONFLICT (rent_plan_id,target_year,installment_number)
        DO UPDATE SET
          reservation_id=EXCLUDED.reservation_id,
          amount=CASE WHEN public.rent_plan_contributions.status IN ('paid','completed') THEN public.rent_plan_contributions.amount ELSE EXCLUDED.amount END,
          due_date=CASE WHEN public.rent_plan_contributions.status IN ('paid','completed') THEN public.rent_plan_contributions.due_date ELSE EXCLUDED.due_date END,
          updated_at=now();
      END LOOP;
    END LOOP;

    UPDATE public.rent_plans
    SET next_rent_due_date=(
          SELECT min(c.due_date) FROM public.rent_plan_contributions c
          WHERE c.rent_plan_id=v_plan_id AND c.status IN ('scheduled','payment_pending','pending')
        ),
        installment_count=8*(v_years-1),
        installment_balance=round(v_annual*(v_years-1),2),
        target_amount=round(v_annual*(v_years-1),2),
        updated_at=now()
    WHERE id=v_plan_id;
  END IF;

  SELECT id INTO v_rent_payment_id
  FROM public.booking_payments
  WHERE paystack_reference=v_res.rent_payment_reference
    AND purpose='apartment_rent'
    AND status IN ('paid','completed')
  LIMIT 1;
  IF v_rent_payment_id IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.property_partner_earning_releases WHERE payment_id=v_rent_payment_id AND status='pending') THEN
    PERFORM public.release_property_partner_earning(v_rent_payment_id,'long_stay_move_in_confirmed');
  END IF;
  RETURN v_result;
END;
$$;

-- Hotel Team transitions already enforce hotel-local arrival times. Keep the
-- older operations-code path and direct status writes under the same rule.
create or replace function public.enforce_actual_hotel_arrival()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare h public.hotels; local_now timestamp;
begin
  if new.status='checked_in' and (tg_op='INSERT' or old.status is distinct from new.status) then
    select * into h from public.hotels where hotel_id=new.hotel_id;
    local_now:=timezone(h.timezone,now());
    if h.hotel_id is null or local_now is null
      or new.check_in is null or new.check_out is null
      or h.check_in_time is null or h.check_out_time is null
      or local_now < new.check_in+h.check_in_time
      or local_now >= new.check_out+h.check_out_time then
      raise exception 'Hotel check-in is only available during the booked stay, using the hotel local time';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_actual_hotel_arrival() from public,anon,authenticated;
create trigger hotel_bookings_actual_arrival_guard
before insert or update of status on public.hotel_bookings
for each row execute function public.enforce_actual_hotel_arrival();

commit;
