-- Property Partner Pro is an optional prepaid business package. A normal
-- Property Partner can list, manage bookings and receive basic receipts free.
begin;

alter table public.booking_payments drop constraint if exists booking_payments_purpose_check;
alter table public.booking_payments add constraint booking_payments_purpose_check
  check (purpose=any(array[
    'apartment_reservation','apartment_rent','worker_booking','hotel_reservation',
    'hotel_booking','rent_plan_contribution','worker_verification',
    'worker_pro_subscription','shared_housing_share','sponsored_campaign',
    'partner_pro_access','other'
  ]::text[]));

insert into public.platform_settings(key,value,category,label,description,data_type,editable,is_active)
values
  ('partner_pro_monthly_price_ngn','0','partner_pro','Partner Pro monthly web price','Prepaid one-month access; no automatic renewal.','number',true,true),
  ('partner_pro_yearly_price_ngn','0','partner_pro','Partner Pro yearly web price','Prepaid one-year access; no automatic renewal.','number',true,true),
  ('partner_pro_terms_version','','partner_pro','Partner Pro terms version','Version accepted before purchase.','text',true,true),
  ('partner_pro_terms_content','','partner_pro','Partner Pro terms','Explain access, expiry, renewal and refunds.','text',true,true),
  ('partner_pro_sales_enabled','false','partner_pro','Partner Pro web sales','Creator control for new purchases.','boolean',true,true)
on conflict(key) do nothing;

create table public.partner_pro_entitlements (
  partner_id text primary key references public.profiles(user_id) on delete cascade,
  current_period_end timestamptz not null,
  last_payment_id uuid not null references public.booking_payments(id),
  updated_at timestamptz not null default now()
);
create table public.partner_pro_terms_acceptances (
  partner_id text not null references public.profiles(user_id) on delete cascade,
  terms_version text not null,
  terms_sha256 text not null,
  accepted_at timestamptz not null default now(),
  primary key(partner_id,terms_version,terms_sha256)
);
alter table public.partner_pro_entitlements enable row level security;
alter table public.partner_pro_terms_acceptances enable row level security;
revoke all on public.partner_pro_entitlements,public.partner_pro_terms_acceptances from public,anon,authenticated;
grant all on public.partner_pro_entitlements,public.partner_pro_terms_acceptances to service_role;

create or replace function public.partner_pro_is_active(p_partner_id text)
returns boolean language sql stable security definer set search_path='pg_catalog','public' as $$
  select exists(select 1 from public.partner_pro_entitlements e
    where e.partner_id=p_partner_id and e.current_period_end>now())
$$;
revoke all on function public.partner_pro_is_active(text) from public,anon,authenticated;
grant execute on function public.partner_pro_is_active(text) to service_role;

