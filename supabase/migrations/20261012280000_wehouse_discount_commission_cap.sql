-- WeHouse never discounts more than the Short Let commission it earns.
create or replace function public.wehouse_discount_ceiling()
returns numeric language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select least(15,greatest(0,coalesce(min((p.value->>'percent')::numeric),0)))
  from public.creator_policy_versions p
  where p.policy_key in ('commission_short_let','commission_short_let_wehouse_managed')
    and p.scope_type='global' and p.scope_key='*' and p.status='active'
    and p.effective_from<=now() and (p.effective_until is null or p.effective_until>now()) $$;

create or replace function public.listing_discount_percent(p_listing_id uuid, p_on date default current_date)
returns numeric language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select least(50,
    coalesce(sum(d.percent) filter (where d.funded_by='host'),0)
    + least(coalesce(sum(d.percent) filter (where d.funded_by='wehouse'),0),public.wehouse_discount_ceiling()))
  from public.listing_discounts d
  join public.listings l on l.id=p_listing_id
  where d.active and d.starts_on<=p_on and (d.ends_on is null or d.ends_on>=p_on)
    and (d.listing_id=l.id or d.state_key=public.wehouse_state_key(l.state)) $$;

create or replace function public.creator_set_wehouse_discount(p_listing_id uuid,p_state text,p_percent numeric,p_ends_on date default null)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles; v_id uuid; v_state text:=nullif(public.wehouse_state_key(p_state),'');
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'creator' then raise exception 'Only the Creator can set a WeHouse-funded discount'; end if;
  if (p_listing_id is null)=(v_state is null) then raise exception 'Choose one property or one state'; end if;
  if p_percent is null or p_percent<5 or p_percent>15 then raise exception 'A WeHouse-funded discount must be between 5%% and 15%%'; end if;
  if p_percent>public.wehouse_discount_ceiling() then raise exception 'WeHouse cannot discount more than the commission it earns (% percent)',public.wehouse_discount_ceiling(); end if;
  update public.listing_discounts set active=false where funded_by='wehouse' and active
    and ((p_listing_id is not null and listing_id=p_listing_id) or (v_state is not null and state_key=v_state));
  insert into public.listing_discounts(listing_id,state_key,funded_by,percent,ends_on,created_by)
  values(p_listing_id,v_state,'wehouse',p_percent,p_ends_on,v_actor.user_id) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.wehouse_discount_ceiling() from public;
grant execute on function public.wehouse_discount_ceiling() to authenticated,service_role;
grant execute on function public.listing_discount_percent(uuid,date) to anon,authenticated,service_role;
grant execute on function public.creator_set_wehouse_discount(uuid,text,numeric,date) to authenticated,service_role;
