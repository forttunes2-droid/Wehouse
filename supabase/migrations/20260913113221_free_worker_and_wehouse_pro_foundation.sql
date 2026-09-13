begin;

-- Worker activation and professional review are free. Keep the former settings
-- as inactive history so old deployments fail closed instead of charging.
insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
) values
  ('worker_verification_fee_enabled','false','worker','Worker onboarding fee retired','Worker activation, verification and professional review are free.','boolean',false,true,now(),now()),
  ('worker_verification_fee','0','worker','Retired Worker onboarding fee','Historical setting only. WeHouse must not charge for Worker activation or verification.','number',false,false,now(),now()),
  ('worker_marketplace_launch_enabled','false','worker_legal','Worker marketplace launch approved','Enable only after the required Nigerian labour/recruiter classification and launch approvals are recorded.','boolean',true,true,now(),now()),
  ('worker_identity_checks_enabled','false','worker_legal','Private face checks approved','Enable only after lawful-basis, DPIA, processor, cross-border, retention, security, manual-alternative and appeal gates are approved.','boolean',true,true,now(),now()),
  ('worker_pro_monthly_price_ngn','0','worker_pro','Web monthly price (NGN)','Monthly web price. Native apps always display the price returned by Apple or Google for the configured product.','number',true,true,now(),now()),
  ('worker_pro_sales_enabled','false','worker_pro','Enable WeHouse Pro web sales','Enable only after subscription terms, Paystack monthly plan, webhook and cancellation route are ready. Native sales use separate store-readiness gates.','boolean',true,true,now(),now()),
  ('worker_pro_apple_product_id','','worker_pro','Apple monthly product ID','Monthly auto-renewable subscription product configured in App Store Connect.','text',true,true,now(),now()),
  ('worker_pro_google_product_id','','worker_pro','Google Play monthly product ID','Monthly subscription product configured in Google Play Console.','text',true,true,now(),now()),
  ('worker_pro_web_paystack_plan_code','','worker_pro','Paystack monthly plan code','Optional monthly web subscription plan. Physical jobs and stays continue to use their own Paystack payment flows.','text',true,true,now(),now()),
  ('worker_pro_terms_version','','worker_pro','Pro terms version','Published subscription terms accepted by Workers before purchase.','text',true,true,now(),now()),
  ('worker_pro_terms_content','','worker_pro','Pro subscription terms','Plain-language monthly price, renewal, cancellation, feature and refund terms shown before purchase.','text',true,true,now(),now()),
  ('worker_pro_support_response_hours','24','worker_pro','Pro support response target (hours)','Published target for priority platform support; this is not a job-placement advantage.','number',true,true,now(),now())
on conflict (key) do update set
  value=case
    when excluded.key='worker_verification_fee_enabled' then 'false'
    when excluded.key='worker_verification_fee' then '0'
    else public.platform_settings.value
  end,
  label=excluded.label,
  description=excluded.description,
  data_type=excluded.data_type,
  editable=excluded.editable,
  is_active=excluded.is_active,
  updated_at=now();

create or replace function public._guard_worker_profile_state()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.role<>'worker' then return new; end if;
  if new.worker_status='approved_for_verification' then
    new.worker_status:='profile_under_review';
  elsif new.worker_status='approved' then
    new.worker_status:='pending';
  elsif new.worker_status='declined' then
    new.worker_status:='rejected';
  end if;
  new.worker_verified:=new.worker_status='verified';
  if new.worker_status<>'verified'
     or coalesce(new.deleted,false)
     or coalesce(new.suspended,false)
     or coalesce(new.banned,false) then
    new.available:=false;
  end if;
  return new;
end;
$$;

revoke all on function public._guard_worker_profile_state() from public,anon,authenticated;

