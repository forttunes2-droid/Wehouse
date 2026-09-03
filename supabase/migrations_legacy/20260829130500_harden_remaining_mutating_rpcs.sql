-- Add explicit caller authorization to legacy mutating RPCs still used by the app.

create or replace function public.delete_service_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
begin
  if not public.is_current_creator() then
    raise exception 'Creator account required';
  end if;
  delete from public.service_subcategories where category_id=p_category_id;
  delete from public.service_categories where id=p_category_id;
end;
$function$;

create or replace function public.delete_service_subcategory(p_subcategory_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
begin
  if not public.is_current_creator() then
    raise exception 'Creator account required';
  end if;
  delete from public.service_subcategories where id=p_subcategory_id;
end;
$function$;

create or replace function public.cancel_rent_plan(
  p_plan_id uuid,
  p_reason text default null,
  p_reason_category text default 'voluntary'
)
returns table(refund_amount numeric,fee_amount numeric,total_contributed numeric)
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_plan public.rent_plans%rowtype;
  v_actor text:=public.current_profile_user_id();
  v_creator boolean:=public.is_current_creator();
  v_fee_amount numeric;
  v_refund_amount numeric;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_plan from public.rent_plans where id=p_plan_id for update;
  if not found then raise exception 'Rent plan not found'; end if;
  if v_plan.user_id is distinct from v_actor and not v_creator then
    raise exception 'You cannot cancel this rent plan';
  end if;
  if v_plan.status='cancelled' then raise exception 'Already cancelled'; end if;
  if not v_creator and coalesce(p_reason_category,'voluntary')<>'voluntary' then
    raise exception 'Only WeHouse can classify a provider failure';
  end if;

  if p_reason_category='provider_failure' then
    v_fee_amount:=0;
    v_refund_amount:=v_plan.total_contributed;
  else
    v_fee_amount:=round(v_plan.total_contributed*v_plan.cancellation_fee_percent/100,2);
    v_refund_amount:=v_plan.total_contributed-v_fee_amount;
  end if;

  insert into public.rent_plan_cancellations(
    rent_plan_id,user_id,total_contributed,cancellation_fee_percent,
    cancellation_fee_amount,refund_amount,reason,reason_category
  ) values (
    p_plan_id,v_plan.user_id,v_plan.total_contributed,v_plan.cancellation_fee_percent,
    v_fee_amount,v_refund_amount,p_reason,coalesce(p_reason_category,'voluntary')
  );
  update public.rent_plans
  set status='cancelled',total_paid_out=v_refund_amount,updated_at=now()
  where id=p_plan_id;

  refund_amount:=v_refund_amount;
  fee_amount:=v_fee_amount;
  total_contributed:=v_plan.total_contributed;
  return next;
end;
$function$;

revoke all on function public.expire_stale_hotel_booking_holds() from public,anon,authenticated;
revoke all on function public.set_apartment_commission_on_reservation(text) from public,anon,authenticated;
grant execute on function public.expire_stale_hotel_booking_holds() to service_role;
grant execute on function public.set_apartment_commission_on_reservation(text) to service_role;

revoke all on function public.delete_service_category(uuid) from public,anon;
revoke all on function public.delete_service_subcategory(uuid) from public,anon;
revoke all on function public.cancel_rent_plan(uuid,text,text) from public,anon;
grant execute on function public.delete_service_category(uuid) to authenticated;
grant execute on function public.delete_service_subcategory(uuid) to authenticated;
grant execute on function public.cancel_rent_plan(uuid,text,text) to authenticated;
