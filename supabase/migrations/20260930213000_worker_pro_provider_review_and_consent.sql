-- Verified Paystack refund/dispute notices pause Worker Pro independently of
-- subscription lifecycle events. A later renewal cannot clear Finance review.
begin;
create table public.worker_pro_provider_reviews (
  payment_id uuid primary key references public.booking_payments(id),
  worker_id text not null references public.profiles(user_id),
  reason text not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  restored boolean,
  resolution_reason text
);
create index worker_pro_provider_reviews_open on public.worker_pro_provider_reviews(worker_id)
  where resolved_at is null;
create table public.worker_pro_provider_review_events (
  event_key text primary key,
  payment_id uuid not null references public.worker_pro_provider_reviews(payment_id),
  event_type text not null,
  environment text not null,
  received_at timestamptz not null default now()
);
alter table public.worker_pro_provider_reviews enable row level security;
alter table public.worker_pro_provider_review_events enable row level security;
revoke all on public.worker_pro_provider_reviews,public.worker_pro_provider_review_events from public,anon,authenticated;
grant all on public.worker_pro_provider_reviews,public.worker_pro_provider_review_events to service_role;

create or replace function public.pause_worker_pro_on_provider_event(
  p_reference text,p_event_type text,p_environment text,p_event_key text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_payment public.booking_payments; v_subscription public.worker_pro_subscriptions;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'Service role required'; end if;
  if p_event_type not in ('refund.pending','refund.processing','refund.processed','charge.dispute.create')
    or p_environment not in ('test','live') or length(coalesce(p_event_key,''))<8 then
    raise exception 'Invalid provider event'; end if;
  select * into v_payment from public.booking_payments where paystack_reference=p_reference
    and purpose='worker_pro_subscription' for update;
  if v_payment.id is null then return false; end if;
  perform 1 from public.profiles where user_id=v_payment.user_id for update;
  select * into v_subscription from public.worker_pro_subscriptions where worker_id=v_payment.user_id for update;
  if v_payment.status not in ('paid','completed')
    or coalesce(v_payment.metadata->>'paystack_environment',
      case when v_subscription.provider='paystack' then
        case v_subscription.environment when 'production' then 'live' when 'sandbox' then 'test' end end)
      is distinct from p_environment then raise exception 'Provider payment mismatch'; end if;
  if exists(select 1 from public.worker_pro_provider_review_events where event_key=p_event_key) then
    if not exists(select 1 from public.worker_pro_provider_review_events
      where event_key=p_event_key and payment_id=v_payment.id and event_type=p_event_type
        and environment=p_environment) then raise exception 'Provider event conflict'; end if;
    return true;
  end if;
  insert into public.worker_pro_provider_reviews(payment_id,worker_id,reason)
    values(v_payment.id,v_payment.user_id,p_event_type)
    on conflict(payment_id) do update set reason=excluded.reason,opened_at=now(),
      resolved_at=null,restored=null,resolution_reason=null;
  insert into public.worker_pro_provider_review_events(event_key,payment_id,event_type,environment)
    values(p_event_key,v_payment.id,p_event_type,p_environment);
  update public.booking_payments set status='expired',updated_at=now()
    where user_id=v_payment.user_id and purpose='worker_pro_subscription' and status='pending';
  return true;
end $$;
revoke all on function public.pause_worker_pro_on_provider_event(text,text,text,text) from public,anon,authenticated;
grant execute on function public.pause_worker_pro_on_provider_event(text,text,text,text) to service_role;

create or replace function public.worker_pro_is_active(p_worker_id text)
returns boolean language sql stable security definer set search_path='pg_catalog','public' as $$
  select exists(select 1 from public.worker_pro_subscriptions s where s.worker_id=p_worker_id
    and s.status in ('active','grace_period') and s.current_period_end>now())
    and not exists(select 1 from public.worker_pro_provider_reviews r
      where r.worker_id=p_worker_id and r.resolved_at is null)
$$;
-- Preserve the existing execution grants of this replaced function.

create or replace function public.resolve_worker_pro_provider_review(
  p_payment_id uuid,p_restore boolean,p_reason text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_review public.worker_pro_provider_reviews;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'Service role required'; end if;
  if p_restore is null or length(btrim(coalesce(p_reason,'')))<12 then raise exception 'Finance reason required'; end if;
  select * into v_review from public.worker_pro_provider_reviews
    where payment_id=p_payment_id;
  if v_review.payment_id is null or v_review.resolved_at is not null then raise exception 'No open Worker Pro review'; end if;
  perform 1 from public.profiles where user_id=v_review.worker_id for update;
  select * into v_review from public.worker_pro_provider_reviews where payment_id=p_payment_id for update;
  if v_review.resolved_at is not null then raise exception 'No open Worker Pro review'; end if;
  if not p_restore then
    update public.worker_pro_subscriptions set status='revoked',
      current_period_end=least(current_period_end,now()),auto_renews=false,updated_at=now()
      where worker_id=v_review.worker_id and provider='paystack';
  end if;
  update public.worker_pro_provider_reviews set resolved_at=now(),restored=p_restore,
    resolution_reason=btrim(p_reason) where payment_id=p_payment_id;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values('service_role','worker_pro_provider_review','worker_pro_subscription',v_review.worker_id,
    jsonb_build_object('payment_id',p_payment_id,'restored',p_restore,'reason',p_reason)::text,now());
  return true;
end $$;
revoke all on function public.resolve_worker_pro_provider_review(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.resolve_worker_pro_provider_review(uuid,boolean,text) to service_role;

create or replace function public.reject_worker_pro_checkout_under_review()
returns trigger language plpgsql set search_path='pg_catalog','public' as $$
begin
  if new.purpose='worker_pro_subscription' and new.status='pending'
    and exists(select 1 from public.worker_pro_provider_reviews
      where worker_id=new.user_id and resolved_at is null) then
    raise exception 'Worker Pro payment is under Finance review';
  end if;
  return new;
end $$;
create trigger worker_pro_checkout_review_guard before insert or update on public.booking_payments
  for each row execute function public.reject_worker_pro_checkout_under_review();
revoke all on function public.reject_worker_pro_checkout_under_review() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_my_worker_pro()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$;
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
    'under_review',exists(select 1 from public.worker_pro_provider_reviews where worker_id=v_worker_id and resolved_at is null),
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
      'Quotes and invoices with clear payment labels'
    )
  );
end;
$function$


-- Serialize consent removal and note saving on the same Worker profile row.
create or replace function public.set_my_worker_customer_record_consent(p_worker_id text,p_consent boolean)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null or not exists(select 1 from public.worker_bookings
      where user_id=v_actor and worker_id=p_worker_id and status='approved_released') then
    raise exception 'A completed job with this Worker is required'; end if;
  perform 1 from public.profiles where user_id=p_worker_id for update;
  if coalesce(p_consent,false) then
    insert into public.worker_customer_record_consents(worker_id,customer_id) values(p_worker_id,v_actor)
    on conflict do nothing;
  else
    delete from public.worker_customer_record_consents where worker_id=p_worker_id and customer_id=v_actor;
    delete from public.worker_pro_customer_notes where worker_id=p_worker_id and customer_id=v_actor;
  end if;
  return coalesce(p_consent,false);
end $$;
create or replace function public.save_my_worker_pro_customer_note(p_customer_id text,p_note text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.worker_pro_current_actor();
begin
  perform 1 from public.profiles where user_id=v_actor for update;
  if not exists(select 1 from public.worker_bookings b
    join public.worker_customer_record_consents c on c.worker_id=b.worker_id and c.customer_id=b.user_id
    where b.worker_id=v_actor and b.user_id=p_customer_id and b.status='approved_released') then
    raise exception 'Customer has not consented to a record'; end if;
  if length(btrim(coalesce(p_note,'')))>1000 then raise exception 'Note is too long'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then
    delete from public.worker_pro_customer_notes where worker_id=v_actor and customer_id=p_customer_id;
  else
    insert into public.worker_pro_customer_notes(worker_id,customer_id,note)
      values(v_actor,p_customer_id,btrim(p_note))
    on conflict(worker_id,customer_id) do update set note=excluded.note,updated_at=now();
  end if;
  return true;
end $$;
commit;