create or replace function public.save_my_worker_professional_evidence(
  p_certificate_path text,
  p_video_path text
) returns uuid
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_identity_required boolean:=false;
  v_id uuid;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and role='worker'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_profile is null then raise exception 'Active Worker account required'; end if;
  if v_profile.worker_status='verified' then raise exception 'Live Worker evidence changes require a new review process'; end if;
  if not public.worker_professional_profile_ready(v_profile.user_id) then
    raise exception 'Complete your professional profile and service coverage first';
  end if;
  select coalesce(lower(btrim(value)) in ('true','1','yes','on'),false)
    into v_identity_required
  from public.platform_settings
  where key='worker_identity_checks_enabled' and coalesce(is_active,true)
  limit 1;
  if coalesce(v_identity_required,false) and not public.worker_identity_is_current(v_profile.user_id) then
    raise exception 'Complete the approved private identity check first';
  end if;
  if nullif(btrim(coalesce(p_video_path,'')),'') is null then raise exception 'Skill demonstration video is required'; end if;
  if split_part(p_video_path,'/',1)<>v_profile.user_id then raise exception 'Invalid Worker video path'; end if;
  if nullif(btrim(coalesce(p_certificate_path,'')),'') is not null
     and split_part(p_certificate_path,'/',1)<>v_profile.user_id then
    raise exception 'Invalid Worker certificate path';
  end if;

  insert into public.worker_verifications(
    worker_id,certificate_path,verification_video_url,status,submitted_at,created_at,updated_at
  ) values(
    v_profile.user_id,nullif(btrim(coalesce(p_certificate_path,'')),''),btrim(p_video_path),
    'evidence_ready',null,now(),now()
  )
  on conflict(worker_id) do update set
    certificate_path=excluded.certificate_path,
    verification_video_url=excluded.verification_video_url,
    status='evidence_ready',
    submitted_at=null,
    reviewed_by=null,
    review_notes=null,
    reviewed_at=null,
    updated_at=now()
  returning id into v_id;

  update public.profiles
  set worker_status='pending',worker_verified=false,available=false,
      worker_cert_url=nullif(btrim(coalesce(p_certificate_path,'')),''),
      worker_video_url=btrim(p_video_path),updated_at=now()
  where user_id=v_profile.user_id;
  return v_id;
end;
$$;

create or replace function public.submit_my_worker_verification()
returns void
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_identity_required boolean:=false;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and role='worker'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_profile is null then raise exception 'Active Worker account required'; end if;
  if not public.worker_professional_profile_ready(v_profile.user_id) then
    raise exception 'Complete your professional profile and service coverage first';
  end if;
  select coalesce(lower(btrim(value)) in ('true','1','yes','on'),false)
    into v_identity_required
  from public.platform_settings
  where key='worker_identity_checks_enabled' and coalesce(is_active,true)
  limit 1;
  if coalesce(v_identity_required,false) and not public.worker_identity_is_current(v_profile.user_id) then
    raise exception 'Complete the approved private identity check before submission';
  end if;
  select * into v_ver from public.worker_verifications
  where worker_id=v_profile.user_id limit 1;
  if v_ver is null or nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is null then
    raise exception 'A work demonstration video is required before review';
  end if;
  update public.worker_verifications
  set status='profile_under_review',submitted_at=now(),updated_at=now()
  where id=v_ver.id;
  update public.profiles
  set worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now()
  where user_id=v_profile.user_id;
end;
$$;

-- Retire the former fee bootstrap. Existing payment rows remain immutable
-- financial history, but no new Worker verification payment can be created.
create or replace function public.create_worker_verification_payment()
returns jsonb
language sql
security definer
set search_path='pg_catalog','public'
as $$
  select jsonb_build_object(
    'success',false,
    'fee_waived',true,
    'retired',true,
    'error','Worker onboarding and verification are free; no payment is required'
  );
$$;
revoke all on function public.create_worker_verification_payment() from public,anon,authenticated;
grant execute on function public.create_worker_verification_payment() to service_role;

