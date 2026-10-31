-- A Hotel explicitly chooses its WeHouse same-day booking deadline.
-- Existing Hotels retain future-date booking until a cutoff is configured.
alter table public.hotels add column same_day_booking_cutoff time without time zone;
alter table public.hotels add constraint hotels_same_day_cutoff_precision check (
 same_day_booking_cutoff is null or
 (same_day_booking_cutoff<time '24:00' and date_part('second',same_day_booking_cutoff)=0)
);

-- No client may supply a clock to the admission path. The private pure helper
-- takes one explicitly so timezone/boundary contracts can be deterministic.
create function private.hotel_booking_deadline(
 p_in date,p_out date,p_timezone text,p_cutoff time,p_now timestamptz default now()
) returns timestamptz language plpgsql stable set search_path='' as $function$
declare zone text:=coalesce(nullif(p_timezone,''),'Africa/Lagos');today date;deadline timestamptz;
begin
 if p_now is null or not isfinite(p_now) or p_in is null or p_out is null or not isfinite(p_in) or not isfinite(p_out) then
  raise exception 'Choose valid stay dates' using errcode='22023';end if;
 today:=timezone(zone,p_now)::date;
 if p_in<today or p_out<=p_in or p_out>today+366 or p_out-p_in>365 then
  raise exception 'Choose stay dates within the next year' using errcode='22023';end if;
 if p_in=today then
  if p_cutoff is null then raise exception 'This Hotel accepts bookings from tomorrow' using errcode='22023';end if;
  deadline:=(today+p_cutoff) at time zone zone;
  if p_now>=deadline then raise exception 'This Hotel’s same-day booking deadline has passed. Choose a later check-in date' using errcode='22023';end if;
  return deadline;
 end if;
 return null;
end
$function$;
revoke all on function private.hotel_booking_deadline(date,date,text,time,timestamptz) from public,anon,authenticated,service_role;

-- Enforce and audit the setting even when an authorised owner uses table APIs.
create function private.guard_hotel_same_day_cutoff() returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if new.same_day_booking_cutoff is distinct from old.same_day_booking_cutoff then
  if new.hotel_id is distinct from old.hotel_id or not public._property_document_session_active()
   or not public.hotel_actor_has_capability(old.hotel_id,'hotel.policy.manage') then
   raise exception 'A trusted Hotel policy manager is required' using errcode='42501';end if;
  new.updated_at:=now();
  insert into public.hotel_commercial_change_audit(hotel_id,actor_user_id,action,target_type,target_id,before_values,after_values)
  values(old.hotel_id,public.current_profile_user_id(),'same_day_booking_cutoff_updated','hotel',old.hotel_id::text,
   jsonb_build_object('same_day_booking_cutoff',old.same_day_booking_cutoff),
   jsonb_build_object('same_day_booking_cutoff',new.same_day_booking_cutoff));
 end if;
 return new;
end
$function$;
revoke all on function private.guard_hotel_same_day_cutoff() from public,anon,authenticated,service_role;
create trigger guard_hotel_same_day_cutoff before update of same_day_booking_cutoff on public.hotels
for each row execute function private.guard_hotel_same_day_cutoff();

