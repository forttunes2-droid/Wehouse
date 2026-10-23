-- Forward alignment of existing paid tools; no sales or pricing is enabled.
-- Canonical sources: 20260930213000, 20261001090000, 20261001110000,
-- and the plan reader from 20261007201000. Existing data is preserved.
-- Verified Paystack refund/dispute notices pause Worker Pro independently of
-- subscription lifecycle events. A later renewal cannot clear Finance review.
create table if not exists public.worker_pro_provider_reviews (
  payment_id uuid primary key references public.booking_payments(id),
  worker_id text not null references public.profiles(user_id),
  reason text not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  restored boolean,
  resolution_reason text
);
create index if not exists worker_pro_provider_reviews_open on public.worker_pro_provider_reviews(worker_id)
  where resolved_at is null;
create table if not exists public.worker_pro_provider_review_events (
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
  if coalesce(nullif(auth.jwt()->>'role',''),current_setting('request.jwt.claim.role',true),'')<>'service_role' then
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
  if coalesce(nullif(auth.jwt()->>'role',''),current_setting('request.jwt.claim.role',true),'')<>'service_role' then
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
drop trigger if exists worker_pro_checkout_review_guard on public.booking_payments;
create trigger worker_pro_checkout_review_guard before insert or update on public.booking_payments
  for each row execute function public.reject_worker_pro_checkout_under_review();
revoke all on function public.reject_worker_pro_checkout_under_review() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_my_worker_pro()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
;
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

create table if not exists public.worker_pro_job_costs (
 worker_id text not null references public.profiles(user_id) on delete cascade,
 booking_id uuid not null references public.worker_bookings(id) on delete cascade,
 cost_ngn numeric(12,2) not null check(cost_ngn>=0 and cost_ngn<=10000000),
 note text not null default '' check(length(note)<=600),
 updated_at timestamptz not null default now(),
 primary key(worker_id,booking_id)
);

-- The reconciliation snapshot used cost_ngn; the earlier migration used amount.
-- Preserve the populated value. The next migration makes the compatibility
-- amount a generated projection; two existing writable values must agree first.
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='worker_pro_job_costs' and column_name='amount') then
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='worker_pro_job_costs' and column_name='cost_ngn') then
   if exists(select 1 from public.worker_pro_job_costs where amount is distinct from cost_ngn) then
    raise exception 'Conflicting job-cost values require reviewed reconciliation';
   end if;
  else
   alter table public.worker_pro_job_costs rename column amount to cost_ngn;
  end if;
 end if;
end $$;
alter table public.worker_pro_job_costs drop constraint if exists worker_pro_job_costs_note_check;
alter table public.worker_pro_job_costs add constraint worker_pro_job_costs_note_check check(length(coalesce(note,''))<=600);
alter table public.worker_pro_job_costs enable row level security;
revoke all on public.worker_pro_job_costs from public,anon,authenticated;
grant all on public.worker_pro_job_costs to service_role;
-- Replace the exact RPC signature to restore its client-facing p_amount name.
-- No CASCADE: any unreviewed database dependency stops this transaction.
drop function if exists public.save_my_worker_pro_job_cost(uuid,numeric,text);
create or replace function public.save_my_worker_pro_job_cost(p_booking_id uuid,p_amount numeric,p_note text default '')
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.worker_pro_current_actor();
begin
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<0 or p_amount>10000000 or length(coalesce(p_note,''))>600 then raise exception 'Invalid job cost'; end if;
 if not exists(select 1 from public.worker_bookings where id=p_booking_id and worker_id=actor
   and status in ('confirmed','in_progress','completed_pending_approval','approved_released')) then raise exception 'Job unavailable'; end if;
 insert into public.worker_pro_job_costs(worker_id,booking_id,cost_ngn,note) values(actor,p_booking_id,round(p_amount,2),btrim(coalesce(p_note,'')))
 on conflict(worker_id,booking_id) do update set cost_ngn=excluded.cost_ngn,note=excluded.note,updated_at=now();
 return true;
end $$;
revoke all on function public.save_my_worker_pro_job_cost(uuid,numeric,text) from public,anon;
grant execute on function public.save_my_worker_pro_job_cost(uuid,numeric,text) to authenticated;
create or replace function public.get_my_worker_pro_job_costs()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.worker_pro_current_actor();
begin
 return coalesce((select jsonb_agg(to_jsonb(j) order by j.scheduled_date desc) from (
 select b.id,b.booking_code,b.service_type,b.scheduled_date,b.status,
   case when b.status='approved_released' then b.worker_receives else null end released_earnings_ngn,
   c.cost_ngn cost_ngn,coalesce(c.note,'') note
 from public.worker_bookings b left join public.worker_pro_job_costs c on c.worker_id=actor and c.booking_id=b.id
 where b.worker_id=actor and b.status in ('confirmed','in_progress','completed_pending_approval','approved_released')
 order by b.scheduled_date desc,b.id limit 150
 ) j),'[]'::jsonb);
end $$;
revoke all on function public.get_my_worker_pro_job_costs() from public,anon;
grant execute on function public.get_my_worker_pro_job_costs() to authenticated;

alter table public.partner_pro_tasks add column if not exists repeat_days integer check(repeat_days between 1 and 365),
 add column if not exists previous_task_id uuid unique references public.partner_pro_tasks(id);
create or replace function public.advance_partner_pro_recurring_task()
returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
 if old.status='done' and new.status='open' and exists(select 1 from public.partner_pro_tasks where previous_task_id=old.id) then
   raise exception 'This repeating task already has a next occurrence';
 end if;
 if old.status='open' and new.status='done' and old.repeat_days is not null and old.due_on is not null then
   insert into public.partner_pro_tasks(owner_id,asset_kind,asset_id,title,due_on,repeat_days,previous_task_id)
   values(old.owner_id,old.asset_kind,old.asset_id,old.title,greatest(old.due_on,current_date)+old.repeat_days,old.repeat_days,old.id)
   on conflict(previous_task_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.advance_partner_pro_recurring_task() from public,anon,authenticated;
drop trigger if exists advance_partner_pro_recurring_task on public.partner_pro_tasks;
create trigger advance_partner_pro_recurring_task before update of status on public.partner_pro_tasks
 for each row execute function public.advance_partner_pro_recurring_task();
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

CREATE OR REPLACE FUNCTION public.create_my_partner_pro_recurring_task(p_kind text, p_asset_id text, p_title text, p_due_on date, p_repeat_days integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare task_id uuid;
begin
 if public.current_profile_user_id() is null
  or not public.current_actor_has_workspace('property_partner',null)
  or not public.partner_pro_is_active(public.current_profile_user_id())
  or not public.partner_pro_owns_asset(p_kind,p_asset_id) then
  raise exception 'Owned active Property Partner Pro asset required';
 end if;
 if p_repeat_days is not null and (p_repeat_days not between 1 and 365 or p_due_on is null) then raise exception 'Repeating tasks need a due date and a 1 to 365 day interval'; end if;
 task_id:=public.save_my_partner_pro_task(p_kind,p_asset_id,p_title,p_due_on,null,false);
 update public.partner_pro_tasks set repeat_days=p_repeat_days where id=task_id;
 return task_id;
end $function$;
revoke all on function public.create_my_partner_pro_recurring_task(text,text,text,date,integer) from public,anon;
grant execute on function public.create_my_partner_pro_recurring_task(text,text,text,date,integer) to authenticated;
revoke all on function public.get_my_worker_pro() from public,anon;
grant execute on function public.get_my_worker_pro() to authenticated;
notify pgrst, 'reload schema';