-- WeHouse Pro is paid business software. It is deliberately separate from
-- Worker review, trust, marketplace eligibility, ranking and job access.
create table if not exists public.worker_pro_subscriptions(
  id uuid primary key default gen_random_uuid(),
  worker_id text not null unique references public.profiles(user_id) on delete restrict,
  provider text not null check(provider in ('apple','google','paystack')),
  product_id text not null,
  provider_subscription_id text,
  status text not null check(status in ('pending','active','grace_period','paused','cancelled','expired','revoked')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  auto_renews boolean not null default true,
  price_amount numeric(12,2) not null check(price_amount>=0),
  currency text not null default 'NGN' check(currency~'^[A-Z]{3}$'),
  environment text not null default 'production' check(environment in ('sandbox','production')),
  last_verified_at timestamptz not null,
  last_provider_event_at timestamptz not null,
  last_provider_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(current_period_end is null or current_period_start is null or current_period_end>current_period_start)
);

create unique index if not exists worker_pro_provider_subscription_unique
  on public.worker_pro_subscriptions(provider,provider_subscription_id)
  where provider_subscription_id is not null;
create index if not exists worker_pro_entitlement_lookup_idx
  on public.worker_pro_subscriptions(worker_id,status,current_period_end desc);

create table if not exists public.worker_pro_subscription_events(
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.worker_pro_subscriptions(id) on delete restrict,
  worker_id text not null references public.profiles(user_id) on delete restrict,
  provider text not null check(provider in ('apple','google','paystack')),
  provider_event_id text not null,
  event_type text not null,
  event_time timestamptz not null,
  received_at timestamptz not null default now(),
  valid_until timestamptz,
  payload_sha256 text not null check(payload_sha256~'^[a-f0-9]{64}$'),
  result text not null check(result in ('accepted','ignored','rejected')),
  metadata jsonb not null default '{}'::jsonb,
  unique(provider,provider_event_id)
);
create index if not exists worker_pro_events_worker_time_idx
  on public.worker_pro_subscription_events(worker_id,event_time desc);

create table if not exists public.worker_pro_terms_acceptances(
  id uuid primary key default gen_random_uuid(),
  worker_id text not null references public.profiles(user_id) on delete restrict,
  terms_version text not null,
  terms_sha256 text not null check(terms_sha256~'^[a-f0-9]{64}$'),
  accepted_at timestamptz not null default now(),
  unique(worker_id,terms_version,terms_sha256)
);
create index if not exists worker_pro_terms_acceptance_worker_idx
  on public.worker_pro_terms_acceptances(worker_id,accepted_at desc);

alter table public.worker_pro_subscriptions enable row level security;
alter table public.worker_pro_subscription_events enable row level security;
alter table public.worker_pro_terms_acceptances enable row level security;

drop policy if exists worker_pro_subscription_owner_read on public.worker_pro_subscriptions;
drop policy if exists worker_pro_subscription_creator_read on public.worker_pro_subscriptions;
drop policy if exists worker_pro_subscription_read on public.worker_pro_subscriptions;
create policy worker_pro_subscription_read
on public.worker_pro_subscriptions for select to authenticated
using(worker_id=(select public.current_profile_user_id()) or (select public.is_current_creator()));
drop policy if exists worker_pro_events_creator_read on public.worker_pro_subscription_events;
create policy worker_pro_events_creator_read
on public.worker_pro_subscription_events for select to authenticated
using((select public.is_current_creator()));
drop policy if exists worker_pro_terms_acceptance_owner_read on public.worker_pro_terms_acceptances;
drop policy if exists worker_pro_terms_acceptance_creator_read on public.worker_pro_terms_acceptances;
drop policy if exists worker_pro_terms_acceptance_read on public.worker_pro_terms_acceptances;
create policy worker_pro_terms_acceptance_read
on public.worker_pro_terms_acceptances for select to authenticated
using(worker_id=(select public.current_profile_user_id()) or (select public.is_current_creator()));

revoke all on table public.worker_pro_subscriptions from public,anon,authenticated;
grant select on table public.worker_pro_subscriptions to authenticated;
grant all on table public.worker_pro_subscriptions to service_role;
revoke all on table public.worker_pro_subscription_events from public,anon,authenticated;
grant select on table public.worker_pro_subscription_events to authenticated;
grant all on table public.worker_pro_subscription_events to service_role;
revoke all on table public.worker_pro_terms_acceptances from public,anon,authenticated;
grant select on table public.worker_pro_terms_acceptances to authenticated;
grant all on table public.worker_pro_terms_acceptances to service_role;

create or replace function public.worker_pro_is_active(p_worker_id text)
returns boolean
language sql
stable
security definer
set search_path='pg_catalog','public'
as $$
  select exists(
    select 1 from public.worker_pro_subscriptions subscription
    where subscription.worker_id=p_worker_id
      and subscription.status in ('active','grace_period')
      and subscription.current_period_end>now()
  );
$$;
revoke all on function public.worker_pro_is_active(text) from public,anon;
grant execute on function public.worker_pro_is_active(text) to authenticated,service_role;

create or replace function public.get_my_worker_pro()
returns jsonb
language plpgsql
stable
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_worker_id text;
  v_subscription public.worker_pro_subscriptions;
  v_price numeric:=0;
  v_enabled boolean:=false;
  v_apple_product_id text:='';
  v_google_product_id text:='';
  v_web_plan_code text:='';
  v_terms_version text:='';
  v_terms_content text:='';
  v_terms_sha256 text:='';
  v_terms_accepted boolean:=false;
  v_support_hours integer:=24;
begin
  select user_id into v_worker_id from public.profiles
  where auth_id=(select auth.uid())::text
    and role='worker'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_worker_id is null then raise exception 'Active Worker account required'; end if;
  select * into v_subscription from public.worker_pro_subscriptions
  where worker_id=v_worker_id limit 1;
  select coalesce(nullif(value,'')::numeric,0) into v_price from public.platform_settings where key='worker_pro_monthly_price_ngn' and is_active=true limit 1;
  select coalesce(lower(value) in ('true','1','yes','on'),false) into v_enabled from public.platform_settings where key='worker_pro_sales_enabled' and is_active=true limit 1;
  select coalesce(value,'') into v_apple_product_id from public.platform_settings where key='worker_pro_apple_product_id' and is_active=true limit 1;
  select coalesce(value,'') into v_google_product_id from public.platform_settings where key='worker_pro_google_product_id' and is_active=true limit 1;
  select coalesce(value,'') into v_web_plan_code from public.platform_settings where key='worker_pro_web_paystack_plan_code' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_version from public.platform_settings where key='worker_pro_terms_version' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content' and is_active=true limit 1;
  if nullif(btrim(v_terms_content),'') is not null then
    v_terms_sha256:=encode(extensions.digest(convert_to(v_terms_content,'UTF8'),'sha256'),'hex');
    select exists(
      select 1 from public.worker_pro_terms_acceptances acceptance
      where acceptance.worker_id=v_worker_id
        and acceptance.terms_version=v_terms_version
        and acceptance.terms_sha256=v_terms_sha256
    ) into v_terms_accepted;
  end if;
  select coalesce(nullif(value,'')::integer,24) into v_support_hours from public.platform_settings where key='worker_pro_support_response_hours' and is_active=true limit 1;
  return jsonb_build_object(
    'plan','worker_pro_monthly',
    'period','P1M',
    'sales_enabled',coalesce(v_enabled,false),
    'monthly_price_ngn',coalesce(v_price,0),
    'apple_product_id',coalesce(v_apple_product_id,''),
    'google_product_id',coalesce(v_google_product_id,''),
    'web_paystack_plan_code',coalesce(v_web_plan_code,''),
    'terms_version',coalesce(v_terms_version,''),
    'terms_content',coalesce(v_terms_content,''),
    'terms_accepted',coalesce(v_terms_accepted,false),
    'support_response_hours',coalesce(v_support_hours,24),
    'active',public.worker_pro_is_active(v_worker_id),
    'status',coalesce(v_subscription.status,'inactive'),
    'provider',v_subscription.provider,
    'product_id',v_subscription.product_id,
    'current_period_start',v_subscription.current_period_start,
    'current_period_end',v_subscription.current_period_end,
    'cancel_at_period_end',coalesce(v_subscription.cancel_at_period_end,false),
    'auto_renews',coalesce(v_subscription.auto_renews,false),
    'features',jsonb_build_array(
      'Enhanced professional profile',
      'More portfolio media',
      'Service packages',
      'Quote and invoice tools',
      'Professional analytics',
      'Priority platform support'
    )
  );
end;
$$;
revoke all on function public.get_my_worker_pro() from public,anon;
grant execute on function public.get_my_worker_pro() to authenticated,service_role;

create or replace function public.accept_current_worker_pro_terms()
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_worker_id text;
  v_terms_version text:='';
  v_terms_content text:='';
  v_terms_sha256 text;
  v_accepted_at timestamptz;
begin
  select user_id into v_worker_id from public.profiles
  where auth_id=(select auth.uid())::text
    and role='worker'
    and worker_status='verified'
    and worker_verified=true
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_worker_id is null then raise exception 'A WeHouse Reviewed Worker account is required'; end if;
  select coalesce(value,'') into v_terms_version from public.platform_settings
  where key='worker_pro_terms_version' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_content from public.platform_settings
  where key='worker_pro_terms_content' and is_active=true limit 1;
  if nullif(btrim(v_terms_version),'') is null or length(btrim(v_terms_content))<100 then
    raise exception 'WeHouse Pro subscription terms are not published';
  end if;
  v_terms_sha256:=encode(extensions.digest(convert_to(v_terms_content,'UTF8'),'sha256'),'hex');
  insert into public.worker_pro_terms_acceptances(worker_id,terms_version,terms_sha256,accepted_at)
  values(v_worker_id,btrim(v_terms_version),v_terms_sha256,now())
  on conflict(worker_id,terms_version,terms_sha256) do nothing
  returning accepted_at into v_accepted_at;
  if v_accepted_at is null then
    select accepted_at into v_accepted_at
    from public.worker_pro_terms_acceptances
    where worker_id=v_worker_id and terms_version=btrim(v_terms_version) and terms_sha256=v_terms_sha256;
  end if;
  return jsonb_build_object(
    'success',true,
    'terms_version',btrim(v_terms_version),
    'terms_sha256',v_terms_sha256,
    'accepted_at',v_accepted_at
  );
end;
$$;
revoke all on function public.accept_current_worker_pro_terms() from public,anon;
grant execute on function public.accept_current_worker_pro_terms() to authenticated,service_role;

create or replace function public.record_worker_pro_subscription_event(
  p_worker_id text,
  p_provider text,
  p_product_id text,
  p_provider_subscription_id text,
  p_provider_event_id text,
  p_event_type text,
  p_status text,
  p_event_time timestamptz,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_auto_renews boolean,
  p_price_amount numeric,
  p_currency text,
  p_environment text,
  p_payload_sha256 text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_subscription public.worker_pro_subscriptions;
  v_event_id uuid;
begin
  if p_provider not in ('apple','google','paystack') then raise exception 'Unsupported subscription provider'; end if;
  if p_status not in ('pending','active','grace_period','paused','cancelled','expired','revoked') then raise exception 'Unsupported subscription status'; end if;
  if p_environment not in ('sandbox','production') then raise exception 'Unsupported subscription environment'; end if;
  if nullif(btrim(coalesce(p_worker_id,'')),'') is null
     or nullif(btrim(coalesce(p_product_id,'')),'') is null
     or nullif(btrim(coalesce(p_provider_event_id,'')),'') is null
     or nullif(btrim(coalesce(p_event_type,'')),'') is null then
    raise exception 'Complete provider event identity is required';
  end if;
  if p_payload_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'A lowercase SHA-256 payload hash is required'; end if;
  if p_price_amount<0 or upper(coalesce(p_currency,'')) !~ '^[A-Z]{3}$' then raise exception 'Invalid subscription price'; end if;
  if p_period_end is not null and p_period_start is not null and p_period_end<=p_period_start then raise exception 'Invalid subscription period'; end if;
  if p_status in ('active','grace_period') and (p_period_end is null or p_period_end<=p_event_time) then raise exception 'An active entitlement requires a future period end'; end if;

  insert into public.worker_pro_subscription_events(
    worker_id,provider,provider_event_id,event_type,event_time,valid_until,
    payload_sha256,result,metadata
  ) values(
    p_worker_id,p_provider,btrim(p_provider_event_id),btrim(p_event_type),p_event_time,
    p_period_end,p_payload_sha256,'accepted',coalesce(p_metadata,'{}'::jsonb)
  ) on conflict(provider,provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select * into v_subscription from public.worker_pro_subscriptions where worker_id=p_worker_id;
    return jsonb_build_object('success',true,'duplicate',true,'subscription_id',v_subscription.id,'status',v_subscription.status);
  end if;

  select * into v_subscription from public.worker_pro_subscriptions
  where worker_id=p_worker_id
  for update;
  if v_subscription.id is not null and p_event_time<v_subscription.last_provider_event_at then
    update public.worker_pro_subscription_events
    set subscription_id=v_subscription.id,result='ignored'
    where id=v_event_id;
    return jsonb_build_object(
      'success',true,'duplicate',false,'ignored',true,
      'subscription_id',v_subscription.id,'status',v_subscription.status
    );
  end if;

  insert into public.worker_pro_subscriptions(
    worker_id,provider,product_id,provider_subscription_id,status,
    current_period_start,current_period_end,cancel_at_period_end,auto_renews,
    price_amount,currency,environment,last_verified_at,last_provider_event_at,last_provider_event_id,
    created_at,updated_at
  ) values(
    p_worker_id,p_provider,btrim(p_product_id),nullif(btrim(coalesce(p_provider_subscription_id,'')),''),p_status,
    p_period_start,p_period_end,coalesce(p_cancel_at_period_end,false),coalesce(p_auto_renews,false),
    p_price_amount,upper(p_currency),p_environment,now(),p_event_time,btrim(p_provider_event_id),now(),now()
  ) on conflict(worker_id) do update set
    provider=excluded.provider,
    product_id=excluded.product_id,
    provider_subscription_id=coalesce(excluded.provider_subscription_id,public.worker_pro_subscriptions.provider_subscription_id),
    status=excluded.status,
    current_period_start=excluded.current_period_start,
    current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,
    auto_renews=excluded.auto_renews,
    price_amount=excluded.price_amount,
    currency=excluded.currency,
    environment=excluded.environment,
    last_verified_at=now(),
    last_provider_event_at=excluded.last_provider_event_at,
    last_provider_event_id=excluded.last_provider_event_id,
    updated_at=now()
  returning * into v_subscription;

  update public.worker_pro_subscription_events set subscription_id=v_subscription.id where id=v_event_id;
  return jsonb_build_object('success',true,'duplicate',false,'subscription_id',v_subscription.id,'status',v_subscription.status);
end;
$$;
revoke all on function public.record_worker_pro_subscription_event(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,boolean,numeric,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_worker_pro_subscription_event(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,boolean,numeric,text,text,text,jsonb) to service_role;

create or replace function public.creator_set_worker_pro_setting(p_key text,p_value text)
returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_value text:=btrim(coalesce(p_value,''));
  v_price numeric;
  v_terms text;
  v_terms_content text;
  v_web_plan text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and role='creator'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Creator access required'; end if;
  if p_key not in (
    'worker_pro_monthly_price_ngn','worker_pro_sales_enabled',
    'worker_pro_apple_product_id','worker_pro_google_product_id',
    'worker_pro_web_paystack_plan_code','worker_pro_terms_version',
    'worker_pro_terms_content',
    'worker_pro_support_response_hours'
  ) then raise exception 'This setting is not part of WeHouse Pro'; end if;

  if p_key='worker_pro_monthly_price_ngn' then
    if v_value !~ '^\d+(\.\d{1,2})?$' or v_value::numeric<0 or v_value::numeric>10000000 then raise exception 'Monthly price must be between 0 and 10,000,000 NGN'; end if;
  elsif p_key='worker_pro_support_response_hours' then
    if v_value !~ '^\d+$' or v_value::integer<1 or v_value::integer>168 then raise exception 'Support response target must be between 1 and 168 hours'; end if;
  elsif p_key='worker_pro_sales_enabled' then
    if lower(v_value) not in ('true','false') then raise exception 'Sales setting must be true or false'; end if;
    if lower(v_value)='true' then
      select coalesce(nullif(value,'')::numeric,0) into v_price from public.platform_settings where key='worker_pro_monthly_price_ngn';
      select coalesce(value,'') into v_terms from public.platform_settings where key='worker_pro_terms_version';
      select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content';
      select coalesce(value,'') into v_web_plan from public.platform_settings where key='worker_pro_web_paystack_plan_code';
      if coalesce(v_price,0)<=0 then raise exception 'Set a monthly price before enabling Pro sales'; end if;
      if nullif(btrim(coalesce(v_terms,'')),'') is null then raise exception 'Publish a Pro terms version before enabling sales'; end if;
      if length(btrim(coalesce(v_terms_content,'')))<100 then raise exception 'Publish complete Pro subscription terms before enabling sales'; end if;
      if nullif(btrim(coalesce(v_web_plan,'')),'') is null then raise exception 'Sync the Paystack monthly plan before enabling web sales'; end if;
    end if;
  elsif p_key in ('worker_pro_apple_product_id','worker_pro_google_product_id','worker_pro_web_paystack_plan_code') then
    if v_value<>'' and v_value !~ '^[A-Za-z0-9._-]{3,160}$' then raise exception 'Invalid subscription product or plan identifier'; end if;
  elsif p_key='worker_pro_terms_version' and length(v_value)>100 then
    raise exception 'Pro terms version is too long';
  elsif p_key='worker_pro_terms_content' and (v_value<>'' and (length(v_value)<100 or length(v_value)>50000)) then
    raise exception 'Pro subscription terms must be between 100 and 50,000 characters';
  end if;

  if p_key='worker_pro_monthly_price_ngn' and exists(
    select 1 from public.platform_settings
    where key=p_key and value is distinct from v_value
  ) then
    update public.platform_settings
    set value='false',updated_at=now()
    where key='worker_pro_sales_enabled';
  end if;

  update public.platform_settings set value=v_value,updated_at=now()
  where key=p_key and category='worker_pro' and editable=true;
  if not found then raise exception 'WeHouse Pro setting is unavailable'; end if;

  if exists(
    select 1 from public.platform_settings
    where key='worker_pro_sales_enabled' and lower(value)='true' and is_active=true
  ) then
    select coalesce(nullif(value,'')::numeric,0) into v_price from public.platform_settings where key='worker_pro_monthly_price_ngn';
    select coalesce(value,'') into v_terms from public.platform_settings where key='worker_pro_terms_version';
    select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content';
    select coalesce(value,'') into v_web_plan from public.platform_settings where key='worker_pro_web_paystack_plan_code';
    if coalesce(v_price,0)<=0 or nullif(btrim(coalesce(v_terms,'')),'') is null
       or length(btrim(coalesce(v_terms_content,'')))<100
       or nullif(btrim(coalesce(v_web_plan,'')),'') is null then
      raise exception 'Disable Pro web sales before clearing its price, terms or Paystack plan';
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.creator_set_worker_pro_setting(text,text) from public,anon;
grant execute on function public.creator_set_worker_pro_setting(text,text) to authenticated,service_role;

create or replace function public.get_my_worker_activation()
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_ver public.worker_verifications;
  v_identity public.worker_identity_checks;
  v_profile_ready boolean:=false;
  v_identity_required boolean:=false;
  v_identity_current boolean:=true;
  v_marketplace_enabled boolean:=false;
  v_days integer:=public.worker_identity_recheck_days();
  v_due_at timestamptz;
  v_days_remaining integer;
  v_pro_active boolean:=false;
begin
  select * into v_profile from public.profiles
  where auth_id=(select auth.uid())::text and role='worker' limit 1;
  if v_profile is null then raise exception 'Worker profile not found'; end if;
  select coalesce(lower(value) in ('true','1','yes','on'),false) into v_identity_required
  from public.platform_settings where key='worker_identity_checks_enabled' and is_active=true limit 1;
  select coalesce(lower(value) in ('true','1','yes','on'),false) into v_marketplace_enabled
  from public.platform_settings where key='worker_marketplace_launch_enabled' and is_active=true limit 1;
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  select * into v_ver from public.worker_verifications where worker_id=v_profile.user_id order by created_at desc limit 1;
  select * into v_identity from public.worker_identity_checks where worker_id=v_profile.user_id;
  if coalesce(v_identity_required,false) then
    v_identity_current:=false;
    if v_identity.status='passed' and v_identity.captured_at is not null then
      v_due_at:=v_identity.captured_at+make_interval(days=>v_days);
      v_identity_current:=v_due_at>now();
      v_days_remaining:=greatest(0,ceil(extract(epoch from (v_due_at-now()))/86400.0)::integer);
    end if;
  end if;
  v_pro_active:=public.worker_pro_is_active(v_profile.user_id);
  return jsonb_build_object(
    'worker_status',coalesce(v_profile.worker_status,'pending'),
    'reviewed',coalesce(v_profile.worker_status='verified' and v_profile.worker_verified,false),
    'live',coalesce(v_profile.worker_status='verified' and v_profile.worker_verified and v_identity_current and v_marketplace_enabled,false),
    'marketplace_enabled',coalesce(v_marketplace_enabled,false),
    'profile_complete',v_profile_ready,
    'payment_status','not_required',
    'payment_required',false,
    'payment_confirmed',true,
    'fee_waived',true,
    'gold_badge',v_pro_active,
    'pro_active',v_pro_active,
    'identity_required',coalesce(v_identity_required,false),
    'identity_status',case
      when not coalesce(v_identity_required,false) then 'not_required'
      when v_identity.status='passed' and not v_identity_current then 'expired'
      else coalesce(v_identity.status,'not_started')
    end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',v_identity_current,
    'identity_current',v_identity_current,
    'identity_captured_at',v_identity.captured_at,
    'identity_due_at',v_due_at,
    'identity_recheck_days',v_days,
    'identity_days_remaining',v_days_remaining,
    'test_passed',true,'test_percent',100,'test_attempts_24h',0,
    'evidence_saved',coalesce(nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is not null,false),
    'submitted',coalesce(v_profile.worker_status='profile_under_review' and v_ver.submitted_at is not null,false),
    'review_status',v_ver.status,
    'rejection_reason',(select rejection_reason from public.worker_verification_reviews where worker_id=v_profile.user_id order by created_at desc limit 1)
  );
end;
$$;

create or replace function public.get_worker_marketplace_trust(p_worker_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_worker public.profiles; v_enabled boolean:=false; v_min_jobs integer:=5;
  v_min_rating numeric:=4.5; v_max_cancel numeric:=20; v_block_disputes boolean:=true;
  v_completed integer:=0; v_worker_cancelled integer:=0; v_open_disputes integer:=0;
  v_cancel_rate numeric:=0; v_trusted boolean:=false; v_pro boolean:=false;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into v_worker from public.profiles where user_id=p_worker_id and role='worker'
    and worker_status='verified' and worker_verified=true
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_worker is null then return jsonb_build_object('reviewed',false,'trusted',false,'pro_active',false); end if;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_enabled from public.platform_settings where key='worker_trust_enabled' and is_active=true limit 1;
  select coalesce(nullif(value,''),'5')::integer into v_min_jobs from public.platform_settings where key='worker_trusted_min_completed_jobs' and is_active=true limit 1;
  select coalesce(nullif(value,''),'4.5')::numeric into v_min_rating from public.platform_settings where key='worker_trusted_min_rating' and is_active=true limit 1;
  select coalesce(nullif(value,''),'20')::numeric into v_max_cancel from public.platform_settings where key='worker_trusted_max_cancel_rate' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),true) into v_block_disputes from public.platform_settings where key='worker_trusted_block_open_disputes' and is_active=true limit 1;
  select count(*) into v_completed from public.worker_bookings where worker_id=p_worker_id and status='approved_released';
  select count(*) into v_worker_cancelled from public.worker_bookings where worker_id=p_worker_id and status='cancelled' and cancelled_by=p_worker_id;
  select count(*) into v_open_disputes from public.worker_bookings where worker_id=p_worker_id and status='disputed';
  if v_completed+v_worker_cancelled>0 then v_cancel_rate:=round((v_worker_cancelled::numeric*100)/(v_completed+v_worker_cancelled),2); end if;
  v_trusted:=coalesce(v_enabled,false) and v_completed>=coalesce(v_min_jobs,5)
    and coalesce(v_worker.rating,0)>=coalesce(v_min_rating,4.5)
    and v_cancel_rate<=coalesce(v_max_cancel,20)
    and (not coalesce(v_block_disputes,true) or v_open_disputes=0);
  v_pro:=public.worker_pro_is_active(p_worker_id);
  return jsonb_build_object(
    'reviewed',true,'trusted',v_trusted,'trusted_enabled',coalesce(v_enabled,false),
    'pro_active',v_pro,'pro_label',case when v_pro then 'PRO' else null end,
    'completed_jobs',v_completed,'rating',coalesce(v_worker.rating,0),'review_count',coalesce(v_worker.review_count,0),
    'worker_cancel_rate',v_cancel_rate,'open_disputes',v_open_disputes,
    'label',case when v_trusted then 'WeHouse Trusted' else 'WeHouse Reviewed' end
  );
end;
$$;

drop function if exists public.get_public_workers(text,text,text);
create function public.get_public_workers(
  p_state text default null,
  p_city text default null,
  p_occupation text default null
)
returns table(
  user_id text,
  full_name text,
  username text,
  avatar_url text,
  bio text,
  state text,
  city text,
  local_government text,
  area text,
  worker_occupation text,
  worker_skills jsonb,
  worker_price integer,
  worker_bio text,
  worker_experience text,
  rating numeric,
  review_count integer,
  is_online boolean,
  last_seen timestamptz,
  services jsonb,
  coverage jsonb,
  pro_active boolean
)
language plpgsql
stable
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_marketplace_enabled boolean:=false;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select coalesce(lower(value) in ('true','1','yes','on'),false)
    into v_marketplace_enabled
  from public.platform_settings
  where key='worker_marketplace_launch_enabled' and is_active=true
  limit 1;
  if not coalesce(v_marketplace_enabled,false) then return; end if;
  return query
  select
    profile.user_id,
    profile.full_name,
    profile.username,
    profile.avatar_url,
    profile.bio,
    profile.state,
    profile.city,
    profile.local_government,
    profile.area,
    profile.worker_occupation,
    profile.worker_skills,
    profile.worker_price,
    profile.worker_bio,
    profile.worker_experience,
    profile.rating,
    profile.review_count,
    profile.is_online,
    profile.last_seen,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',service.service_name,
        'price',service.price,
        'price_type',service.price_type
      ))
      from public.worker_services service
      where service.worker_id=profile.user_id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'state',coverage_row.state,
        'lga',coverage_row.lga,
        'areas',coverage_row.areas
      ))
      from public.worker_service_coverage coverage_row
      where coverage_row.worker_id=profile.user_id
    ),'[]'::jsonb),
    public.worker_pro_is_active(profile.user_id)
  from public.profiles profile
  where profile.role='worker'
    and profile.worker_status='verified'
    and profile.worker_verified=true
    and profile.available=true
    and profile.deleted=false
    and profile.suspended=false
    and profile.banned=false
    and (
      not coalesce((select lower(value) in ('true','1','yes','on') from public.platform_settings where key='worker_identity_checks_enabled' and is_active=true limit 1),false)
      or public.worker_identity_is_current(profile.user_id)
    )
    and (p_state is null or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state))
    and (p_city is null or profile.city ilike p_city or profile.local_government ilike p_city)
    and (p_occupation is null or profile.worker_occupation ilike p_occupation)
  order by profile.rating desc nulls last,profile.review_count desc nulls last;
end;
$$;

revoke all on function public.save_my_worker_professional_evidence(text,text) from public,anon;
grant execute on function public.save_my_worker_professional_evidence(text,text) to authenticated,service_role;
revoke all on function public.submit_my_worker_verification() from public,anon;
grant execute on function public.submit_my_worker_verification() to authenticated,service_role;
revoke all on function public.get_my_worker_activation() from public,anon;
grant execute on function public.get_my_worker_activation() to authenticated,service_role;
revoke all on function public.get_worker_marketplace_trust(text) from public,anon;
grant execute on function public.get_worker_marketplace_trust(text) to authenticated,service_role;
revoke all on function public.get_public_workers(text,text,text) from public,anon;
grant execute on function public.get_public_workers(text,text,text) to authenticated,service_role;

-- The legacy blue-badge table is retained only for historical reads. A client
-- can no longer create or alter a paid badge directly.
revoke insert,update,delete on table public.blue_badge_subscriptions from anon,authenticated;

commit;