create function private.update_hotel_stay_policy(
 p_hotel_id integer,p_check_in time,p_check_out time,p_cutoff time,p_update_cutoff boolean,p_expected_revision timestamptz default null
) returns public.hotels language plpgsql security definer set search_path='' as $function$
declare before_row public.hotels;result public.hotels;actor text:=public.current_profile_user_id();desired_cutoff time;
begin
 if actor is null or not public._property_document_session_active() or not public.hotel_actor_has_capability(p_hotel_id,'hotel.policy.manage') then
  raise exception 'A trusted Hotel policy manager is required' using errcode='42501';end if;
 if p_check_in is null or p_check_out is null then raise exception 'Check-in and checkout times are required';end if;
 select * into before_row from public.hotels where hotel_id=p_hotel_id for update;
 if before_row.hotel_id is null then raise exception 'Hotel not found';end if;
 desired_cutoff:=case when p_update_cutoff then p_cutoff else before_row.same_day_booking_cutoff end;
 -- A committed retry returns the existing receipt without a second audit entry.
 if (before_row.check_in_time,before_row.check_out_time,before_row.same_day_booking_cutoff)
  is not distinct from (p_check_in,p_check_out,desired_cutoff) then return before_row;end if;
 if p_expected_revision is not null and before_row.updated_at is distinct from p_expected_revision then
  raise exception 'Hotel policy changed. Refresh before saving these choices' using errcode='40001';end if;
 update public.hotels set check_in_time=p_check_in,check_out_time=p_check_out,same_day_booking_cutoff=desired_cutoff,updated_at=now()
 where hotel_id=p_hotel_id returning * into result;
 if (before_row.check_in_time,before_row.check_out_time) is distinct from (result.check_in_time,result.check_out_time) then
  insert into public.hotel_commercial_change_audit(hotel_id,actor_user_id,action,target_type,target_id,before_values,after_values)
  values(p_hotel_id,actor,'stay_policy_updated','hotel',p_hotel_id::text,
   jsonb_build_object('check_in_time',before_row.check_in_time,'check_out_time',before_row.check_out_time),
   jsonb_build_object('check_in_time',result.check_in_time,'check_out_time',result.check_out_time));
 end if;
 return result;
end
$function$;
revoke all on function private.update_hotel_stay_policy(integer,time,time,time,boolean,timestamptz) from public,anon,authenticated,service_role;

-- Older clients may still edit arrival times; they never clear the newer cutoff.
create or replace function public.partner_update_hotel_stay_policy(p_hotel_id integer,p_check_in_time time,p_check_out_time time)
returns public.hotels language plpgsql security definer set search_path='' as $function$
begin return private.update_hotel_stay_policy(p_hotel_id,p_check_in_time,p_check_out_time,null,false,null);end
$function$;
create function public.partner_update_hotel_stay_policy(
 p_hotel_id integer,p_check_in_time time,p_check_out_time time,p_same_day_booking_cutoff time,p_expected_revision timestamptz
) returns public.hotels language plpgsql security definer set search_path='' as $function$
begin
 if p_expected_revision is null then raise exception 'Refresh Hotel policy before saving' using errcode='40001';end if;
 return private.update_hotel_stay_policy(p_hotel_id,p_check_in_time,p_check_out_time,p_same_day_booking_cutoff,true,p_expected_revision);
