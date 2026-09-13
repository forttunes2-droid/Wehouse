begin;

-- The database keeps the worker_pro namespace for API compatibility. The
-- customer-facing name and tagline are Creator-managed settings so changing
-- the offer never requires a code release. The launch default, WeHouse Works,
-- is short, connected to the brand and describes tools for doing work.
insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
) values
  ('worker_pro_product_name','WeHouse Works','worker_pro','Paid Worker plan name','Short public name shown to Workers. This does not rename Reviewed or Trusted.','text',true,true,now(),now()),
  ('worker_pro_product_tagline','Run your work with clearer numbers, documents and reach.','worker_pro','Paid Worker plan tagline','Plain-language description shown beside the plan name.','text',true,true,now(),now()),
  ('worker_pro_yearly_price_ngn','0','worker_pro','Yearly web price (NGN)','Total annual price for new paid Worker subscriptions. Set lower than twelve monthly payments to offer an annual saving.','number',true,true,now(),now()),
  ('worker_pro_web_paystack_yearly_plan_code','','worker_pro','Paystack yearly plan code','Paystack annually recurring plan synchronized from the Creator dashboard.','text',true,true,now(),now()),
  ('worker_pro_apple_yearly_product_id','','worker_pro','Apple yearly product ID','Yearly auto-renewable subscription product in the same App Store subscription group as the monthly product.','text',true,true,now(),now()),
  ('worker_pro_google_yearly_product_id','','worker_pro','Google Play yearly product ID','Yearly Google Play subscription product or base-plan identifier.','text',true,true,now(),now()),
  ('worker_pro_payment_grace_days','0','worker_pro','Failed-payment grace (days)','Optional paid-tool access after a failed renewal. Zero means access lasts only through the already-paid period.','number',true,true,now(),now()),
  ('worker_pro_ios_sales_enabled','false','worker_pro','Enable iOS paid plan sales','Operator-only gate. Requires App Store receipt verification, server notifications and a current legal launch approval.','boolean',false,true,now(),now()),
  ('worker_pro_android_sales_enabled','false','worker_pro','Enable Android paid plan sales','Operator-only gate. Requires Play receipt verification, real-time developer notifications and a current legal launch approval.','boolean',false,true,now(),now())
  ,('worker_featured_sales_enabled','false','worker_pro','Enable Featured Workers','Show eligible paid members in a separate Sponsored section. Requires a current Worker marketplace and sponsored-placement legal approval.','boolean',true,true,now(),now())
  ,('worker_featured_slot_count','3','worker_pro','Featured Worker slots','Maximum matching Sponsored Workers shown above the unchanged organic results.','number',true,true,now(),now())
on conflict(key) do nothing;

alter table public.worker_pro_subscriptions
  add column if not exists billing_period text not null default 'monthly';
alter table public.worker_pro_subscriptions
  drop constraint if exists worker_pro_subscriptions_billing_period_check;
alter table public.worker_pro_subscriptions
  add constraint worker_pro_subscriptions_billing_period_check
  check(billing_period in('monthly','yearly'));

alter table public.worker_pro_subscription_events
  drop constraint if exists worker_pro_subscription_events_result_check;
alter table public.worker_pro_subscription_events
  add constraint worker_pro_subscription_events_result_check
  check(result in('accepted','ignored','rejected','conflict'));

create or replace function public.worker_pro_billing_period_for_product(
  p_provider text,
  p_product_id text
)
returns text
language sql
stable
security definer
set search_path='pg_catalog','public'
as $$
  select case
    when nullif(btrim(coalesce(p_product_id,'')),'') is null then null
    when p_provider='paystack' and p_product_id=(
      select value from public.platform_settings
      where key='worker_pro_web_paystack_yearly_plan_code' and is_active=true
    ) then 'yearly'
    when p_provider='apple' and p_product_id=(
      select value from public.platform_settings
      where key='worker_pro_apple_yearly_product_id' and is_active=true
    ) then 'yearly'
    when p_provider='google' and p_product_id=(
      select value from public.platform_settings
      where key='worker_pro_google_yearly_product_id' and is_active=true
    ) then 'yearly'
    when p_provider='paystack' and p_product_id=(
      select value from public.platform_settings
      where key='worker_pro_web_paystack_plan_code' and is_active=true
    ) then 'monthly'
    when p_provider='apple' and p_product_id=(
      select value from public.platform_settings
      where key='worker_pro_apple_product_id' and is_active=true
    ) then 'monthly'
    when p_provider='google' and p_product_id=(
      select value from public.platform_settings
      where key='worker_pro_google_product_id' and is_active=true
    ) then 'monthly'
    else null
  end;
$$;
revoke all on function public.worker_pro_billing_period_for_product(text,text)
from public,anon,authenticated;
grant execute on function public.worker_pro_billing_period_for_product(text,text)
to service_role;

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
  v_billing_period text;
  v_locked_worker_id text;
begin
  if p_provider not in('apple','google','paystack') then raise exception 'Unsupported subscription provider'; end if;
  if p_status not in('pending','active','grace_period','paused','cancelled','expired','revoked') then raise exception 'Unsupported subscription status'; end if;
  if p_environment not in('sandbox','production') then raise exception 'Unsupported subscription environment'; end if;
  if nullif(btrim(coalesce(p_worker_id,'')),'') is null
     or nullif(btrim(coalesce(p_product_id,'')),'') is null
     or nullif(btrim(coalesce(p_provider_event_id,'')),'') is null
     or nullif(btrim(coalesce(p_event_type,'')),'') is null then
    raise exception 'Complete provider event identity is required';
  end if;
  if p_payload_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'A lowercase SHA-256 payload hash is required'; end if;
  if p_price_amount<0 or upper(coalesce(p_currency,'')) !~ '^[A-Z]{3}$' then raise exception 'Invalid subscription price'; end if;
  if p_period_end is not null and p_period_start is not null and p_period_end<=p_period_start then raise exception 'Invalid subscription period'; end if;
  if p_status in('active','grace_period') and (p_period_end is null or p_period_end<=p_event_time) then raise exception 'An active entitlement requires a future period end'; end if;

  -- Serialize every provider event for this Worker, including the first event.
  -- Without this profile-row lock, two first-time provider callbacks could both
  -- observe no subscription and the later upsert could replace the winner.
  select profile.user_id into v_locked_worker_id
  from public.profiles profile
  where profile.user_id=p_worker_id
  for update;
  if v_locked_worker_id is null then raise exception 'Worker account was not found'; end if;

  insert into public.worker_pro_subscription_events(
    worker_id,provider,provider_event_id,event_type,event_time,valid_until,
    payload_sha256,result,metadata
  ) values(
    p_worker_id,p_provider,btrim(p_provider_event_id),btrim(p_event_type),p_event_time,
    p_period_end,p_payload_sha256,'accepted',coalesce(p_metadata,'{}'::jsonb)
  ) on conflict(provider,provider_event_id) do nothing
  returning id into v_event_id;

  select * into v_subscription
  from public.worker_pro_subscriptions
  where worker_id=p_worker_id
  for update;

  if v_event_id is null then
    return jsonb_build_object(
      'success',true,'duplicate',true,'subscription_id',v_subscription.id,
      'status',v_subscription.status
    );
  end if;

  -- A later event from another provider must never silently replace a paid
  -- entitlement. Record the conflict for support/refund handling and leave the
  -- existing provider authoritative until it ends.
  if v_subscription.id is not null
     and v_subscription.provider<>p_provider
     and v_subscription.status in('active','grace_period')
     and v_subscription.current_period_end>now() then
    update public.worker_pro_subscription_events
    set subscription_id=v_subscription.id,
        result='conflict',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'conflict_reason','active_subscription_on_another_provider',
          'active_provider',v_subscription.provider,
          'incoming_provider',p_provider
        )
    where id=v_event_id;
    return jsonb_build_object(
      'success',false,'conflict',true,'active_provider',v_subscription.provider,
      'incoming_provider',p_provider,'status',v_subscription.status,
      'subscription_id',v_subscription.id
    );
  end if;

  if v_subscription.id is not null and p_event_time<v_subscription.last_provider_event_at then
    update public.worker_pro_subscription_events
    set subscription_id=v_subscription.id,result='ignored'
    where id=v_event_id;
    return jsonb_build_object(
      'success',true,'duplicate',false,'ignored',true,
      'subscription_id',v_subscription.id,'status',v_subscription.status
    );
  end if;

  v_billing_period:=coalesce(
    public.worker_pro_billing_period_for_product(p_provider,p_product_id),
    nullif(coalesce(p_metadata,'{}'::jsonb)->>'billing_period',''),
    v_subscription.billing_period,
    'monthly'
  );
  if v_billing_period not in('monthly','yearly') then
    raise exception 'Unsupported subscription billing period';
  end if;

  insert into public.worker_pro_subscriptions(
    worker_id,provider,product_id,provider_subscription_id,status,billing_period,
    current_period_start,current_period_end,cancel_at_period_end,auto_renews,
    price_amount,currency,environment,last_verified_at,last_provider_event_at,
    last_provider_event_id,created_at,updated_at
  ) values(
    p_worker_id,p_provider,btrim(p_product_id),
    nullif(btrim(coalesce(p_provider_subscription_id,'')),''),p_status,v_billing_period,
    p_period_start,p_period_end,coalesce(p_cancel_at_period_end,false),
    coalesce(p_auto_renews,false),p_price_amount,upper(p_currency),p_environment,
    now(),p_event_time,btrim(p_provider_event_id),now(),now()
  ) on conflict(worker_id) do update set
    provider=excluded.provider,
    product_id=excluded.product_id,
    provider_subscription_id=coalesce(
      excluded.provider_subscription_id,
      public.worker_pro_subscriptions.provider_subscription_id
    ),
    status=excluded.status,
    billing_period=excluded.billing_period,
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

  update public.worker_pro_subscription_events
  set subscription_id=v_subscription.id
  where id=v_event_id;
  return jsonb_build_object(
    'success',true,'duplicate',false,'subscription_id',v_subscription.id,
    'status',v_subscription.status,'billing_period',v_subscription.billing_period
  );
