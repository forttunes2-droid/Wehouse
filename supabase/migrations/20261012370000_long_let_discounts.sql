-- Long Let discounts use the same rules as Short Let and apply to Year 1 rent only (owner decision).
-- The partner is paid the host-discounted Year 1 rent minus commission. WeHouse's share of the discount
-- comes out of WeHouse's own commission, capped by the Long Let commission, never out of the partner's payout.
-- Later years stay at the full listed rent (annual_rent_snapshot is not changed).
alter table public.reservations
  add column if not exists year_one_partner_rent_snapshot numeric(12,2),
  add column if not exists year_one_discount_percent_snapshot numeric(5,2) not null default 0,
  add column if not exists year_one_wehouse_discount_percent_snapshot numeric(5,2) not null default 0;

-- WeHouse can only discount up to the commission it earns on that kind of stay.
create or replace function public.wehouse_discount_ceiling_for(p_sub_type text)
returns numeric language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select least(50,greatest(0,coalesce(min((p.value->>'percent')::numeric),0)))
  from public.creator_policy_versions p
  where p.policy_key = any(case when p_sub_type='long_stay'
      then array['commission_long_let','commission_long_let_wehouse_managed']
      else array['commission_short_let','commission_short_let_wehouse_managed'] end)
    and p.scope_type='global' and p.scope_key='*' and p.status='active'
    and p.effective_from<=now() and (p.effective_until is null or p.effective_until>now()) $$;
revoke all on function public.wehouse_discount_ceiling_for(text) from public,anon,authenticated;
grant execute on function public.wehouse_discount_ceiling_for(text) to service_role;

create or replace function public.short_let_discount_breakdown(p_listing_id uuid,p_on date,p_host_side_percent numeric default 0)
returns table(partner_percent numeric,wehouse_percent numeric)
language sql stable security definer set search_path to 'pg_catalog','public' as $$
  with raw as (
    select least(50,coalesce(p_host_side_percent,0)+coalesce(sum(d.percent) filter (where d.funded_by='host'),0)) as partner,
           coalesce(sum(d.percent) filter (where d.funded_by='wehouse'),0) as wehouse,
           public.wehouse_discount_ceiling_for(max(l.sub_type)) as ceiling
    from public.listing_discounts d
    join public.listings l on l.id=p_listing_id
    where d.active and d.starts_on<=p_on and (d.ends_on is null or d.ends_on>=p_on)
      and (d.listing_id=l.id or d.state_key=public.wehouse_state_key(l.state))
  )
  select partner,
    greatest(0,least(wehouse,ceiling,50-partner,floor((100-partner)*ceiling)/100))
  from raw $$;
revoke all on function public.short_let_discount_breakdown(uuid,date,numeric) from public,anon,authenticated;
grant execute on function public.short_let_discount_breakdown(uuid,date,numeric) to service_role;

-- Year 1 price: what the renter pays, what the partner's rent is after only their own discount, and the WeHouse share.
create or replace function public.long_let_year_one_quote(p_listing_id uuid,p_annual numeric,p_on date default current_date)
returns table(payable numeric,partner_rent numeric,discount_percent numeric,wehouse_percent numeric)
language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select round(p_annual*(1-(b.partner_percent+b.wehouse_percent)/100),2),
         round(p_annual*(1-b.partner_percent/100),2),
         b.partner_percent+b.wehouse_percent,
         b.wehouse_percent
  from public.short_let_discount_breakdown(p_listing_id,p_on,0) b $$;
revoke all on function public.long_let_year_one_quote(uuid,numeric,date) from public,anon,authenticated;
grant execute on function public.long_let_year_one_quote(uuid,numeric,date) to service_role;

-- Apply the quote inside the two existing Long Let price functions without copying them.
do $patch$
declare
  v_def text;
  v_new text;
