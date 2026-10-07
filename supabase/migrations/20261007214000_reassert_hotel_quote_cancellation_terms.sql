begin;

-- Reassert the canonical hotel quote contract after production-schema
-- reconciliation. That reconciliation intentionally aligned the live RPC
-- surface but accidentally replaced the deadline/refund projection that
-- paid hotel cancellation depends on.
create or replace function public.quote_hotel_room_rate(
  p_hotel_id integer,
  p_room_id integer,
  p_rate_plan_id integer,
  p_check_in date,
  p_check_out date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  h public.hotels;
  rp public.hotel_rate_plans;
  q jsonb;
  deadline timestamptz;
begin
  if p_check_in is null
     or p_check_out is null
     or p_check_in<=current_date
     or p_check_out<=p_check_in then
    raise exception 'Choose valid future check-in and check-out dates';
  end if;

  select * into h
  from public.hotels
  where hotel_id=p_hotel_id
    and status='active'
    and approved_at is not null
    and published_at is not null;

  select * into rp
  from public.hotel_rate_plans
  where rate_plan_id=p_rate_plan_id
    and hotel_id=p_hotel_id
    and room_id=p_room_id
    and active;

  if h.hotel_id is null or rp.rate_plan_id is null then
    raise exception 'Hotel room package is not available';
  end if;

  q:=private.hotel_booking_quote_v2(
    p_room_id,
    p_rate_plan_id,
    p_check_in,
    p_check_out,
    null,
    true
  );

  deadline:=(
    (p_check_in+coalesce(h.check_in_time,time '14:00'))
      at time zone coalesce(nullif(h.timezone,''),'Africa/Lagos')
  )-make_interval(hours=>coalesce(rp.cancellation_hours,0));

  return q||jsonb_build_object(
    'cancellation_deadline',
      case when rp.refundable then deadline else null end,
    'cancellation_timezone',
      coalesce(nullif(h.timezone,''),'Africa/Lagos'),
    'refund_amount_ngn',
      case when rp.refundable then (q->>'total_price')::numeric else 0 end
  );
end
$function$;

revoke all on function public.quote_hotel_room_rate(integer,integer,integer,date,date)
  from public,anon,authenticated,service_role;
grant execute on function public.quote_hotel_room_rate(integer,integer,integer,date,date)
  to authenticated,service_role;

commit;