end;
$$;
revoke all on function public.record_worker_pro_subscription_event(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,boolean,numeric,text,text,text,jsonb)
from public,anon,authenticated;
grant execute on function public.record_worker_pro_subscription_event(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,boolean,numeric,text,text,text,jsonb)
to service_role;

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
  v_monthly_price numeric:=0;
  v_yearly_price numeric:=0;
  v_enabled boolean:=false;
  v_ios_enabled boolean:=false;
  v_android_enabled boolean:=false;
  v_apple_monthly text:='';
  v_apple_yearly text:='';
  v_google_monthly text:='';
  v_google_yearly text:='';
  v_web_monthly text:='';
  v_web_yearly text:='';
  v_terms_version text:='';
  v_terms_content text:='';
  v_terms_sha256 text:='';
  v_terms_accepted boolean:=false;
  v_support_hours integer:=24;
  v_grace_days integer:=0;
  v_product_name text:='WeHouse Works';
  v_product_tagline text:='Run your work with clearer numbers, documents and reach.';
  v_featured_enabled boolean:=false;
  v_yearly_saving numeric:=0;
  v_yearly_discount numeric:=0;
begin
  select profile.user_id into v_worker_id
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_worker_id is null then raise exception 'Active Worker workspace required'; end if;

  select * into v_subscription
  from public.worker_pro_subscriptions
  where worker_id=v_worker_id limit 1;
  select coalesce(nullif(value,'')::numeric,0) into v_monthly_price from public.platform_settings where key='worker_pro_monthly_price_ngn' and is_active=true limit 1;
  select coalesce(nullif(value,'')::numeric,0) into v_yearly_price from public.platform_settings where key='worker_pro_yearly_price_ngn' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_enabled from public.platform_settings where key='worker_pro_sales_enabled' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_ios_enabled from public.platform_settings where key='worker_pro_ios_sales_enabled' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_android_enabled from public.platform_settings where key='worker_pro_android_sales_enabled' and is_active=true limit 1;
  select coalesce(value,'') into v_apple_monthly from public.platform_settings where key='worker_pro_apple_product_id' and is_active=true limit 1;
  select coalesce(value,'') into v_apple_yearly from public.platform_settings where key='worker_pro_apple_yearly_product_id' and is_active=true limit 1;
  select coalesce(value,'') into v_google_monthly from public.platform_settings where key='worker_pro_google_product_id' and is_active=true limit 1;
  select coalesce(value,'') into v_google_yearly from public.platform_settings where key='worker_pro_google_yearly_product_id' and is_active=true limit 1;
  select coalesce(value,'') into v_web_monthly from public.platform_settings where key='worker_pro_web_paystack_plan_code' and is_active=true limit 1;
  select coalesce(value,'') into v_web_yearly from public.platform_settings where key='worker_pro_web_paystack_yearly_plan_code' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_version from public.platform_settings where key='worker_pro_terms_version' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content' and is_active=true limit 1;
  select coalesce(nullif(value,'')::integer,24) into v_support_hours from public.platform_settings where key='worker_pro_support_response_hours' and is_active=true limit 1;
  select coalesce(nullif(value,'')::integer,0) into v_grace_days from public.platform_settings where key='worker_pro_payment_grace_days' and is_active=true limit 1;
  select coalesce(nullif(btrim(value),''),'WeHouse Works') into v_product_name from public.platform_settings where key='worker_pro_product_name' and is_active=true limit 1;
  select coalesce(nullif(btrim(value),''),'Run your work with clearer numbers, documents and reach.') into v_product_tagline from public.platform_settings where key='worker_pro_product_tagline' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_featured_enabled from public.platform_settings where key='worker_featured_sales_enabled' and is_active=true limit 1;

  if nullif(btrim(v_terms_content),'') is not null then
    v_terms_sha256:=encode(extensions.digest(convert_to(v_terms_content,'UTF8'),'sha256'),'hex');
    select exists(
      select 1 from public.worker_pro_terms_acceptances acceptance
      where acceptance.worker_id=v_worker_id
        and acceptance.terms_version=v_terms_version
        and acceptance.terms_sha256=v_terms_sha256
    ) into v_terms_accepted;
  end if;
  v_yearly_saving:=greatest(v_monthly_price*12-v_yearly_price,0);
  if v_monthly_price>0 and v_yearly_saving>0 then
    v_yearly_discount:=round((v_yearly_saving/(v_monthly_price*12))*100,1);
  end if;

  return jsonb_build_object(
    'product_name',v_product_name,
    'product_tagline',v_product_tagline,
    'plan','worker_pro',
    'sales_enabled',coalesce(v_enabled,false),
    'native_sales',jsonb_build_object(
      'ios_enabled',coalesce(v_ios_enabled,false),
      'android_enabled',coalesce(v_android_enabled,false)
    ),
    'monthly_price_ngn',coalesce(v_monthly_price,0),
    'yearly_price_ngn',coalesce(v_yearly_price,0),
    'apple_product_id',coalesce(v_apple_monthly,''),
    'google_product_id',coalesce(v_google_monthly,''),
    'web_paystack_plan_code',coalesce(v_web_monthly,''),
    'plans',jsonb_build_array(
      jsonb_build_object(
        'billing_period','monthly','period','P1M','label','Monthly',
        'price_ngn',coalesce(v_monthly_price,0),
        'web_plan_code',coalesce(v_web_monthly,''),
        'apple_product_id',coalesce(v_apple_monthly,''),
        'google_product_id',coalesce(v_google_monthly,''),
        'web_available',coalesce(v_enabled,false) and v_monthly_price>0 and nullif(btrim(v_web_monthly),'') is not null,
        'saving_ngn',0,'discount_percent',0
      ),
      jsonb_build_object(
        'billing_period','yearly','period','P1Y','label','Yearly',
        'price_ngn',coalesce(v_yearly_price,0),
        'web_plan_code',coalesce(v_web_yearly,''),
        'apple_product_id',coalesce(v_apple_yearly,''),
        'google_product_id',coalesce(v_google_yearly,''),
        'web_available',coalesce(v_enabled,false) and v_yearly_price>0 and nullif(btrim(v_web_yearly),'') is not null,
        'saving_ngn',v_yearly_saving,'discount_percent',v_yearly_discount
      )
    ),
    'terms_version',coalesce(v_terms_version,''),
    'terms_content',coalesce(v_terms_content,''),
    'terms_accepted',coalesce(v_terms_accepted,false),
    'support_response_hours',coalesce(v_support_hours,24),
    'payment_grace_days',coalesce(v_grace_days,0),
    'active',public.worker_pro_is_active(v_worker_id),
    'status',coalesce(v_subscription.status,'inactive'),
    'provider',v_subscription.provider,
    'product_id',v_subscription.product_id,
    'billing_period',coalesce(v_subscription.billing_period,'monthly'),
    'current_period_start',v_subscription.current_period_start,
    'current_period_end',v_subscription.current_period_end,
    'cancel_at_period_end',coalesce(v_subscription.cancel_at_period_end,false),
    'auto_renews',coalesce(v_subscription.auto_renews,false),
    'features',jsonb_build_array(
      'Work Insights from completed WeHouse records',
      'Quotes and invoices with clear payment labels',
      case when coalesce(v_featured_enabled,false)
        then 'Eligible Sponsored placement with fair rotation'
        else 'Sponsored placement when legally approved and enabled' end,
      'Priority for ordinary platform support'
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
  select profile.user_id into v_worker_id
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and profile.worker_status='verified'
    and profile.worker_verified=true
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_worker_id is null then raise exception 'A WeHouse Reviewed Worker account is required'; end if;
  select coalesce(value,'') into v_terms_version from public.platform_settings where key='worker_pro_terms_version' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content' and is_active=true limit 1;
  if nullif(btrim(v_terms_version),'') is null or length(btrim(v_terms_content))<100 then
    raise exception 'Paid Worker subscription terms are not published';
  end if;
  v_terms_sha256:=encode(extensions.digest(convert_to(v_terms_content,'UTF8'),'sha256'),'hex');
  insert into public.worker_pro_terms_acceptances(worker_id,terms_version,terms_sha256,accepted_at)
  values(v_worker_id,btrim(v_terms_version),v_terms_sha256,now())
  on conflict(worker_id,terms_version,terms_sha256) do nothing
  returning accepted_at into v_accepted_at;
  if v_accepted_at is null then
    select accepted_at into v_accepted_at from public.worker_pro_terms_acceptances
    where worker_id=v_worker_id and terms_version=btrim(v_terms_version)
      and terms_sha256=v_terms_sha256;
  end if;
  return jsonb_build_object(
    'success',true,'terms_version',btrim(v_terms_version),
    'terms_sha256',v_terms_sha256,'accepted_at',v_accepted_at
  );
end;
$$;
revoke all on function public.accept_current_worker_pro_terms() from public,anon;
grant execute on function public.accept_current_worker_pro_terms() to authenticated,service_role;

create or replace function public.creator_set_worker_pro_setting(p_key text,p_value text)
returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_value text:=btrim(coalesce(p_value,''));
  v_monthly_price numeric:=0;
  v_yearly_price numeric:=0;
  v_terms text:='';
  v_terms_content text:='';
  v_monthly_plan text:='';
  v_yearly_plan text:='';
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role='creator'
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Creator access required'; end if;
  if p_key not in(
    'worker_pro_monthly_price_ngn','worker_pro_yearly_price_ngn',
    'worker_pro_sales_enabled','worker_pro_apple_product_id',
    'worker_pro_apple_yearly_product_id','worker_pro_google_product_id',
    'worker_pro_google_yearly_product_id','worker_pro_web_paystack_plan_code',
    'worker_pro_web_paystack_yearly_plan_code','worker_pro_terms_version',
    'worker_pro_terms_content','worker_pro_support_response_hours',
    'worker_pro_payment_grace_days','worker_pro_product_name',
    'worker_pro_product_tagline','worker_featured_sales_enabled',
    'worker_featured_slot_count'
  ) then raise exception 'This setting is not part of the paid Worker plan'; end if;

  if p_key in('worker_pro_monthly_price_ngn','worker_pro_yearly_price_ngn') then
    if v_value !~ '^\d+(\.\d{1,2})?$' or v_value::numeric<0 or v_value::numeric>10000000 then
      raise exception 'Plan price must be between 0 and 10,000,000 NGN';
    end if;
  elsif p_key='worker_pro_support_response_hours' then
    if v_value !~ '^\d+$' or v_value::integer<1 or v_value::integer>168 then
      raise exception 'Support response target must be between 1 and 168 hours';
    end if;
  elsif p_key='worker_pro_payment_grace_days' then
    if v_value !~ '^\d+$' or v_value::integer<0 or v_value::integer>14 then
      raise exception 'Failed-payment grace must be between 0 and 14 days';
    end if;
  elsif p_key='worker_featured_slot_count' then
    if v_value !~ '^\d+$' or v_value::integer<0 or v_value::integer>6 then
      raise exception 'Featured Worker slots must be between 0 and 6';
    end if;
  elsif p_key='worker_featured_sales_enabled' then
    if lower(v_value) not in('true','false') then raise exception 'Featured setting must be true or false'; end if;
    if lower(v_value)='true' then
      if not public._legal_launch_gate_is_approved('worker_featured_placement') then
        raise exception 'Sponsored Worker placement has no current legal launch approval';
      end if;
      if not exists(
        select 1 from public.platform_settings
        where key='worker_marketplace_launch_enabled' and is_active=true
          and lower(value) in('true','1','yes','on')
      ) then raise exception 'Open the legally approved Worker marketplace before Featured Workers'; end if;
    end if;
  elsif p_key='worker_pro_sales_enabled' then
    if lower(v_value) not in('true','false') then raise exception 'Sales setting must be true or false'; end if;
    if lower(v_value)='true' then
      if not public._legal_launch_gate_is_approved('worker_pro_web_sales') then
        raise exception 'Paid Worker plan web sales have no current legal launch approval';
      end if;
      select coalesce(nullif(value,'')::numeric,0) into v_monthly_price from public.platform_settings where key='worker_pro_monthly_price_ngn';
      select coalesce(nullif(value,'')::numeric,0) into v_yearly_price from public.platform_settings where key='worker_pro_yearly_price_ngn';
      select coalesce(value,'') into v_monthly_plan from public.platform_settings where key='worker_pro_web_paystack_plan_code';
      select coalesce(value,'') into v_yearly_plan from public.platform_settings where key='worker_pro_web_paystack_yearly_plan_code';
      select coalesce(value,'') into v_terms from public.platform_settings where key='worker_pro_terms_version';
      select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content';
      if not(
        (v_monthly_price>0 and nullif(btrim(v_monthly_plan),'') is not null)
        or (v_yearly_price>0 and nullif(btrim(v_yearly_plan),'') is not null)
      ) then raise exception 'Configure and sync at least one web billing plan before enabling sales'; end if;
      if nullif(btrim(v_terms),'') is null then raise exception 'Publish a paid plan terms version before enabling sales'; end if;
      if length(btrim(v_terms_content))<100 then raise exception 'Publish complete paid plan subscription terms before enabling sales'; end if;
    end if;
  elsif p_key in(
    'worker_pro_apple_product_id','worker_pro_apple_yearly_product_id',
    'worker_pro_google_product_id','worker_pro_google_yearly_product_id',
    'worker_pro_web_paystack_plan_code','worker_pro_web_paystack_yearly_plan_code'
  ) then
    if v_value<>'' and v_value !~ '^[A-Za-z0-9._-]{3,160}$' then
      raise exception 'Invalid subscription product or plan identifier';
    end if;
  elsif p_key='worker_pro_terms_version' and length(v_value)>100 then
    raise exception 'Paid plan terms version is too long';
  elsif p_key='worker_pro_terms_content'
    and (v_value<>'' and (length(v_value)<100 or length(v_value)>50000)) then
      raise exception 'Paid plan subscription terms must be between 100 and 50,000 characters';
  elsif p_key='worker_pro_product_name' then
    if length(v_value)<3 or length(v_value)>40 then
      raise exception 'Paid Worker plan name must be between 3 and 40 characters';
    end if;
  elsif p_key='worker_pro_product_tagline' then
    if length(v_value)<10 or length(v_value)>140 then
      raise exception 'Paid Worker plan tagline must be between 10 and 140 characters';
    end if;
  end if;

  if p_key in('worker_pro_monthly_price_ngn','worker_pro_yearly_price_ngn') and exists(
    select 1 from public.platform_settings where key=p_key and value is distinct from v_value
  ) then
    update public.platform_settings set value='false',updated_at=now()
    where key='worker_pro_sales_enabled';
  end if;

  update public.platform_settings set value=v_value,updated_at=now()
  where key=p_key and category='worker_pro' and editable=true;
  if not found then raise exception 'Paid Worker plan setting is unavailable'; end if;

  if exists(
    select 1 from public.platform_settings
    where key='worker_pro_sales_enabled' and lower(value)='true' and is_active=true
  ) then
    select coalesce(nullif(value,'')::numeric,0) into v_monthly_price from public.platform_settings where key='worker_pro_monthly_price_ngn';
    select coalesce(nullif(value,'')::numeric,0) into v_yearly_price from public.platform_settings where key='worker_pro_yearly_price_ngn';
    select coalesce(value,'') into v_monthly_plan from public.platform_settings where key='worker_pro_web_paystack_plan_code';
    select coalesce(value,'') into v_yearly_plan from public.platform_settings where key='worker_pro_web_paystack_yearly_plan_code';
    select coalesce(value,'') into v_terms from public.platform_settings where key='worker_pro_terms_version';
    select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content';
    if not public._legal_launch_gate_is_approved('worker_pro_web_sales')
       or not(
         (v_monthly_price>0 and nullif(btrim(v_monthly_plan),'') is not null)
         or (v_yearly_price>0 and nullif(btrim(v_yearly_plan),'') is not null)
       )
       or nullif(btrim(v_terms),'') is null
       or length(btrim(v_terms_content))<100 then
      raise exception 'Disable paid plan web sales before clearing its approval, terms or final enabled plan';
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.creator_set_worker_pro_setting(text,text) from public,anon;
grant execute on function public.creator_set_worker_pro_setting(text,text) to authenticated,service_role;

drop function if exists public.create_worker_pro_web_payment();
create or replace function public.create_worker_pro_web_payment(
  p_billing_period text default 'monthly'
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_worker public.profiles;
  v_period text:=lower(btrim(coalesce(p_billing_period,'')));
  v_sales_enabled boolean:=false;
  v_price numeric:=0;
  v_plan_code text:='';
  v_terms_version text:='';
  v_terms_content text:='';
  v_terms_sha256 text:='';
  v_terms_accepted boolean:=false;
  v_reference text;
  v_existing public.booking_payments;
  v_iso_period text;
begin
  if v_period not in('monthly','yearly') then
    return jsonb_build_object('success',false,'error','Choose monthly or yearly billing');
  end if;
  select profile.* into v_worker from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and profile.worker_status='verified' and profile.worker_verified=true
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false) limit 1;
  if v_worker is null then return jsonb_build_object('success',false,'error','A WeHouse Reviewed Worker account is required'); end if;
  if public.worker_pro_is_active(v_worker.user_id) then return jsonb_build_object('success',false,'error','A paid Worker plan is already active; manage or cancel it before changing providers'); end if;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_sales_enabled from public.platform_settings where key='worker_pro_sales_enabled' and is_active=true limit 1;
  if v_period='yearly' then
    select coalesce(nullif(value,'')::numeric,0) into v_price from public.platform_settings where key='worker_pro_yearly_price_ngn' and is_active=true limit 1;
    select coalesce(value,'') into v_plan_code from public.platform_settings where key='worker_pro_web_paystack_yearly_plan_code' and is_active=true limit 1;
    v_iso_period:='P1Y';
  else
    select coalesce(nullif(value,'')::numeric,0) into v_price from public.platform_settings where key='worker_pro_monthly_price_ngn' and is_active=true limit 1;
    select coalesce(value,'') into v_plan_code from public.platform_settings where key='worker_pro_web_paystack_plan_code' and is_active=true limit 1;
    v_iso_period:='P1M';
  end if;
  select coalesce(value,'') into v_terms_version from public.platform_settings where key='worker_pro_terms_version' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content' and is_active=true limit 1;
  if not coalesce(v_sales_enabled,false) then return jsonb_build_object('success',false,'error','Paid Worker plan sales are not open'); end if;
  if not public._legal_launch_gate_is_approved('worker_pro_web_sales') then return jsonb_build_object('success',false,'error','Paid Worker plan web sales are awaiting launch approval'); end if;
  if v_price<=0 or nullif(btrim(v_plan_code),'') is null then return jsonb_build_object('success',false,'error',initcap(v_period)||' billing is not configured'); end if;
  if nullif(btrim(v_terms_version),'') is null or length(btrim(v_terms_content))<100 then return jsonb_build_object('success',false,'error','Paid plan subscription terms are not published'); end if;
  v_terms_sha256:=encode(extensions.digest(convert_to(v_terms_content,'UTF8'),'sha256'),'hex');
  select exists(
    select 1 from public.worker_pro_terms_acceptances acceptance
    where acceptance.worker_id=v_worker.user_id
      and acceptance.terms_version=v_terms_version
      and acceptance.terms_sha256=v_terms_sha256
  ) into v_terms_accepted;
  if not coalesce(v_terms_accepted,false) then return jsonb_build_object('success',false,'error','Accept the current paid plan subscription terms before purchase'); end if;

  update public.booking_payments set status='expired',updated_at=now()
  where user_id=v_worker.user_id and purpose='worker_pro_subscription'
    and status='pending' and created_at<now()-interval '30 minutes';
  select * into v_existing from public.booking_payments
  where user_id=v_worker.user_id and purpose='worker_pro_subscription'
    and status='pending' order by created_at desc limit 1;
  if v_existing.id is not null then
    if v_existing.amount_total=v_price
       and coalesce(v_existing.metadata->>'plan_code','')=v_plan_code
       and coalesce(v_existing.metadata->>'terms_version','')=v_terms_version
       and coalesce(v_existing.metadata->>'billing_period','monthly')=v_period then
      return jsonb_build_object(
        'success',true,'reference',v_existing.paystack_reference,
        'amount',v_price,'plan_code',v_plan_code,'billing_period',v_period,
        'period',v_iso_period,'existing',true
      );
    end if;
    update public.booking_payments set status='expired',updated_at=now()
    where id=v_existing.id;
  end if;

  v_reference:='WHP-'||gen_random_uuid()::text;
  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,amount,amount_total,
    net_amount,amount_commission,currency,status,purpose,payment_method,
    paystack_reference,metadata,created_at,updated_at
  ) values(
    v_reference,v_worker.user_id,v_worker.user_id,'worker_subscription',
    'worker_subscription',v_price,v_price,v_price,0,'NGN','pending',
    'worker_pro_subscription','paystack',v_reference,jsonb_build_object(
      'source','create_worker_pro_web_payment',
      'plan','worker_pro','billing_period',v_period,
      'period',v_iso_period,'plan_code',v_plan_code,
      'terms_version',v_terms_version,'terms_sha256',v_terms_sha256,
      'price_snapshot_ngn',v_price
    ),now(),now()
  );
  return jsonb_build_object(
    'success',true,'reference',v_reference,'amount',v_price,
    'plan_code',v_plan_code,'billing_period',v_period,
    'period',v_iso_period,'existing',false
  );
exception when unique_violation then
  select * into v_existing from public.booking_payments
  where user_id=v_worker.user_id and purpose='worker_pro_subscription'
    and status='pending' order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object(
      'success',true,'reference',v_existing.paystack_reference,
      'amount',v_existing.amount_total,
      'plan_code',v_existing.metadata->>'plan_code',
      'billing_period',v_existing.metadata->>'billing_period',
      'period',v_existing.metadata->>'period','existing',true
    );
  end if;
  return jsonb_build_object('success',false,'error','Subscription checkout is already starting');
end;
$$;
revoke all on function public.create_worker_pro_web_payment(text) from public,anon;
grant execute on function public.create_worker_pro_web_payment(text) to authenticated,service_role;

create or replace function public.confirm_worker_pro_paystack_charge(
  p_reference text,
  p_transaction_id text,
  p_verified_amount numeric,
  p_currency text,
  p_subscription_code text,
  p_event_id text,
  p_event_time timestamptz,
  p_environment text,
  p_payload_sha256 text,
  p_safe_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_payment public.booking_payments;
  v_subscription public.worker_pro_subscriptions;
  v_result jsonb;
  v_period_start timestamptz:=coalesce(p_event_time,now());
  v_period_end timestamptz;
  v_billing_period text;
begin
  select * into v_payment from public.booking_payments
  where paystack_reference=p_reference and purpose='worker_pro_subscription'
  for update;
  if v_payment is null then return jsonb_build_object('success',false,'error','Paid plan payment not found'); end if;
  if v_payment.status in('paid','completed') then return jsonb_build_object('success',true,'already_processed',true); end if;
  if v_payment.status<>'pending' then return jsonb_build_object('success',false,'error','Paid plan payment is not pending'); end if;
  if upper(coalesce(p_currency,''))<>'NGN' then return jsonb_build_object('success',false,'error','Currency mismatch'); end if;
  if round(coalesce(v_payment.amount_total,v_payment.amount,0)*100)<>round(coalesce(p_verified_amount,0)*100) then return jsonb_build_object('success',false,'error','Amount mismatch'); end if;

  select * into v_subscription from public.worker_pro_subscriptions
  where worker_id=v_payment.user_id for update;
  if v_subscription.id is not null and v_subscription.provider<>'paystack'
     and v_subscription.status in('active','grace_period')
     and v_subscription.current_period_end>now() then
    update public.booking_payments set
      status='review_required',verified_amount=p_verified_amount,
      verified_at=now(),verification_source='webhook',updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'billing_conflict',true,'active_provider',v_subscription.provider,
        'incoming_provider','paystack','paystack_transaction_id',p_transaction_id
      )
    where id=v_payment.id;
    return jsonb_build_object(
      'success',false,'conflict',true,'active_provider',v_subscription.provider,
      'payment_id',v_payment.id
    );
  end if;

  v_billing_period:=coalesce(nullif(v_payment.metadata->>'billing_period',''),'monthly');
  if v_billing_period not in('monthly','yearly') then return jsonb_build_object('success',false,'error','Invalid billing period'); end if;
  v_period_end:=case when v_billing_period='yearly'
    then v_period_start+interval '1 year'
    else v_period_start+interval '1 month' end;

  update public.booking_payments set
    status='paid',paystack_transaction_id=nullif(btrim(coalesce(p_transaction_id,'')),''),
    verified_amount=p_verified_amount,verified_at=now(),verification_source='webhook',
    paid_at=v_period_start,webhook_processed=true,updated_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)
      ||jsonb_build_object('subscription_code',nullif(btrim(coalesce(p_subscription_code,'')),''))
      ||coalesce(p_safe_metadata,'{}'::jsonb)
  where id=v_payment.id;

  select public.record_worker_pro_subscription_event(
    v_payment.user_id,'paystack',v_payment.metadata->>'plan_code',p_subscription_code,
    p_event_id,'charge.success','active',v_period_start,v_period_start,v_period_end,
    false,true,p_verified_amount,'NGN',p_environment,p_payload_sha256,
    coalesce(p_safe_metadata,'{}'::jsonb)||jsonb_build_object('billing_period',v_billing_period)
  ) into v_result;
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
    'payment_id',v_payment.id,'billing_period',v_billing_period
  );
