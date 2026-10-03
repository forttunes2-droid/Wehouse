-- Quotes are advisory snapshots. Only the authoritative booking check locks inventory.
-- Preserve the existing locked entry point for all booking/payment callers.
CREATE OR REPLACE FUNCTION private.hotel_booking_quote_core(p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date, p_exclude_booking_id integer DEFAULT NULL::integer, p_include_live_holds boolean DEFAULT true, p_lock_inventory boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_room public.hotel_rooms;
  v_plan public.hotel_rate_plans;
  v_day date;
  v_capacity integer;
  v_operational_units integer;
  v_reserved integer;
  v_base_rate numeric;
  v_rate numeric;
  v_total numeric:=0;
begin
  if p_check_in is null or p_check_out is null or p_check_out<=p_check_in then
    raise exception 'Choose valid check-in and check-out dates';
  end if;
  if p_lock_inventory then
    select * into v_room from public.hotel_rooms where room_id=p_room_id for update;
  else
    select * into v_room from public.hotel_rooms where room_id=p_room_id;
  end if;
  select * into v_plan from public.hotel_rate_plans
  where rate_plan_id=p_rate_plan_id and room_id=p_room_id and active;
  if v_room.room_id is null or coalesce(v_room.total_rooms,0)<1
     or v_plan.rate_plan_id is null or coalesce(v_plan.price_per_night,0)<=0 then
    raise exception 'Room package is not available for booking';
  end if;

  select count(*)::integer into v_operational_units
  from public.hotel_room_units unit
  where unit.room_id=v_room.room_id
    and unit.status not in ('maintenance','out_of_service');

  for v_day in
    select generate_series(p_check_in,p_check_out-1,interval '1 day')::date
  loop
    select
      least(
        case when coalesce(i.closed,false) then 0
          else coalesce(i.available_quantity,v_room.total_rooms)
        end,
        v_operational_units
      ),
      coalesce(i.rate_override,v_room.price_per_night)
    into v_capacity,v_base_rate
    from (select 1) seed
    left join public.hotel_inventory_daily i
      on i.room_id=v_room.room_id and i.inventory_date=v_day;

    select count(*)::integer into v_reserved
    from public.hotel_bookings hb
    where hb.room_id=v_room.room_id
      and hb.booking_id is distinct from p_exclude_booking_id
      and hb.check_in<=v_day and hb.check_out>v_day
      and (
        hb.status in ('confirmed','checked_in')
        or (
          p_include_live_holds and hb.status='pending'
          and coalesce(hb.payment_expires_at,hb.created_at+interval '30 minutes')>now()
        )
      );
    if coalesce(v_capacity,0)<=v_reserved then
      return jsonb_build_object(
        'available',false,
        'blocked_date',v_day,
        'capacity',coalesce(v_capacity,0),
        'reserved',v_reserved
      );
    end if;
    v_rate:=greatest(1,v_base_rate+(v_plan.price_per_night-v_room.price_per_night));
    v_total:=v_total+v_rate;
  end loop;
  return jsonb_build_object(
    'available',true,
    'nights',p_check_out-p_check_in,
    'total_price',round(v_total,2),
    'rate_plan_id',v_plan.rate_plan_id,
    'rate_plan_name',v_plan.name,
    'meal_plan',v_plan.meal_plan,
    'payment_timing',v_plan.payment_timing,
    'refundable',v_plan.refundable,
    'cancellation_hours',v_plan.cancellation_hours
  );
end;
$function$
;
REVOKE ALL ON FUNCTION private.hotel_booking_quote_core(integer,integer,date,date,integer,boolean,boolean) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.hotel_booking_quote_v2(p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date, p_exclude_booking_id integer DEFAULT NULL, p_include_live_holds boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog','public','private'
AS $function$
 SELECT private.hotel_booking_quote_core(p_room_id,p_rate_plan_id,p_check_in,p_check_out,p_exclude_booking_id,p_include_live_holds,true);
$function$;
CREATE OR REPLACE FUNCTION public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare h public.hotels; rp public.hotel_rate_plans; q jsonb; deadline timestamptz;
begin
 if p_check_in is null or p_check_out is null or p_check_in<=current_date or p_check_out<=p_check_in then raise exception 'Choose valid future check-in and check-out dates'; end if;
 select * into h from public.hotels where hotel_id=p_hotel_id and status='active' and approved_at is not null and published_at is not null;
 select * into rp from public.hotel_rate_plans where rate_plan_id=p_rate_plan_id and hotel_id=p_hotel_id and room_id=p_room_id and active;
 if h.hotel_id is null or rp.rate_plan_id is null then raise exception 'Hotel room package is not available'; end if;
 q:=private.hotel_booking_quote_core(p_room_id,p_rate_plan_id,p_check_in,p_check_out,null,true,false);
 deadline:=((p_check_in+coalesce(h.check_in_time,time '14:00')) at time zone coalesce(nullif(h.timezone,''),'Africa/Lagos'))-make_interval(hours=>coalesce(rp.cancellation_hours,0));
 return q||jsonb_build_object('cancellation_deadline',case when rp.refundable then deadline else null end,
 'cancellation_timezone',coalesce(nullif(h.timezone,''),'Africa/Lagos'),'refund_amount_ngn',case when rp.refundable then (q->>'total_price')::numeric else 0 end);
end $function$
;