create or replace function public.creator_set_partner_pro_setting(p_key text,p_value text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_value text:=btrim(coalesce(p_value,'')); v_month numeric; v_year numeric;
  v_version text; v_terms text;
begin
  if not public.current_actor_has_workspace('creator',null) then raise exception 'Creator access required'; end if;
  if p_key not in ('partner_pro_monthly_price_ngn','partner_pro_yearly_price_ngn',
    'partner_pro_terms_version','partner_pro_terms_content','partner_pro_sales_enabled') then
    raise exception 'Setting is not part of Property Partner Pro'; end if;
  if p_key in ('partner_pro_monthly_price_ngn','partner_pro_yearly_price_ngn') then
    if v_value !~ '^[0-9]+(\.[0-9]{1,2})?$' or v_value::numeric>10000000 then
      raise exception 'Price must be between 0 and 10,000,000 NGN'; end if;
  elsif p_key='partner_pro_sales_enabled' then
    if v_value not in ('true','false') then raise exception 'Invalid sales setting'; end if;
    if v_value='true' then
      select coalesce(nullif(value,'')::numeric,0) into v_month from public.platform_settings where key='partner_pro_monthly_price_ngn';
      select coalesce(nullif(value,'')::numeric,0) into v_year from public.platform_settings where key='partner_pro_yearly_price_ngn';
      select value into v_version from public.platform_settings where key='partner_pro_terms_version';
      select value into v_terms from public.platform_settings where key='partner_pro_terms_content';
      if coalesce(v_month,0)<=0 and coalesce(v_year,0)<=0 then raise exception 'Set at least one price'; end if;
      if length(btrim(coalesce(v_version,'')))<1 or length(btrim(coalesce(v_terms,'')))<100 then
        raise exception 'Publish complete Partner Pro terms before opening sales'; end if;
    end if;
  elsif p_key='partner_pro_terms_version' and length(v_value)>100 then
    raise exception 'Terms version is too long';
  elsif p_key='partner_pro_terms_content' and length(v_value)>50000 then
    raise exception 'Terms are too long';
  end if;
  if p_key in ('partner_pro_monthly_price_ngn','partner_pro_yearly_price_ngn',
    'partner_pro_terms_version','partner_pro_terms_content') and exists(
      select 1 from public.platform_settings where key=p_key and value is distinct from v_value) then
    update public.platform_settings set value='false',updated_at=now()
      where key='partner_pro_sales_enabled';
  end if;
  update public.platform_settings set value=v_value,updated_at=now() where key=p_key;
  if not found then raise exception 'Partner Pro setting is missing'; end if;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(public.current_profile_user_id(),'partner_pro_setting','platform_settings',p_key,
    jsonb_build_object('updated',true,'sales_enabled',
      (select value from public.platform_settings where key='partner_pro_sales_enabled'))::text,now());
  return true;
end $$;
revoke all on function public.creator_set_partner_pro_setting(text,text) from public,anon;
grant execute on function public.creator_set_partner_pro_setting(text,text) to authenticated;

create or replace function public.get_my_partner_pro()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id(); v_price_month numeric:=0;
  v_price_year numeric:=0; v_sales boolean:=false; v_terms text:='';
  v_version text:=''; v_sha text; v_end timestamptz; v_accepted boolean:=false;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required'; end if;
  select coalesce(nullif(value,'')::numeric,0) into v_price_month from public.platform_settings where key='partner_pro_monthly_price_ngn' and is_active=true;
  select coalesce(nullif(value,'')::numeric,0) into v_price_year from public.platform_settings where key='partner_pro_yearly_price_ngn' and is_active=true;
  select lower(value) in ('true','1','yes','on') into v_sales from public.platform_settings where key='partner_pro_sales_enabled' and is_active=true;
  select coalesce(value,'') into v_version from public.platform_settings where key='partner_pro_terms_version' and is_active=true;
  select coalesce(value,'') into v_terms from public.platform_settings where key='partner_pro_terms_content' and is_active=true;
  select current_period_end into v_end from public.partner_pro_entitlements where partner_id=v_actor;
  v_sha:=encode(extensions.digest(convert_to(coalesce(v_terms,''),'UTF8'),'sha256'),'hex');
  select exists(select 1 from public.partner_pro_terms_acceptances where partner_id=v_actor
    and terms_version=v_version and terms_sha256=v_sha) into v_accepted;
  return jsonb_build_object('active',coalesce(v_end>now(),false),'current_period_end',v_end,
    'sales_enabled',coalesce(v_sales,false),'monthly_price_ngn',coalesce(v_price_month,0),
    'yearly_price_ngn',coalesce(v_price_year,0),'terms_version',coalesce(v_version,''),
    'terms_content',coalesce(v_terms,''),'terms_accepted',v_accepted,
    'auto_renews',false);
end $$;
revoke all on function public.get_my_partner_pro() from public,anon;
grant execute on function public.get_my_partner_pro() to authenticated;

create or replace function public.accept_my_partner_pro_terms()
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id(); v_version text; v_terms text;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required'; end if;
  select value into v_version from public.platform_settings where key='partner_pro_terms_version' and is_active=true;
  select value into v_terms from public.platform_settings where key='partner_pro_terms_content' and is_active=true;
  if length(btrim(coalesce(v_version,'')))<1 or length(btrim(coalesce(v_terms,'')))<100 then
    raise exception 'Partner Pro terms are unavailable'; end if;
  insert into public.partner_pro_terms_acceptances(partner_id,terms_version,terms_sha256)
  values(v_actor,v_version,encode(extensions.digest(convert_to(v_terms,'UTF8'),'sha256'),'hex'))
  on conflict do nothing;
  return true;
end $$;
revoke all on function public.accept_my_partner_pro_terms() from public,anon;
grant execute on function public.accept_my_partner_pro_terms() to authenticated;

create unique index booking_payments_one_pending_partner_pro on public.booking_payments(user_id,purpose)
  where status='pending' and purpose='partner_pro_access';
create or replace function public.create_my_partner_pro_payment(p_billing_period text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id(); v_price numeric; v_sales boolean;
  v_period text:=lower(btrim(coalesce(p_billing_period,''))); v_version text;
  v_terms text; v_sha text; v_payment public.booking_payments; v_reference text;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required'; end if;
  if v_period not in ('monthly','yearly') then raise exception 'Choose monthly or yearly access'; end if;
  perform 1 from public.profiles where user_id=v_actor and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) for update;
  if not found then raise exception 'Account is not active'; end if;
  select lower(value) in ('true','1','yes','on') into v_sales from public.platform_settings where key='partner_pro_sales_enabled' and is_active=true;
  select coalesce(nullif(value,'')::numeric,0) into v_price from public.platform_settings
    where key=case when v_period='yearly' then 'partner_pro_yearly_price_ngn' else 'partner_pro_monthly_price_ngn' end and is_active=true;
  select value into v_version from public.platform_settings where key='partner_pro_terms_version' and is_active=true;
  select value into v_terms from public.platform_settings where key='partner_pro_terms_content' and is_active=true;
  if not coalesce(v_sales,false) or coalesce(v_price,0)<=0 then raise exception 'Partner Pro purchase is not available'; end if;
  if length(btrim(coalesce(v_terms,'')))<100 or length(btrim(coalesce(v_version,'')))<1 then raise exception 'Partner Pro terms are unavailable'; end if;
  v_sha:=encode(extensions.digest(convert_to(v_terms,'UTF8'),'sha256'),'hex');
  if not exists(select 1 from public.partner_pro_terms_acceptances where partner_id=v_actor
    and terms_version=v_version and terms_sha256=v_sha) then raise exception 'Accept the current terms first'; end if;
  update public.booking_payments set status='expired',updated_at=now()
    where user_id=v_actor and purpose='partner_pro_access' and status='pending'
      and (created_at<now()-interval '30 minutes' or amount_total is distinct from v_price
        or metadata->>'billing_period' is distinct from v_period or metadata->>'terms_sha256' is distinct from v_sha);
  select * into v_payment from public.booking_payments where user_id=v_actor
    and purpose='partner_pro_access' and status='pending' for update;
  if v_payment.id is not null then return jsonb_build_object('success',true,'reference',v_payment.paystack_reference,'existing',true); end if;
  v_reference:='WHPP-'||gen_random_uuid()::text;
  insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,
    type,booking_type,amount,amount_total,net_amount,amount_commission,currency,status,purpose,payment_method,metadata)
  values(v_reference,v_reference,v_actor,v_actor,'partner_pro_access','partner_pro_access',
    v_price,v_price,v_price,0,'NGN','pending','partner_pro_access','paystack',
    jsonb_build_object('billing_period',v_period,'terms_version',v_version,
      'terms_sha256',v_sha,'price_snapshot_ngn',v_price)) returning * into v_payment;
  return jsonb_build_object('success',true,'reference',v_reference,'existing',false);