end;
$$;
revoke all on function public.confirm_worker_pro_paystack_charge(text,text,numeric,text,text,text,timestamptz,text,text,jsonb)
from public,anon,authenticated;
grant execute on function public.confirm_worker_pro_paystack_charge(text,text,numeric,text,text,text,timestamptz,text,text,jsonb)
to service_role;

-- Sponsored discovery is stored separately from organic ranking. One row is
-- one signed-in viewer seeing one matching Worker in one filter context on one
-- UTC day. Re-opening discovery updates the timestamp but cannot manufacture a
-- second unique impression.
create table if not exists public.worker_featured_placements(
  id uuid primary key default gen_random_uuid(),
  viewer_id text not null references public.profiles(user_id) on delete restrict,
  worker_id text not null references public.profiles(user_id) on delete restrict,
  context_key text not null,
  impression_day date not null default current_date,
  presented_at timestamptz not null default now(),
  profile_opened_at timestamptz,
  booking_id uuid references public.worker_bookings(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_featured_placements_people_check check(viewer_id<>worker_id),
  constraint worker_featured_placements_context_check check(context_key~'^[a-f0-9]{32}$')
);
drop index if exists public.worker_featured_unique_daily_context;
create unique index if not exists worker_featured_unique_daily_viewer
  on public.worker_featured_placements(viewer_id,worker_id,impression_day);
create index if not exists worker_featured_worker_time_idx
  on public.worker_featured_placements(worker_id,presented_at desc);
create unique index if not exists worker_featured_booking_unique
  on public.worker_featured_placements(booking_id) where booking_id is not null;
alter table public.worker_featured_placements enable row level security;
drop policy if exists worker_featured_rpc_only on public.worker_featured_placements;
create policy worker_featured_rpc_only on public.worker_featured_placements
for all to authenticated using(false) with check(false);
revoke all on table public.worker_featured_placements from public,anon,authenticated;
grant all on table public.worker_featured_placements to service_role;

-- Restore the block rule while retaining the Pro entitlement projection added
-- by the foundation migration. This is the unchanged organic result set.
drop function if exists public.get_public_workers(text,text,text);
create function public.get_public_workers(
  p_state text default null,
  p_city text default null,
  p_occupation text default null
)
returns table(
  user_id text,full_name text,username text,avatar_url text,bio text,
  state text,city text,local_government text,area text,
  worker_occupation text,worker_skills jsonb,worker_price integer,
  worker_bio text,worker_experience text,rating numeric,review_count integer,
  is_online boolean,last_seen timestamptz,services jsonb,coverage jsonb,
  pro_active boolean
)
language plpgsql
stable
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_marketplace_enabled boolean:=false;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select coalesce(lower(value) in('true','1','yes','on'),false)
    into v_marketplace_enabled from public.platform_settings
  where key='worker_marketplace_launch_enabled' and is_active=true limit 1;
  if not coalesce(v_marketplace_enabled,false) then return; end if;
  return query
  select
    profile.user_id,profile.full_name,profile.username,profile.avatar_url,
    profile.bio,profile.state,profile.city,profile.local_government,
    profile.area,profile.worker_occupation,profile.worker_skills,
    profile.worker_price,profile.worker_bio,profile.worker_experience,
    profile.rating,profile.review_count,profile.is_online,profile.last_seen,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',service.service_name,'price',service.price,
        'price_type',service.price_type
      )) from public.worker_services service
      where service.worker_id=profile.user_id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'state',coverage.state,'lga',coverage.lga,'areas',coverage.areas
      )) from public.worker_service_coverage coverage
      where coverage.worker_id=profile.user_id
    ),'[]'::jsonb),
    public.worker_pro_is_active(profile.user_id)
  from public.profiles profile
  where public.user_has_active_workspace(profile.user_id,'worker')
    and profile.worker_status='verified' and profile.worker_verified=true
    and profile.available=true
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
    and (
      not coalesce((select lower(value) in('true','1','yes','on')
        from public.platform_settings where key='worker_identity_checks_enabled'
        and is_active=true limit 1),false)
      or public.worker_identity_is_current(profile.user_id)
    )
    and (p_state is null
      or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state))
    and (p_city is null or profile.city ilike p_city
      or profile.local_government ilike p_city)
    and (p_occupation is null or profile.worker_occupation ilike p_occupation)
    and not exists(
      select 1 from public.worker_user_blocks blocked_pair
      where v_actor is not null and (
        (blocked_pair.blocker_user_id=v_actor
          and blocked_pair.blocked_user_id=profile.user_id)
        or (blocked_pair.blocker_user_id=profile.user_id
          and blocked_pair.blocked_user_id=v_actor)
      )
    )
  order by profile.rating desc nulls last,profile.review_count desc nulls last;
