-- Private business records. These never debit a wallet or confirm a payment.
create table public.partner_pro_operating_costs(
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.profiles(user_id),
  request_key uuid not null,
  asset_kind text not null check(asset_kind in('home','hotel')),
  asset_id text not null,
  category text not null check(category in('cleaning','repairs','utilities','supplies','management','other')),
  title text not null check(length(title) between 3 and 180),
  amount_ngn numeric(14,2) not null check(amount_ngn>0 and amount_ngn<=999999999999.99),
  incurred_on date not null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  unique(owner_id,request_key)
);
create index partner_pro_operating_costs_month_idx on public.partner_pro_operating_costs(owner_id,incurred_on desc,id desc) where voided_at is null;
create index partner_pro_operating_costs_asset_idx on public.partner_pro_operating_costs(owner_id,asset_kind,asset_id,incurred_on desc,id desc) where voided_at is null;
alter table public.partner_pro_operating_costs enable row level security;
revoke all on public.partner_pro_operating_costs from public,anon,authenticated;
grant select on public.partner_pro_operating_costs to authenticated;
grant all on public.partner_pro_operating_costs to service_role;
-- Owners retain read access to their records if paid access ends. Paid writes
-- and report workflows are separately enforced by the commands below.
create policy partner_operating_costs_owner_read on public.partner_pro_operating_costs for select to authenticated
  using(owner_id=public.current_profile_user_id() and exists(select 1 from public.profiles p where p.user_id=owner_id
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)));

create function public._partner_operating_cost_actor()
returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a text;
begin
  select user_id into a from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if a is null or not public.current_actor_has_workspace('property_partner',null) or not public.partner_pro_is_active(a) then raise exception 'Active Property Partner Pro required'; end if;
  return a;
end $$;
revoke all on function public._partner_operating_cost_actor() from public,anon,authenticated;

create function public.record_my_partner_operating_cost(p_request_key uuid,p_kind text,p_asset_id text,p_category text,p_title text,p_amount_ngn numeric,p_incurred_on date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a text:=public._partner_operating_cost_actor(); c public.partner_pro_operating_costs;
begin
  if p_request_key is null or p_kind is null or p_kind not in('home','hotel') or not public.partner_pro_owns_asset(p_kind,p_asset_id) then raise exception 'Choose a property you own'; end if;
  if p_category is null or p_category not in('cleaning','repairs','utilities','supplies','management','other')
    or length(btrim(coalesce(p_title,''))) not between 3 and 180 or p_amount_ngn is null or p_amount_ngn<=0 or p_amount_ngn>999999999999.99
    or p_amount_ngn<>round(p_amount_ngn,2) or p_incurred_on is null or p_incurred_on>current_date or p_incurred_on<'2000-01-01'::date then raise exception 'Enter a category, description, positive NGN amount with at most two decimal places, and a valid cost date'; end if;
  perform pg_advisory_xact_lock(hashtextextended(a||':operating-cost:'||p_request_key::text,0));
  select * into c from public.partner_pro_operating_costs where owner_id=a and request_key=p_request_key;
  if found then
    if(c.asset_kind,c.asset_id,c.category,c.title,c.amount_ngn,c.incurred_on) is distinct from (p_kind,p_asset_id,p_category,btrim(p_title),p_amount_ngn,p_incurred_on) then raise exception 'This request reference belongs to different cost details'; end if;
    return to_jsonb(c);
  end if;
  insert into public.partner_pro_operating_costs(owner_id,request_key,asset_kind,asset_id,category,title,amount_ngn,incurred_on)
    values(a,p_request_key,p_kind,p_asset_id,p_category,btrim(p_title),p_amount_ngn,p_incurred_on) returning * into c;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id)
    values('PARTNER_OPERATING_COST_RECORDED','partner_pro_operating_costs',c.id::text,jsonb_build_object('asset_kind',p_kind,'asset_id',p_asset_id,'amount_ngn',p_amount_ngn)::text,a);
  return to_jsonb(c);
end $$;
revoke all on function public.record_my_partner_operating_cost(uuid,text,text,text,text,numeric,date) from public,anon;
grant execute on function public.record_my_partner_operating_cost(uuid,text,text,text,text,numeric,date) to authenticated;

