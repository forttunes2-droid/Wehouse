-- Keep recurring-task metadata in the canonical Partner Pro workspace RPC.
-- The production-schema reconciliation had dropped these fields, hiding the
-- idempotency linkage from clients and its contract test.
CREATE OR REPLACE FUNCTION public.get_my_partner_pro_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_assets jsonb; v_stays jsonb;
  v_income jsonb; v_tasks jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null)
    or not public.partner_pro_is_active(v_actor) then raise exception 'Active Property Partner Pro required'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.title),'[]'::jsonb) into v_assets from (
    select 'home'::text kind,l.id::text id,l.title from public.property_host_assignments a
      join public.listings l on l.id=a.listing_id
      where a.user_id=v_actor and a.assignment_role='owner' and a.status='active' and l.deleted_at is null
    union all
    select 'hotel',h.hotel_id::text,h.name from public.hotels h where h.owner_id=v_actor
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.check_in,x.asset_title),'[]'::jsonb) into v_stays from (
    select 'home'::text kind,l.id::text asset_id,l.title asset_title,r.id::text booking_id,
      r.stay_check_in::date check_in,r.stay_check_out::date check_out,r.status
    from public.reservations r join public.listings l on r.listing_id in (l.id::text,l.listing_id)
    join public.property_host_assignments a on a.listing_id=l.id and a.user_id=v_actor
      and a.assignment_role='owner' and a.status='active'
    where l.deleted_at is null and r.stay_check_in>=current_date-30
      and r.stay_check_in<current_date+180 and r.status not in ('cancelled','expired','refunded')
      and (r.rent_payment_status='paid' or r.manual_payment_status in ('paid','completed') or r.status in ('occupied','completed'))
    union all
    select 'hotel',h.hotel_id::text,h.name,b.booking_id::text,b.check_in,b.check_out,b.status
    from public.hotel_bookings b join public.hotels h on h.hotel_id=b.hotel_id
    where h.owner_id=v_actor and b.check_in>=current_date-30 and b.check_in<current_date+180
      and b.status not in ('cancelled','expired','refunded','payment_conflict')
      and (b.payment_status='paid' or b.status in ('confirmed','checked_in','checked_out','completed'))
    order by check_in limit 1000
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.month_key),'[]'::jsonb) into v_income from (
    select to_char(date_trunc('month',coalesce(released_at,created_at)),'YYYY-MM') as month_key,
      sum(net_amount) net_amount,count(*) earnings
    from public.property_partner_earning_releases
    where partner_id=v_actor and status='available'
      and coalesce(released_at,created_at)>=date_trunc('month',now())-interval '11 months'
    group by 1
  ) x;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.due_on nulls last,t.created_at desc),'[]'::jsonb)
  into v_tasks from (
    select id,asset_kind,asset_id,title,due_on,status,created_at,repeat_days,previous_task_id from public.partner_pro_tasks
    where owner_id=v_actor and public.partner_pro_owns_asset(asset_kind,asset_id)
    order by due_on nulls last,created_at desc limit 200
  ) t;
  return jsonb_build_object('assets',v_assets,'stays',v_stays,'income',v_income,
    'tasks',v_tasks,'stays_limited',jsonb_array_length(v_stays)=1000,
    'tasks_limited',jsonb_array_length(v_tasks)=200);
end $function$;
revoke all on function public.get_my_partner_pro_overview() from public, anon, authenticated, service_role;

grant execute on function public.get_my_partner_pro_overview() to service_role;
grant execute on function public.get_my_partner_pro_overview() to authenticated;