end;
$$;
revoke all on function public.get_public_workers(text,text,text) from public,anon;
grant execute on function public.get_public_workers(text,text,text) to authenticated,service_role;

create or replace function public.get_featured_workers(
  p_state text default null,
  p_city text default null,
  p_query text default null,
  p_limit integer default 3
)
returns table(
  user_id text,full_name text,username text,avatar_url text,bio text,
  state text,city text,local_government text,area text,
  worker_occupation text,worker_skills jsonb,worker_price integer,
  worker_bio text,worker_experience text,rating numeric,review_count integer,
  is_online boolean,last_seen timestamptz,services jsonb,coverage jsonb,
  pro_active boolean,featured_placement_id uuid
)
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_enabled boolean:=false;
  v_marketplace_enabled boolean:=false;
  v_slots integer:=3;
  v_limit integer;
  v_context text;
begin
  if (select auth.uid()) is null or v_actor is null then
    raise exception 'Active signed-in account required';
  end if;
  select coalesce(lower(value) in('true','1','yes','on'),false)
    into v_enabled from public.platform_settings
  where key='worker_featured_sales_enabled' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),false)
    into v_marketplace_enabled from public.platform_settings
  where key='worker_marketplace_launch_enabled' and is_active=true limit 1;
  select greatest(0,least(6,coalesce(nullif(value,'')::integer,3)))
    into v_slots from public.platform_settings
  where key='worker_featured_slot_count' and is_active=true limit 1;
  v_limit:=greatest(0,least(coalesce(p_limit,3),coalesce(v_slots,3),6));
  if not coalesce(v_enabled,false) or not coalesce(v_marketplace_enabled,false)
     or v_limit=0
     or not public._legal_launch_gate_is_approved('worker_featured_placement')
     or not public._legal_launch_gate_is_approved('worker_marketplace') then
    return;
  end if;
  v_context:=md5(lower(concat_ws('|',btrim(coalesce(p_state,'')),
    btrim(coalesce(p_city,'')),btrim(coalesce(p_query,'')))));

  return query
  with candidates as materialized (
    select profile.user_id
    from public.profiles profile
    where profile.user_id<>v_actor
      and public.user_has_active_workspace(profile.user_id,'worker')
      and profile.worker_status='verified' and profile.worker_verified=true
      and profile.available=true
      and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false)
      and public.worker_identity_is_current(profile.user_id)
      and public.worker_professional_profile_ready(profile.user_id)
      and public.worker_pro_is_active(profile.user_id)
      and (p_state is null or btrim(p_state)=''
        or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state))
      and (p_city is null or btrim(p_city)='' or profile.city ilike p_city
        or profile.local_government ilike p_city)
      and (
        p_query is null or btrim(p_query)=''
        or concat_ws(' ',profile.full_name,profile.username,
          profile.worker_occupation,profile.worker_bio,profile.state,
          profile.city,profile.local_government) ilike '%'||btrim(p_query)||'%'
        or exists(select 1 from public.worker_services service
          where service.worker_id=profile.user_id
            and service.service_name ilike '%'||btrim(p_query)||'%')
        or exists(select 1 from jsonb_array_elements_text(
          case when jsonb_typeof(profile.worker_skills)='array'
            then profile.worker_skills else '[]'::jsonb end
        ) skill(value) where skill.value ilike '%'||btrim(p_query)||'%')
      )
      and not exists(
        select 1 from public.worker_user_blocks blocked_pair where
          (blocked_pair.blocker_user_id=v_actor
            and blocked_pair.blocked_user_id=profile.user_id)
          or (blocked_pair.blocker_user_id=profile.user_id
            and blocked_pair.blocked_user_id=v_actor)
      )
    order by (
      select max(placement.presented_at)
      from public.worker_featured_placements placement
      where placement.worker_id=profile.user_id
    ) asc nulls first,md5(current_date::text||profile.user_id)
    limit v_limit
  ), placed as (
    insert into public.worker_featured_placements(
      viewer_id,worker_id,context_key,impression_day,presented_at,updated_at
    )
    select v_actor,candidate.user_id,v_context,current_date,now(),now()
    from candidates candidate
    on conflict(viewer_id,worker_id,impression_day) do update
    set context_key=excluded.context_key,presented_at=excluded.presented_at,
      updated_at=now()
    returning id,worker_id
  )
  select
    profile.user_id,profile.full_name,profile.username,profile.avatar_url,
    profile.bio,profile.state,profile.city,profile.local_government,
    profile.area,profile.worker_occupation,profile.worker_skills,
    profile.worker_price,profile.worker_bio,profile.worker_experience,
    profile.rating,profile.review_count,profile.is_online,profile.last_seen,
    coalesce((select jsonb_agg(jsonb_build_object(
      'name',service.service_name,'price',service.price,
      'price_type',service.price_type))
      from public.worker_services service
      where service.worker_id=profile.user_id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'state',coverage.state,'lga',coverage.lga,'areas',coverage.areas))
      from public.worker_service_coverage coverage
      where coverage.worker_id=profile.user_id),'[]'::jsonb),
    true,placed.id
  from placed join public.profiles profile on profile.user_id=placed.worker_id;