end
$function$;
revoke all on function public.partner_update_hotel_stay_policy(integer,time,time,time,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.partner_update_hotel_stay_policy(integer,time,time,time,timestamptz) to authenticated;

-- Existing canonical quote, constructor and integrity authorities are extended.
CREATE OR REPLACE FUNCTION public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare h public.hotels; rp public.hotel_rate_plans; q jsonb; deadline timestamptz; booking_deadline timestamptz;
begin

 select * into h from public.hotels where hotel_id=p_hotel_id and status='active' and approved_at is not null and published_at is not null;
 select * into rp from public.hotel_rate_plans where rate_plan_id=p_rate_plan_id and hotel_id=p_hotel_id and room_id=p_room_id and active;
 if h.hotel_id is null or rp.rate_plan_id is null then raise exception 'Hotel room package is not available'; end if;
 booking_deadline:=private.hotel_booking_deadline(p_check_in,p_check_out,h.timezone,h.same_day_booking_cutoff,now());
 q:=private.hotel_booking_quote_core(p_room_id,p_rate_plan_id,p_check_in,p_check_out,null,true,false);
 deadline:=((p_check_in+coalesce(h.check_in_time,time '14:00')) at time zone coalesce(nullif(h.timezone,''),'Africa/Lagos'))-make_interval(hours=>coalesce(rp.cancellation_hours,0));
 return q||jsonb_build_object('same_day_booking_cutoff_at',booking_deadline,'cancellation_deadline',case when rp.refundable then deadline else null end,
 'cancellation_timezone',coalesce(nullif(h.timezone,''),'Africa/Lagos'),'refund_amount_ngn',case when rp.refundable then (q->>'total_price')::numeric else 0 end);
end $function$;

CREATE OR REPLACE FUNCTION public.create_my_hotel_booking_with_rate(p_request_key uuid, p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date, p_guest_count integer, p_guest_name text, p_guest_phone text, p_special_requests text DEFAULT NULL::text)
 RETURNS hotel_bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor text:=private.hotel_checkout_actor();booking public.hotel_bookings; hotel public.hotels;
begin
 if p_request_key is null then raise exception 'A checkout request reference is required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hotel-checkout:'||actor,0));
 select * into booking from public.hotel_bookings where user_id=actor and request_key=p_request_key;
 if booking.booking_id is not null then
  if booking.hotel_id is distinct from p_hotel_id or booking.room_id is distinct from p_room_id or booking.rate_plan_id is distinct from p_rate_plan_id
   or booking.check_in is distinct from p_check_in or booking.check_out is distinct from p_check_out or booking.guest_count is distinct from p_guest_count
   or booking.guest_name is distinct from btrim(p_guest_name) or booking.guest_phone is distinct from btrim(p_guest_phone)
   or booking.special_requests is distinct from nullif(btrim(p_special_requests),'') then raise exception 'These choices differ from your existing room hold. Refresh the hold before editing';end if;
  return booking;
 end if;
 select * into hotel from public.hotels where hotel_id=p_hotel_id and status='active' and approved_at is not null and published_at is not null;
 if hotel.hotel_id is null then raise exception 'Hotel is not available for booking';end if;
 perform private.hotel_booking_deadline(p_check_in,p_check_out,hotel.timezone,hotel.same_day_booking_cutoff,now());
 if p_guest_count is null or p_guest_count<1 or length(btrim(coalesce(p_guest_name,''))) not between 1 and 120
  or length(btrim(coalesce(p_guest_phone,''))) not between 1 and 40 or coalesce(length(p_special_requests),0)>1200 then raise exception 'Check the guest name, phone number, guests and request length';end if;
 if p_guest_phone !~ '^[+0-9() .-]+$' or length(regexp_replace(p_guest_phone,'[^0-9]','','g')) not between 7 and 15 then raise exception 'Enter a phone number with 7–15 digits, including its country code when needed';end if;
 if (select count(*) from public.hotel_bookings where user_id=actor and status='pending' and payment_status<>'paid' and payment_expires_at>now())>=10 then raise exception 'Complete or release an existing room hold before starting another checkout';end if;
 if not (private.consume_user_action(actor,'hotel_booking_write',30,60)->>'allowed')::boolean then raise exception 'Too many checkout requests. Wait a minute and try again';end if;
 booking:=public.create_my_hotel_booking_with_rate(p_hotel_id,p_room_id,p_rate_plan_id,p_check_in,p_check_out,p_guest_count,p_guest_name,p_guest_phone,p_special_requests);
 update public.hotel_bookings set request_key=p_request_key where booking_id=booking.booking_id returning * into booking;
 return booking;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_hotel_booking_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_actor public.profiles;
  v_hotel public.hotels;
  v_room public.hotel_rooms;
  v_plan public.hotel_rate_plans;
  v_quote jsonb;
  v_booking_deadline timestamptz;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if tg_op='INSERT' then
    if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
      raise exception 'Active Personal account required';
    end if;
    new.user_id:=v_actor.user_id;
    new.status:='pending';
    new.payment_status:='unpaid';
    new.payment_expires_at:=coalesce(
      new.payment_expires_at,now()+interval '30 minutes'
    );

    if coalesce(new.guest_count,0)<1 then
      raise exception 'At least one guest is required';
    end if;
    if nullif(btrim(new.guest_name),'') is null
       or nullif(btrim(new.guest_phone),'') is null then
      raise exception 'Guest name and phone are required';
    end if;
    select * into v_hotel from public.hotels
    where hotel_id=new.hotel_id and status='active'
      and approved_at is not null and published_at is not null for share;
    if v_hotel.hotel_id is null then
      raise exception 'Hotel is not available for booking';
    end if;
    v_booking_deadline:=private.hotel_booking_deadline(new.check_in,new.check_out,v_hotel.timezone,v_hotel.same_day_booking_cutoff,now());
    if v_booking_deadline is not null then new.payment_expires_at:=least(new.payment_expires_at,v_booking_deadline);end if;
    select * into v_room from public.hotel_rooms
    where room_id=new.room_id and hotel_id=new.hotel_id;
    if v_room.room_id is null then
      raise exception 'Room type not found for this hotel';
    end if;
    if new.guest_count>coalesce(v_room.max_guests,2) then
      raise exception 'Guest count exceeds this room type capacity';
    end if;
    if new.rate_plan_id is null then
      select * into v_plan from public.hotel_rate_plans
      where room_id=new.room_id and active
      order by (name='Room only') desc,price_per_night,rate_plan_id limit 1;
      new.rate_plan_id:=v_plan.rate_plan_id;
    else
      select * into v_plan from public.hotel_rate_plans
      where rate_plan_id=new.rate_plan_id and room_id=new.room_id
        and hotel_id=new.hotel_id and active;
    end if;
    if v_plan.rate_plan_id is null then
      raise exception 'Room package is not available';
    end if;
    v_quote:=private.hotel_booking_quote_v2(
      new.room_id,v_plan.rate_plan_id,new.check_in,new.check_out,null,true
    );
    if not coalesce((v_quote->>'available')::boolean,false) then
      raise exception 'This room type is unavailable on %',v_quote->>'blocked_date';
    end if;
    new.total_nights:=(v_quote->>'nights')::integer;
    new.total_price:=(v_quote->>'total_price')::numeric;
    new.rate_plan_name:=v_plan.name;
    new.rate_plan_snapshot:=jsonb_build_object(
      'rate_plan_id',v_plan.rate_plan_id,'name',v_plan.name,
      'description',v_plan.description,'meal_plan',v_plan.meal_plan,
      'payment_timing',v_plan.payment_timing,'refundable',v_plan.refundable,
      'cancellation_hours',v_plan.cancellation_hours,
      'price_per_night',v_plan.price_per_night,
      'included_features',v_plan.included_features
    );
    new.created_at:=coalesce(new.created_at,now());
    new.updated_at:=now();
    return new;
  end if;
  if tg_op='UPDATE' then
    if current_user not in ('anon','authenticated') then
      new.updated_at:=now();
      return new;
    end if;
    if v_actor.user_id is null then raise exception 'Authentication required'; end if;
    if v_actor.role='creator' then
      new.updated_at:=now();
      return new;
    end if;
    if not public.current_actor_has_personal_workspace()
       or old.user_id is distinct from v_actor.user_id then
      raise exception 'Booking owner access required';
    end if;
    if old.status<>'pending' or new.status<>'cancelled'
       or old.payment_status='paid' then
      raise exception 'Customers can only cancel their own unpaid pending booking';
    end if;
    new.hotel_id:=old.hotel_id;
    new.room_id:=old.room_id;
    new.rate_plan_id:=old.rate_plan_id;
    new.rate_plan_name:=old.rate_plan_name;
    new.rate_plan_snapshot:=old.rate_plan_snapshot;
    new.user_id:=old.user_id;
    new.check_in:=old.check_in;
    new.check_out:=old.check_out;
    new.guest_count:=old.guest_count;
    new.total_nights:=old.total_nights;
    new.total_price:=old.total_price;
    new.guest_name:=old.guest_name;
    new.guest_phone:=old.guest_phone;
    new.special_requests:=old.special_requests;
    new.payment_reference:=old.payment_reference;
    new.paid_at:=old.paid_at;
    new.confirmed_at:=old.confirmed_at;
    new.created_at:=old.created_at;
    new.updated_at:=now();
    return new;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_public_hotel_detail(p_hotel_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_hotel public.hotels;
  v_actor public.profiles;
  v_internal boolean:=false;
  v_rooms jsonb;
  v_facilities jsonb;
begin
  select * into v_hotel
  from public.hotels h
  where h.hotel_id=p_hotel_id;
  if v_hotel.hotel_id is null then return null; end if;

  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal:=(v_hotel.owner_id=v_actor.user_id
      and public.current_actor_has_workspace('property_partner',null))
      or exists(
        select 1
        from public.hotel_team_members member
        where member.hotel_id=v_hotel.hotel_id
          and member.member_user_id=v_actor.user_id
          and member.status='active'
      )
      or public.current_actor_has_workspace('creator',null)
      or (
        public.current_actor_has_workspace('admin',v_hotel.state)
        and public.current_actor_in_scope(v_hotel.state,v_hotel.city)
      )
      or (
        public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_hotel.state,v_hotel.city)
      );
  end if;

  if not v_internal and not (
    v_hotel.status='active'
    and v_hotel.approved_at is not null
    and v_hotel.published_at is not null
  ) then return null; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'room_id',room.room_id,
      'room_type',room.room_type,
      'description',room.description,
      'price_per_night',room.price_per_night,
      'max_guests',room.max_guests,
      'pets_allowed',room.pets_allowed,
      'bed_type',room.bed_type,
      'images',coalesce(room.images,array[]::text[]),
      'amenities',coalesce(room.amenities,array[]::text[]),
      'rate_plans',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'rate_plan_id',plan.rate_plan_id,
            'room_id',plan.room_id,
            'name',plan.name,
            'description',plan.description,
            'meal_plan',plan.meal_plan,
            'payment_timing',plan.payment_timing,
            'refundable',plan.refundable,
            'cancellation_hours',plan.cancellation_hours,
            'price_per_night',plan.price_per_night,
            'included_features',coalesce(plan.included_features,array[]::text[]),
            'active',plan.active,
            'arrival_issue_window_hours',plan.arrival_issue_window_hours
          )
          order by plan.price_per_night,plan.rate_plan_id
        )
        from public.hotel_rate_plans plan
        where plan.room_id=room.room_id
          and (plan.active or v_internal)
      ),'[]'::jsonb)
    ) || case when v_internal then jsonb_build_object('hotel_id',room.hotel_id,'total_rooms',room.total_rooms) else '{}'::jsonb end
    order by room.price_per_night,room.room_id
  ),'[]'::jsonb)
  into v_rooms
  from public.hotel_rooms room
  where room.hotel_id=v_hotel.hotel_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'venue_id',venue.venue_id,
      'hotel_id',venue.hotel_id,
      'name',venue.name,
      'kind',venue.kind,
      'description',venue.description,
      'opening_hours',venue.opening_hours,
      'package_notes',venue.package_notes,
      'active',venue.active
    ) order by venue.kind,venue.name
  ),'[]'::jsonb)
  into v_facilities
  from public.hotel_venues venue
  where venue.hotel_id=v_hotel.hotel_id
    and (venue.active or v_internal);

  return jsonb_build_object(
    'hotel_id',v_hotel.hotel_id,
    'name',v_hotel.name,
    'description',v_hotel.description,
    'state',v_hotel.state,
    'city',v_hotel.city,
    'area',v_hotel.area,
    'address',v_hotel.address,
    'images',coalesce(v_hotel.images,array[]::text[]),
    'amenities',coalesce(v_hotel.amenities,array[]::text[]),
    'status',v_hotel.status,
    'rating',v_hotel.rating,
    'review_count',v_hotel.review_count,
    'featured',v_hotel.featured,
    'gps_latitude',case when v_internal then v_hotel.gps_latitude else null end,
    'gps_longitude',case when v_internal then v_hotel.gps_longitude else null end,
    'location_exact',v_internal,
    'check_in_time',v_hotel.check_in_time,
    'check_out_time',v_hotel.check_out_time,
    'same_day_booking_cutoff',v_hotel.same_day_booking_cutoff,
    'policy_updated_at',v_hotel.updated_at,
    'timezone',v_hotel.timezone,
    'hotel_rooms',v_rooms,
    'venues',v_facilities
  );
end;
$function$;

-- The old date-only validator could not enforce a Hotel's operating timezone.
-- Both callers now use the single Hotel-aware admission rule above.
drop function private.validate_hotel_checkout_dates(date,date);

