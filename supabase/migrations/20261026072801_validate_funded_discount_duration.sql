begin;
CREATE OR REPLACE FUNCTION public.creator_set_wehouse_discount(p_listing_id uuid, p_state text, p_percent numeric, p_ends_on date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles; v_id uuid; v_state text:=nullif(public.wehouse_state_key(p_state),'');
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role is distinct from 'creator' then raise exception 'Only the Creator can set a WeHouse-funded discount'; end if;
  if (p_listing_id is null)=(v_state is null) then raise exception 'Choose one property or one state'; end if;
  if p_percent is null or p_percent<5 then raise exception 'A WeHouse-funded discount must be at least 5 percent'; end if;
  if p_percent>public.wehouse_discount_ceiling() then raise exception 'WeHouse cannot discount more than the commission it earns (% percent)',public.wehouse_discount_ceiling(); end if;

  if p_ends_on is not null and (not isfinite(p_ends_on) or p_ends_on<current_date) then raise exception 'Choose today or a future discount end date';end if;
  perform pg_advisory_xact_lock(hashtextextended('funded-home:'||coalesce(p_listing_id::text,v_state),0));
  select d.id into v_id from public.listing_discounts d where d.funded_by='wehouse' and d.active
   and ((p_listing_id is not null and d.listing_id=p_listing_id) or (v_state is not null and d.state_key=v_state))
   and d.percent=p_percent and d.ends_on is not distinct from p_ends_on order by d.created_at desc limit 1;
  if v_id is not null then return v_id;end if;
  update public.listing_discounts set active=false where funded_by='wehouse' and active
    and ((p_listing_id is not null and listing_id=p_listing_id) or (v_state is not null and state_key=v_state));
  insert into public.listing_discounts(listing_id,state_key,funded_by,percent,ends_on,created_by)
  values(p_listing_id,v_state,'wehouse',p_percent,p_ends_on,v_actor.user_id) returning id into v_id;
  return v_id;
end $function$;
CREATE OR REPLACE FUNCTION public.creator_set_wehouse_hotel_discount(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_percent numeric, p_ends_on date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles; v_id uuid;
begin
  v_actor := public._admin_dashboard_actor();
  if v_actor.role is distinct from 'creator' then raise exception 'Only the Creator can set a WeHouse-funded discount'; end if;
  if p_percent is null or p_percent < 5 or p_percent > 15 then raise exception 'A WeHouse-funded discount must be between 5%% and 15%%'; end if;
  if p_percent > public.wehouse_hotel_discount_ceiling() then
    raise exception 'WeHouse cannot discount more than the commission it earns (% percent)', public.wehouse_hotel_discount_ceiling();
  end if;
  if p_hotel_id is null and (p_room_id is not null or p_rate_plan_id is not null) then raise exception 'Choose a hotel first'; end if;

  if p_ends_on is not null and (not isfinite(p_ends_on) or p_ends_on<current_date) then raise exception 'Choose today or a future discount end date';end if;
  perform pg_advisory_xact_lock(hashtextextended('funded-hotel:'||coalesce(p_hotel_id::text,'all')||':'||coalesce(p_room_id::text,'all')||':'||coalesce(p_rate_plan_id::text,'all'),0));
  select d.id into v_id from public.hotel_discounts d where d.funded_by='wehouse' and d.active
   and coalesce(d.hotel_id,0)=coalesce(p_hotel_id,0) and coalesce(d.room_id,0)=coalesce(p_room_id,0)
   and coalesce(d.rate_plan_id,0)=coalesce(p_rate_plan_id,0)
   and d.percent=p_percent and d.ends_on is not distinct from p_ends_on order by d.created_at desc limit 1;
  if v_id is not null then return v_id;end if;
  update public.hotel_discounts set active = false
  where funded_by = 'wehouse' and active and coalesce(hotel_id, 0) = coalesce(p_hotel_id, 0)
    and coalesce(room_id, 0) = coalesce(p_room_id, 0) and coalesce(rate_plan_id, 0) = coalesce(p_rate_plan_id, 0);
  insert into public.hotel_discounts(hotel_id, room_id, rate_plan_id, percent, ends_on, created_by, funded_by)
  values (p_hotel_id, p_room_id, p_rate_plan_id, p_percent, p_ends_on, v_actor.user_id, 'wehouse') returning id into v_id;
  return v_id;
end $function$;
commit;