end;
$$;
revoke all on function public.get_featured_workers(text,text,text,integer)
from public,anon;
grant execute on function public.get_featured_workers(text,text,text,integer)
to authenticated,service_role;

create or replace function public.record_my_featured_profile_open(
  p_placement_id uuid
) returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null then raise exception 'Active signed-in account required'; end if;
  update public.worker_featured_placements
  set profile_opened_at=coalesce(profile_opened_at,now()),updated_at=now()
  where id=p_placement_id and viewer_id=v_actor;
  return found;
end;
$$;
revoke all on function public.record_my_featured_profile_open(uuid)
from public,anon;
grant execute on function public.record_my_featured_profile_open(uuid)
to authenticated,service_role;

create or replace function public.record_my_featured_booking_request(
  p_placement_id uuid,
  p_booking_id uuid
) returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_booking public.worker_bookings;
  v_placement public.worker_featured_placements;
begin
  if v_actor is null then raise exception 'Active signed-in account required'; end if;
  select * into v_booking from public.worker_bookings
  where id=p_booking_id and user_id=v_actor limit 1;
  select * into v_placement from public.worker_featured_placements
  where id=p_placement_id and viewer_id=v_actor limit 1;
  if v_booking.id is null or v_placement.id is null
     or v_booking.worker_id<>v_placement.worker_id then
    raise exception 'Featured booking does not match this placement';
  end if;
  update public.worker_featured_placements
  set booking_id=p_booking_id,updated_at=now()
  where id=p_placement_id and booking_id is null;
  return found;