end $$;
revoke all on function public.create_my_partner_pro_payment(text) from public,anon;
grant execute on function public.create_my_partner_pro_payment(text) to authenticated;

-- Only the service role calls this after checking Paystack's signed event or API.
create or replace function public.confirm_partner_pro_paystack_charge(
  p_reference text,p_transaction_id text,p_amount_minor bigint,p_environment text,p_source text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_payment public.booking_payments; v_end timestamptz; v_period text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'Service role required'; end if;
  if p_source not in ('webhook','edge_function') or p_environment not in ('test','live')
    or nullif(btrim(coalesce(p_transaction_id,'')),'') is null then raise exception 'Invalid provider receipt'; end if;
  select * into v_payment from public.booking_payments where paystack_reference=p_reference
    and purpose='partner_pro_access' for update;
  if v_payment.id is null then raise exception 'Partner Pro payment not found'; end if;
  if v_payment.status in ('paid','completed') then
    if v_payment.paystack_transaction_id is distinct from p_transaction_id then raise exception 'Transaction conflict'; end if;
    return jsonb_build_object('success',true,'already_processed',true);
  end if;
  if v_payment.currency<>'NGN' or round(v_payment.amount_total*100)<>p_amount_minor
    or v_payment.metadata->>'paystack_environment' is distinct from p_environment then
    raise exception 'Amount, currency or environment mismatch'; end if;
  if exists(select 1 from public.booking_payments where paystack_transaction_id=p_transaction_id and id<>v_payment.id) then
    raise exception 'Transaction belongs to another payment'; end if;
  if v_payment.status='review_required' then
    if v_payment.paystack_transaction_id is distinct from p_transaction_id then raise exception 'Transaction conflict'; end if;
    return jsonb_build_object('success',false,'requires_review',true,'error','This charged order is under Finance review');
  end if;
  if v_payment.status<>'pending' then
    update public.booking_payments set status='review_required',paystack_transaction_id=p_transaction_id,
      verified_amount=amount_total,verified_at=now(),verification_source=p_source,
      webhook_processed=true,updated_at=now() where id=v_payment.id;
    return jsonb_build_object('success',false,'requires_review',true,
      'error','This charged checkout expired; Finance will review it');
  end if;
  v_period:=v_payment.metadata->>'billing_period';
  if v_period not in ('monthly','yearly') then raise exception 'Invalid access period'; end if;
  perform 1 from public.profiles where user_id=v_payment.user_id for update;
  if not found then raise exception 'Partner account missing'; end if;
  select current_period_end into v_end from public.partner_pro_entitlements where partner_id=v_payment.user_id for update;
  v_end:=greatest(coalesce(v_end,now()),now())+case when v_period='yearly' then interval '1 year' else interval '1 month' end;
  update public.booking_payments set status='paid',paystack_transaction_id=p_transaction_id,
    verified_amount=amount_total,verified_at=now(),verification_source=p_source,
    paid_at=now(),webhook_processed=true,updated_at=now() where id=v_payment.id;
  insert into public.partner_pro_entitlements(partner_id,current_period_end,last_payment_id)
  values(v_payment.user_id,v_end,v_payment.id)
  on conflict(partner_id) do update set current_period_end=excluded.current_period_end,
    last_payment_id=excluded.last_payment_id,updated_at=now();
  return jsonb_build_object('success',true,'current_period_end',v_end);
end $$;
revoke all on function public.confirm_partner_pro_paystack_charge(text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.confirm_partner_pro_paystack_charge(text,text,bigint,text,text) to service_role;

-- A label is not an entitlement. Enforce it at the database functions used by
-- the Partner Pro workspace, including reads and task writes.
create or replace function public.get_my_partner_pro_overview()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
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
    select id,asset_kind,asset_id,title,due_on,status,created_at from public.partner_pro_tasks
    where owner_id=v_actor and public.partner_pro_owns_asset(asset_kind,asset_id)
    order by due_on nulls last,created_at desc limit 200
  ) t;
  return jsonb_build_object('assets',v_assets,'stays',v_stays,'income',v_income,
    'tasks',v_tasks,'stays_limited',jsonb_array_length(v_stays)=1000,
    'tasks_limited',jsonb_array_length(v_tasks)=200);
end $$;

create or replace function public.save_my_partner_pro_task(
  p_kind text,p_asset_id text,p_title text default null,p_due_on date default null,
  p_task_id uuid default null,p_done boolean default false
) returns uuid language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id(); v_task public.partner_pro_tasks; v_id uuid;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null)
    or not public.partner_pro_is_active(v_actor) then raise exception 'Active Property Partner Pro required'; end if;
  if p_task_id is not null then
    select * into v_task from public.partner_pro_tasks where id=p_task_id and owner_id=v_actor for update;
    if not found or v_task.asset_kind<>p_kind or v_task.asset_id<>p_asset_id
      or not public.partner_pro_owns_asset(v_task.asset_kind,v_task.asset_id) then raise exception 'Task unavailable'; end if;
    update public.partner_pro_tasks set status=case when p_done then 'done' else 'open' end,
      completed_at=case when p_done then now() else null end where id=p_task_id;
    return p_task_id;
  end if;
  if not public.partner_pro_owns_asset(p_kind,p_asset_id) then raise exception 'Property unavailable'; end if;
  if length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'Task title must be 3 to 160 characters'; end if;
  if p_due_on is not null and (p_due_on<current_date-365 or p_due_on>current_date+730)
    then raise exception 'Task date outside supported range'; end if;
  insert into public.partner_pro_tasks(owner_id,asset_kind,asset_id,title,due_on)
  values(v_actor,p_kind,p_asset_id,btrim(p_title),p_due_on) returning id into v_id;
  return v_id;
end $$;

commit;