begin
  v_def:=pg_get_functiondef('public.update_my_reservation_plan(text,integer)'::regprocedure);
  v_new:=replace(v_def,'v_total:=round(v_annual*p_plan_years,2);',
    'select q.payable into v_upfront from public.long_let_year_one_quote(v_listing.id,v_annual) q; v_total:=round(v_upfront+v_annual*greatest(p_plan_years-1,0),2);');
  v_new:=replace(v_new,'v_upfront:=v_annual; v_balance:=','v_balance:=');
  if v_new=v_def or position('long_let_year_one_quote' in v_new)=0 or position('v_upfront:=v_annual' in v_new)>0 then
    raise exception 'update_my_reservation_plan did not match the expected definition';
  end if;
  execute v_new;

  v_def:=pg_get_functiondef('public.create_apartment_rent_payment(text)'::regprocedure);
  v_new:=replace(v_def,'v_annual numeric; v_total numeric;','v_annual numeric; v_partner numeric; v_disc numeric; v_wh numeric; v_total numeric;');
  v_new:=replace(v_new,'v_total:=round(v_annual*v_years,2); v_upfront:=v_annual; v_balance:=',
    'select q.payable,q.partner_rent,q.discount_percent,q.wehouse_percent into v_upfront,v_partner,v_disc,v_wh from public.long_let_year_one_quote(v_listing.id,v_annual) q; v_total:=round(v_upfront+v_annual*greatest(v_years-1,0),2); v_balance:=');
  v_new:=replace(v_new,'upfront_rent_required=v_upfront,installment_balance=v_balance,',
    'upfront_rent_required=v_upfront,year_one_partner_rent_snapshot=v_partner,year_one_discount_percent_snapshot=v_disc,year_one_wehouse_discount_percent_snapshot=v_wh,installment_balance=v_balance,');
  v_new:=replace(v_new,'''eligible_partner_amount'',v_upfront','''eligible_partner_amount'',v_partner');
  if v_new=v_def or position('long_let_year_one_quote' in v_new)=0 or position('year_one_partner_rent_snapshot' in v_new)=0
     or position('''eligible_partner_amount'',v_partner' in v_new)=0 or position('v_upfront:=v_annual' in v_new)>0 then
    raise exception 'create_apartment_rent_payment did not match the expected definition';
  end if;
  execute v_new;

  -- The settled Year 1 amount is the price the renter was quoted, not the full listed rent.
  v_def:=pg_get_functiondef('public.fulfill_apartment_rent_payment()'::regprocedure);
  v_new:=replace(v_def,'round(coalesce(v_res.annual_rent_snapshot,v_res.upfront_rent_required,0),2)',
    'round(coalesce(v_res.upfront_rent_required,v_res.annual_rent_snapshot,0),2)');
  if v_new=v_def then raise exception 'fulfill_apartment_rent_payment did not match the expected definition'; end if;
  execute v_new;
end
$patch$;

-- Partner payout protection for Long Let Year 1 (same rule as Short Let).
create or replace function public.apply_long_let_partner_payout()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare r public.reservations; s record;
begin
  if new.subject_type is distinct from 'long_let_year_one' then return new; end if;
  select * into r from public.reservations where id::text=new.subject_id;
  if r.id is null or coalesce(r.year_one_wehouse_discount_percent_snapshot,0)<=0
     or r.year_one_partner_rent_snapshot is null or r.year_one_partner_rent_snapshot<=new.amount_total then
    return new;
  end if;
  select * into s from public.short_let_payout_split(new.amount_total,r.year_one_partner_rent_snapshot,new.commission_rate);
  new.amount_commission:=s.amount_commission;
  new.amount_payee:=s.amount_payee;
  return new;
end $$;
drop trigger if exists payment_protection_long_let_partner_payout on public.payment_protection_transactions;
create trigger payment_protection_long_let_partner_payout before insert on public.payment_protection_transactions
  for each row execute function public.apply_long_let_partner_payout();
revoke all on function public.apply_long_let_partner_payout() from public,anon,authenticated;