end;
$$;
revoke all on function public.record_my_featured_booking_request(uuid,uuid)
from public,anon;
grant execute on function public.record_my_featured_booking_request(uuid,uuid)
to authenticated,service_role;

-- Pro insights are computed from authoritative booking, review and sponsored
-- placement records. No forecast, inferred income or estimated conversion is
-- returned.
create or replace function public.get_my_worker_work_insights(
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_worker text;
  v_days integer:=case when p_days in(30,90,365) then p_days else 30 end;
  v_from timestamptz;
begin
  select profile.user_id into v_worker from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false) limit 1;
  if v_worker is null then raise exception 'Active Worker workspace required'; end if;
  if not public.worker_pro_is_active(v_worker) then
    raise exception 'An active paid Worker plan is required for Work Insights';
  end if;
  v_from:=now()-make_interval(days=>v_days);
  return jsonb_build_object(
    'range_days',v_days,'from',v_from,'generated_at',now(),
    'completed_jobs',(select count(*) from public.worker_bookings booking
      where booking.worker_id=v_worker and booking.status='approved_released'
        and coalesce(booking.completed_at,booking.updated_at)>=v_from),
    'released_earnings_ngn',(select coalesce(sum(booking.worker_receives),0)
      from public.worker_bookings booking where booking.worker_id=v_worker
        and booking.status='approved_released'
        and coalesce(booking.completed_at,booking.updated_at)>=v_from),
    'active_jobs',(select count(*) from public.worker_bookings booking
      where booking.worker_id=v_worker and booking.status in(
        'booking_requested','negotiating','waiting_payment','confirmed',
        'in_progress','completed_pending_approval','disputed')),
    'rating',coalesce((select round(avg(review.rating)::numeric,2)
      from public.worker_booking_reviews review
      join public.worker_bookings booking on booking.id=review.booking_id
      where review.worker_id=v_worker and booking.status='approved_released'
        and review.created_at>=v_from),0),
    'review_count',(select count(*) from public.worker_booking_reviews review
      join public.worker_bookings booking on booking.id=review.booking_id
      where review.worker_id=v_worker and booking.status='approved_released'
        and review.created_at>=v_from),
    'repeat_customers',(select count(*) from(
      select booking.user_id from public.worker_bookings booking
      where booking.worker_id=v_worker and booking.status='approved_released'
        and coalesce(booking.completed_at,booking.updated_at)>=v_from
      group by booking.user_id having count(*)>=2
    ) repeated),
    'worker_cancelled_jobs',(select count(*) from public.worker_bookings booking
      where booking.worker_id=v_worker and booking.status='cancelled'
        and booking.cancelled_by=v_worker and booking.updated_at>=v_from),
    'featured',jsonb_build_object(
      'signed_in_unique_impressions',(select count(*)
        from public.worker_featured_placements placement
        where placement.worker_id=v_worker and placement.created_at>=v_from),
      'unique_profile_opens',(select count(*)
        from public.worker_featured_placements placement
        where placement.worker_id=v_worker and placement.created_at>=v_from
          and placement.profile_opened_at is not null),
      'booking_requests',(select count(*)
        from public.worker_featured_placements placement
        join public.worker_bookings booking on booking.id=placement.booking_id
        where placement.worker_id=v_worker and booking.created_at>=v_from)
    ),
    'definitions',jsonb_build_object(
      'completed_jobs','Jobs with status Completed and earnings released.',
      'released_earnings_ngn','Worker amount on completed, released WeHouse jobs only.',
      'active_jobs','Current non-terminal Worker bookings, including disputes.',
      'rating','Average of verified reviews on completed WeHouse jobs in this period.',
      'repeat_customers','Customers with at least two completed jobs in this period.',
      'worker_cancelled_jobs','Jobs recorded as cancelled by this Worker.',
      'featured','Unique signed-in daily placements, profile opens and real booking requests linked to Sponsored cards.'
    )
  );
end;
$$;
revoke all on function public.get_my_worker_work_insights(integer)
from public,anon;
grant execute on function public.get_my_worker_work_insights(integer)
to authenticated,service_role;