create function public.void_my_partner_operating_cost(p_cost_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a text:=public._partner_operating_cost_actor(); c public.partner_pro_operating_costs;
begin
  if length(btrim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Explain why this cost record is being voided'; end if;
  select * into c from public.partner_pro_operating_costs where id=p_cost_id and owner_id=a for update;
  if c.id is null then raise exception 'Cost record is unavailable'; end if;
  if c.voided_at is not null then return to_jsonb(c); end if;
  update public.partner_pro_operating_costs set voided_at=now(),void_reason=btrim(p_reason) where id=c.id returning * into c;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id)
    values('PARTNER_OPERATING_COST_VOIDED','partner_pro_operating_costs',c.id::text,jsonb_build_object('reason',btrim(p_reason))::text,a);
  return to_jsonb(c);
end $$;
revoke all on function public.void_my_partner_operating_cost(uuid,text) from public,anon;
grant execute on function public.void_my_partner_operating_cost(uuid,text) to authenticated;

create function public.get_my_partner_operating_report(p_month date default current_date,p_kind text default null,p_asset_id text default null,p_before_on date default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a text:=public._partner_operating_cost_actor(); month_start date; month_end date; costs jsonb; total numeric;
  income numeric; mixed boolean; unattributed integer; next_on date; next_id uuid; cost_count integer;
begin
  if p_month is null or p_month<'2000-01-01'::date or p_month>current_date
    or (p_kind is null)<>(p_asset_id is null) or p_kind is not null and p_kind not in('home','hotel')
    or (p_before_on is null)<>(p_before_id is null) then raise exception 'Choose a valid reporting month, property and page'; end if;
  if p_kind is not null and not public.partner_pro_owns_asset(p_kind,p_asset_id) and not exists(
    select 1 from public.partner_pro_operating_costs where owner_id=a and asset_kind=p_kind and asset_id=p_asset_id
  ) then raise exception 'Property report is unavailable'; end if;
  month_start:=date_trunc('month',p_month)::date; month_end:=(month_start+interval '1 month')::date;
  select coalesce(sum(amount_ngn),0),count(*) into total,cost_count from public.partner_pro_operating_costs
    where owner_id=a and voided_at is null and incurred_on>=month_start and incurred_on<month_end
      and(p_kind is null or(asset_kind=p_kind and asset_id=p_asset_id));
  select coalesce(jsonb_agg(to_jsonb(c) order by c.incurred_on desc,c.id desc),'[]'::jsonb) into costs from(
    select * from public.partner_pro_operating_costs where owner_id=a and voided_at is null
      and incurred_on>=month_start and incurred_on<month_end and(p_kind is null or(asset_kind=p_kind and asset_id=p_asset_id))
      and(p_before_on is null or(incurred_on,id)<(p_before_on,p_before_id)) order by incurred_on desc,id desc limit 51
  ) c;
  if jsonb_array_length(costs)>50 then
    costs:=costs-50; next_on:=(costs->49->>'incurred_on')::date; next_id:=(costs->49->>'id')::uuid;
  end if;
  select coalesce(sum(e.net_amount) filter(where p.currency='NGN'),0),coalesce(bool_or(p.currency is distinct from 'NGN'),false),
    count(*) filter(where p.listing_id is null and p.hotel_booking_id is null)
  into income,mixed,unattributed from public.property_partner_earning_releases e
    join public.booking_payments p on p.id=e.payment_id
    left join public.hotel_bookings b on b.booking_id=p.hotel_booking_id
    where e.partner_id=a and e.status='available'
      and coalesce(e.released_at,e.created_at)>=(month_start::timestamp at time zone 'UTC')
      and coalesce(e.released_at,e.created_at)<(month_end::timestamp at time zone 'UTC')
      and(p_kind is null or p_kind='hotel' and b.hotel_id::text=p_asset_id
        or p_kind='home' and exists(select 1 from public.listings l where l.id::text=p_asset_id and p.listing_id in(l.id::text,l.listing_id)));
  return jsonb_build_object('month',month_start,'currency','NGN','reporting_timezone','UTC','costs',costs,'cost_count',cost_count,
    'recorded_costs_ngn',total,'released_income_ngn',case when mixed then null else income end,
    'recorded_margin_ngn',case when mixed then null else income-total end,'mixed_currency',mixed,'unattributed_earnings',unattributed,
    'next_before_on',next_on,'next_before_id',next_id);
end $$;
revoke all on function public.get_my_partner_operating_report(date,text,text,date,uuid) from public,anon;
grant execute on function public.get_my_partner_operating_report(date,text,text,date,uuid) to authenticated;