-- Quotes and invoices remain readable after cancellation or expiry. An active
-- plan is required only to create, edit, send or change them. Payment truth is
-- separate from document workflow truth: Workers can mark an offline payment,
-- but only a released, amount-matching WeHouse booking is labelled paid
-- through WeHouse.
create table if not exists public.worker_work_documents(
  id uuid primary key default gen_random_uuid(),
  document_number text not null unique,
  worker_id text not null references public.profiles(user_id) on delete restrict,
  customer_id text not null references public.profiles(user_id) on delete restrict,
  booking_id uuid not null references public.worker_bookings(id) on delete restrict,
  document_type text not null check(document_type in('quote','invoice')),
  title text not null,
  items jsonb not null,
  subtotal numeric(12,2) not null check(subtotal>=0),
  total numeric(12,2) not null check(total>=0),
  currency text not null default 'NGN' check(currency='NGN'),
  document_status text not null default 'draft'
    check(document_status in('draft','sent','accepted','declined','void')),
  payment_status text not null default 'not_applicable'
    check(payment_status in('not_applicable','unpaid','marked_paid_by_worker')),
  note text,
  sent_at timestamptz,
  responded_at timestamptz,
  marked_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_work_documents_people_check check(worker_id<>customer_id),
  constraint worker_work_documents_items_check check(
    jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 20
  ),
  constraint worker_work_documents_title_check check(length(btrim(title)) between 2 and 120),
  constraint worker_work_documents_note_check check(note is null or length(note)<=1200)
);
create index if not exists worker_work_documents_worker_time_idx
  on public.worker_work_documents(worker_id,created_at desc);
create index if not exists worker_work_documents_customer_time_idx
  on public.worker_work_documents(customer_id,created_at desc);
create index if not exists worker_work_documents_booking_idx
  on public.worker_work_documents(booking_id);
alter table public.worker_work_documents enable row level security;
drop policy if exists worker_work_documents_rpc_only on public.worker_work_documents;
create policy worker_work_documents_rpc_only on public.worker_work_documents
for all to authenticated using(false) with check(false);
revoke all on table public.worker_work_documents from public,anon,authenticated;
grant all on table public.worker_work_documents to service_role;

create or replace function public.get_my_worker_work_documents(
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
begin
  if v_actor is null then raise exception 'Active signed-in account required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',document.id,'document_number',document.document_number,
      'worker_id',document.worker_id,'customer_id',document.customer_id,
      'booking_id',document.booking_id,'booking_code',booking.booking_code,
      'service_type',booking.service_type,
      'document_type',document.document_type,'title',document.title,
      'items',document.items,'subtotal',document.subtotal,'total',document.total,
      'currency',document.currency,'document_status',document.document_status,
      'payment_status',case
        when document.document_type='invoice'
          and booking.status='approved_released'
          and document.total=coalesce(nullif(booking.negotiated_amount,0),booking.agreed_amount)
          then 'paid_through_wehouse'
        else document.payment_status end,
      'payment_label',case
        when document.document_type<>'invoice' then 'Not applicable'
        when booking.status='approved_released'
          and document.total=coalesce(nullif(booking.negotiated_amount,0),booking.agreed_amount)
          then 'Paid through WeHouse'
        when document.payment_status='marked_paid_by_worker'
          then 'Marked paid by Worker — not verified by WeHouse'
        else 'Unpaid' end,
      'note',document.note,'sent_at',document.sent_at,
      'responded_at',document.responded_at,
      'marked_paid_at',document.marked_paid_at,
      'created_at',document.created_at,'updated_at',document.updated_at
    ) order by document.created_at desc)
    from (
      select source.* from public.worker_work_documents source
      where source.worker_id=v_actor
        or (source.customer_id=v_actor and source.document_status<>'draft')
      order by source.created_at desc limit v_limit
    ) document
    join public.worker_bookings booking on booking.id=document.booking_id
  ),'[]'::jsonb);
end;
$$;
revoke all on function public.get_my_worker_work_documents(integer)
from public,anon;
grant execute on function public.get_my_worker_work_documents(integer)
to authenticated,service_role;

create or replace function public.save_my_worker_work_document(
  p_document_id uuid,
  p_booking_id uuid,
  p_document_type text,
  p_title text,
  p_items jsonb,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_worker text;
  v_booking public.worker_bookings;
  v_existing public.worker_work_documents;
  v_kind text:=lower(btrim(coalesce(p_document_type,'')));
  v_title text:=btrim(coalesce(p_title,''));
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_item jsonb;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_items jsonb:='[]'::jsonb;
  v_total numeric:=0;
  v_id uuid;
  v_number text;
begin
  select profile.user_id into v_worker from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false) limit 1;
  if v_worker is null then raise exception 'Active Worker workspace required'; end if;
  if not public.worker_pro_is_active(v_worker) then
    raise exception 'An active paid Worker plan is required to create or edit documents';
  end if;
  if v_kind not in('quote','invoice') then raise exception 'Choose quote or invoice'; end if;
  if length(v_title)<2 or length(v_title)>120 then raise exception 'Document title must be between 2 and 120 characters'; end if;
  if v_note is not null and length(v_note)>1200 then raise exception 'Document note is too long'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Add between 1 and 20 line items';
  end if;
  select * into v_booking from public.worker_bookings
  where id=p_booking_id and worker_id=v_worker limit 1;
  if v_booking.id is null then raise exception 'Choose one of your WeHouse jobs'; end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_description:=btrim(coalesce(v_item->>'description',''));
    if length(v_description)<2 or length(v_description)>160 then
      raise exception 'Each line needs a description between 2 and 160 characters';
    end if;
    begin
      v_quantity:=coalesce(nullif(v_item->>'quantity','')::numeric,1);
      v_unit_price:=coalesce(nullif(v_item->>'unit_price','')::numeric,0);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Line quantity and price must be valid numbers';
    end;
    if v_quantity<=0 or v_quantity>10000 or v_unit_price<0 or v_unit_price>10000000 then
      raise exception 'Line quantity or price is outside the allowed range';
    end if;
    v_quantity:=round(v_quantity,2);
    v_unit_price:=round(v_unit_price,2);
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'description',v_description,'quantity',v_quantity,
      'unit_price',v_unit_price,'line_total',round(v_quantity*v_unit_price,2)
    ));
    v_total:=v_total+round(v_quantity*v_unit_price,2);
  end loop;
  if v_total>100000000 then raise exception 'Document total is too large'; end if;

  if p_document_id is null then
    v_number:=case when v_kind='quote' then 'WHQ-' else 'WHI-' end
      ||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10));
    insert into public.worker_work_documents(
      document_number,worker_id,customer_id,booking_id,document_type,title,
      items,subtotal,total,payment_status,note,created_at,updated_at
    ) values(
      v_number,v_worker,v_booking.user_id,v_booking.id,v_kind,v_title,
      v_items,v_total,v_total,case when v_kind='invoice' then 'unpaid'
        else 'not_applicable' end,v_note,now(),now()
    ) returning id into v_id;
  else
    select * into v_existing from public.worker_work_documents
    where id=p_document_id and worker_id=v_worker for update;
    if v_existing.id is null then raise exception 'Document not found'; end if;
    if v_existing.document_status<>'draft' then
      raise exception 'Only a draft document can be edited';
    end if;
    update public.worker_work_documents set
      customer_id=v_booking.user_id,booking_id=v_booking.id,
      document_type=v_kind,title=v_title,items=v_items,subtotal=v_total,
      total=v_total,payment_status=case when v_kind='invoice' then 'unpaid'
        else 'not_applicable' end,note=v_note,updated_at=now()
    where id=v_existing.id returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_my_worker_work_document(uuid,uuid,text,text,jsonb,text)
from public,anon;
grant execute on function public.save_my_worker_work_document(uuid,uuid,text,text,jsonb,text)
to authenticated,service_role;

create or replace function public.send_my_worker_work_document(
  p_document_id uuid
) returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_worker text;
begin
  select profile.user_id into v_worker from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker') limit 1;
  if v_worker is null or not public.worker_pro_is_active(v_worker) then
    raise exception 'An active paid Worker plan is required to send documents';
  end if;
  update public.worker_work_documents set document_status='sent',sent_at=now(),updated_at=now()
  where id=p_document_id and worker_id=v_worker and document_status='draft';
  return found;
end;
$$;
revoke all on function public.send_my_worker_work_document(uuid) from public,anon;
grant execute on function public.send_my_worker_work_document(uuid) to authenticated,service_role;

create or replace function public.respond_to_my_worker_quote(
  p_document_id uuid,
  p_accept boolean
) returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_customer text:=public.current_profile_user_id();
begin
  if v_customer is null then raise exception 'Active signed-in account required'; end if;
  update public.worker_work_documents set
    document_status=case when coalesce(p_accept,false) then 'accepted' else 'declined' end,
    responded_at=now(),updated_at=now()
  where id=p_document_id and customer_id=v_customer
    and document_type='quote' and document_status='sent';
  return found;
end;
$$;
revoke all on function public.respond_to_my_worker_quote(uuid,boolean)
from public,anon;
grant execute on function public.respond_to_my_worker_quote(uuid,boolean)
to authenticated,service_role;

create or replace function public.mark_my_worker_invoice_paid_offline(
  p_document_id uuid
) returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_worker text;
begin
  select profile.user_id into v_worker from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker') limit 1;
  if v_worker is null or not public.worker_pro_is_active(v_worker) then
    raise exception 'An active paid Worker plan is required to update documents';
  end if;
  update public.worker_work_documents set payment_status='marked_paid_by_worker',
    marked_paid_at=now(),updated_at=now()
  where id=p_document_id and worker_id=v_worker and document_type='invoice'
    and document_status in('sent','accepted') and payment_status='unpaid';
  return found;
end;
$$;
revoke all on function public.mark_my_worker_invoice_paid_offline(uuid)
from public,anon;
grant execute on function public.mark_my_worker_invoice_paid_offline(uuid)
to authenticated,service_role;

-- Priority support changes queue order for ordinary platform-help cases only.
-- Safety, fraud, payment, refund and dispute cases use the same risk-derived
-- priority for everyone and never receive a paid-plan decision advantage.
create or replace function public.create_my_support_case(
  p_subject text,
  p_category text default 'general',
  p_source_type text default null,
  p_source_id text default null,
  p_source_snapshot jsonb default '{}'::jsonb,
  p_priority text default 'normal'
) returns uuid
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_result_id uuid;
  v_subject text;
  v_category text:=lower(coalesce(nullif(btrim(p_category),''),'general'));
  v_priority text:='normal';
  v_basis text:='standard';
  v_pro boolean:=false;
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active WeHouse account required'; end if;
  v_subject:=nullif(btrim(coalesce(p_subject,'')),'');
  if v_subject is null then raise exception 'Tell us what you need help with'; end if;
  if v_actor.role='worker' then v_pro:=public.worker_pro_is_active(v_actor.user_id); end if;
  if v_category~'(safety|security|fraud|harassment|emergency)' then
    v_priority:='urgent'; v_basis:='safety_risk';
  elsif v_category~'(payment|refund|dispute|chargeback|arrival|access)' then
    v_priority:='high'; v_basis:='protected_flow';
  elsif v_pro then
    v_priority:='high'; v_basis:='paid_plan_ordinary_support';
  end if;
  insert into public.partner_support_conversations(
    partner_id,requester_role,subject,status,category,context_type,context_id,
    context_snapshot,priority,channel_kind,case_number,created_at,updated_at
  ) values(
    v_actor.user_id,v_actor.role,v_subject,'open',v_category,
    'support_case',nullif(btrim(coalesce(p_source_id,'')),''),
    coalesce(p_source_snapshot,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
      'source_type',nullif(btrim(coalesce(p_source_type,'')),''),
      'source_id',nullif(btrim(coalesce(p_source_id,'')),''),
      'routing_basis',v_basis,
      'requested_priority_ignored',nullif(btrim(coalesce(p_priority,'')),'')
    )),v_priority,'support_case',
    'WHC-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10)),
    now(),now()
  ) returning id into v_result_id;
  return v_result_id;
end;
$$;
revoke all on function public.create_my_support_case(text,text,text,text,jsonb,text)
from public,anon;
grant execute on function public.create_my_support_case(text,text,text,text,jsonb,text)
to authenticated,service_role;

-- Regulated sales gates are operator-controlled and fail closed when approval
-- is absent, revoked or expired.
create or replace function public._guard_regulated_platform_launch_setting()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_enabled boolean:=lower(btrim(coalesce(new.value,''))) in('true','1','yes','on');
  v_gate_key text;
begin
  v_gate_key:=case new.key
    when 'worker_marketplace_launch_enabled' then 'worker_marketplace'
    when 'worker_identity_checks_enabled' then 'worker_identity_checks'
    when 'worker_pro_sales_enabled' then 'worker_pro_web_sales'
    when 'worker_pro_ios_sales_enabled' then 'worker_pro_ios_sales'
    when 'worker_pro_android_sales_enabled' then 'worker_pro_android_sales'
    when 'worker_featured_sales_enabled' then 'worker_featured_placement'
    else null
  end;
  if v_gate_key is not null and v_enabled
     and not public._legal_launch_gate_is_approved(v_gate_key) then
    raise exception 'Regulated launch gate % has no current recorded approval',v_gate_key;
  end if;
  return new;
end;
$$;
revoke all on function public._guard_regulated_platform_launch_setting()
from public,anon,authenticated;

drop trigger if exists guard_regulated_platform_launch_setting on public.platform_settings;
create trigger guard_regulated_platform_launch_setting
before insert or update of value on public.platform_settings
for each row
when(new.key in(
  'worker_marketplace_launch_enabled','worker_identity_checks_enabled',
  'worker_pro_sales_enabled','worker_pro_ios_sales_enabled',
  'worker_pro_android_sales_enabled','worker_featured_sales_enabled'
)) execute function public._guard_regulated_platform_launch_setting();

create or replace function public._close_revoked_legal_launch_gate()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_setting_key text;
begin
  if new.status='approved' and (new.expires_at is null or new.expires_at>now()) then return new; end if;
  v_setting_key:=case new.gate_key
    when 'worker_marketplace' then 'worker_marketplace_launch_enabled'
    when 'worker_identity_checks' then 'worker_identity_checks_enabled'
    when 'worker_pro_web_sales' then 'worker_pro_sales_enabled'
    when 'worker_pro_ios_sales' then 'worker_pro_ios_sales_enabled'
    when 'worker_pro_android_sales' then 'worker_pro_android_sales_enabled'
    when 'worker_featured_placement' then 'worker_featured_sales_enabled'
    else null
  end;
  if v_setting_key is not null then
    update public.platform_settings set value='false',updated_at=now()
    where key=v_setting_key and lower(btrim(value)) in('true','1','yes','on');
  end if;
  return new;
end;
$$;
revoke all on function public._close_revoked_legal_launch_gate()
from public,anon,authenticated;

delete from public.function_execution_registry
where function_signature='create_worker_pro_web_payment()';
insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  case
    when p.proname in(
      'get_my_worker_pro','accept_current_worker_pro_terms',
      'create_worker_pro_web_payment','get_public_workers',
      'get_featured_workers','record_my_featured_profile_open',
      'record_my_featured_booking_request','get_my_worker_work_insights',
      'get_my_worker_work_documents','save_my_worker_work_document',
      'send_my_worker_work_document','respond_to_my_worker_quote',
      'mark_my_worker_invoice_paid_offline','create_my_support_case'
    ) then 'approved_client_rpc'
    else 'approved_service_only'
  end,
  case
    when p.proname='create_worker_pro_web_payment' then 'Reviewed Worker chooses a configured monthly or yearly web plan; active cross-provider entitlement blocks checkout'
    when p.proname='get_my_worker_pro' then 'Actor-scoped paid Worker plans and provider-verified entitlement projection'
    when p.proname='accept_current_worker_pro_terms' then 'Signed-in Reviewed Worker accepts the exact current paid plan terms'
    when p.proname='get_featured_workers' then 'Separate Sponsored results with legal gate, eligibility checks and unique signed-in impression records'
    when p.proname='get_my_worker_work_insights' then 'Active paid Worker reads metrics computed only from authoritative WeHouse records'
    when p.proname in('get_my_worker_work_documents','save_my_worker_work_document','send_my_worker_work_document','respond_to_my_worker_quote','mark_my_worker_invoice_paid_offline') then 'Participant-scoped quote and invoice lifecycle with explicit payment truth'
    when p.proname='create_my_support_case' then 'Server-derived support priority without paid influence on safety, dispute, refund or payment decisions'
    else 'Service-only provider lifecycle authority with cross-provider conflict protection'
  end,now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'get_my_worker_pro','accept_current_worker_pro_terms',
  'create_worker_pro_web_payment','record_worker_pro_subscription_event',
  'confirm_worker_pro_paystack_charge','worker_pro_billing_period_for_product',
  'get_public_workers','get_featured_workers',
  'record_my_featured_profile_open','record_my_featured_booking_request',
  'get_my_worker_work_insights','get_my_worker_work_documents',
  'save_my_worker_work_document','send_my_worker_work_document',
  'respond_to_my_worker_quote','mark_my_worker_invoice_paid_offline',
  'create_my_support_case'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

do $$
begin
  if exists(
    select 1 from public.function_execution_registry
    where review_state='requires_review'
  ) then
    raise exception 'Function execution registry still contains unresolved entries';
  end if;
end;
$$;

commit;
