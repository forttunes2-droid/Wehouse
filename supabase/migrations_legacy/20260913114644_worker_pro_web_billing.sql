begin;

alter table public.booking_payments
  drop constraint if exists booking_payments_purpose_check;
alter table public.booking_payments
  add constraint booking_payments_purpose_check check(
    purpose in (
      'apartment_reservation','apartment_rent','worker_booking',
      'hotel_reservation','hotel_booking','rent_plan_contribution',
      'worker_verification','worker_pro_subscription','other'
    )
  );

create unique index if not exists booking_payments_one_pending_worker_pro
  on public.booking_payments(user_id,purpose)
  where status='pending' and purpose='worker_pro_subscription';

create or replace function public.create_worker_pro_web_payment()
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_worker public.profiles;
  v_sales_enabled boolean:=false;
  v_price numeric:=0;
  v_plan_code text:='';
  v_terms_version text:='';
  v_terms_content text:='';
  v_terms_sha256 text:='';
  v_terms_accepted boolean:=false;
  v_reference text;
  v_existing public.booking_payments;
begin
  select * into v_worker from public.profiles
  where auth_id=(select auth.uid())::text
    and role='worker'
    and worker_status='verified'
    and worker_verified=true
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_worker is null then return jsonb_build_object('success',false,'error','A WeHouse Reviewed Worker account is required'); end if;
  if public.worker_pro_is_active(v_worker.user_id) then return jsonb_build_object('success',false,'error','WeHouse Pro is already active'); end if;
  select coalesce(lower(value) in ('true','1','yes','on'),false) into v_sales_enabled from public.platform_settings where key='worker_pro_sales_enabled' and is_active=true limit 1;
  select coalesce(nullif(value,'')::numeric,0) into v_price from public.platform_settings where key='worker_pro_monthly_price_ngn' and is_active=true limit 1;
  select coalesce(value,'') into v_plan_code from public.platform_settings where key='worker_pro_web_paystack_plan_code' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_version from public.platform_settings where key='worker_pro_terms_version' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content' and is_active=true limit 1;
  if not coalesce(v_sales_enabled,false) then return jsonb_build_object('success',false,'error','WeHouse Pro sales are not open'); end if;
  if coalesce(v_price,0)<=0 then return jsonb_build_object('success',false,'error','WeHouse Pro monthly price is not configured'); end if;
  if nullif(btrim(v_plan_code),'') is null then return jsonb_build_object('success',false,'error','Paystack monthly plan is not configured'); end if;
  if nullif(btrim(v_terms_version),'') is null or length(btrim(v_terms_content))<100 then
    return jsonb_build_object('success',false,'error','WeHouse Pro subscription terms are not published');
  end if;
  v_terms_sha256:=encode(extensions.digest(convert_to(v_terms_content,'UTF8'),'sha256'),'hex');
  select exists(
    select 1 from public.worker_pro_terms_acceptances acceptance
    where acceptance.worker_id=v_worker.user_id
      and acceptance.terms_version=v_terms_version
      and acceptance.terms_sha256=v_terms_sha256
  ) into v_terms_accepted;
  if not coalesce(v_terms_accepted,false) then
    return jsonb_build_object('success',false,'error','Accept the current WeHouse Pro subscription terms before purchase');
  end if;

  update public.booking_payments set status='expired',updated_at=now()
  where user_id=v_worker.user_id and purpose='worker_pro_subscription'
    and status='pending' and created_at<now()-interval '30 minutes';
  select * into v_existing from public.booking_payments
  where user_id=v_worker.user_id and purpose='worker_pro_subscription' and status='pending'
  order by created_at desc limit 1;
  if v_existing.id is not null then
    if v_existing.amount_total=v_price
       and coalesce(v_existing.metadata->>'plan_code','')=v_plan_code
       and coalesce(v_existing.metadata->>'terms_version','')=v_terms_version then
      return jsonb_build_object('success',true,'reference',v_existing.paystack_reference,'amount',v_price,'plan_code',v_plan_code,'existing',true);
    end if;
    update public.booking_payments set status='expired',updated_at=now() where id=v_existing.id;
  end if;

  v_reference:='WHP-'||gen_random_uuid()::text;
  insert into public.booking_payments(
    payment_reference,user_id,payer_user_id,type,booking_type,amount,amount_total,
    net_amount,amount_commission,currency,status,purpose,payment_method,
    paystack_reference,metadata,created_at,updated_at
  ) values(
    v_reference,v_worker.user_id,v_worker.user_id,'worker_subscription','worker_subscription',
    v_price,v_price,v_price,0,'NGN','pending','worker_pro_subscription','paystack',
    v_reference,jsonb_build_object(
      'source','create_worker_pro_web_payment','plan','worker_pro_monthly',
      'period','P1M','plan_code',v_plan_code,'terms_version',v_terms_version,
      'terms_sha256',v_terms_sha256,
      'price_snapshot_ngn',v_price
    ),now(),now()
  );
  return jsonb_build_object('success',true,'reference',v_reference,'amount',v_price,'plan_code',v_plan_code,'existing',false);
exception when unique_violation then
  select * into v_existing from public.booking_payments
  where user_id=v_worker.user_id and purpose='worker_pro_subscription' and status='pending'
  order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('success',true,'reference',v_existing.paystack_reference,'amount',v_existing.amount_total,'plan_code',v_existing.metadata->>'plan_code','existing',true);
  end if;
  return jsonb_build_object('success',false,'error','Subscription checkout is already starting');
end;
$$;

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
  v_result jsonb;
  v_period_start timestamptz:=coalesce(p_event_time,now());
begin
  select * into v_payment from public.booking_payments
  where paystack_reference=p_reference and purpose='worker_pro_subscription'
  for update;
  if v_payment is null then return jsonb_build_object('success',false,'error','WeHouse Pro payment not found'); end if;
  if v_payment.status in ('paid','completed') then return jsonb_build_object('success',true,'already_processed',true); end if;
  if v_payment.status<>'pending' then return jsonb_build_object('success',false,'error','WeHouse Pro payment is not pending'); end if;
  if upper(coalesce(p_currency,''))<>'NGN' then return jsonb_build_object('success',false,'error','Currency mismatch'); end if;
  if round(coalesce(v_payment.amount_total,v_payment.amount,0)*100)<>round(coalesce(p_verified_amount,0)*100) then
    return jsonb_build_object('success',false,'error','Amount mismatch');
  end if;

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
    p_event_id,'charge.success','active',v_period_start,v_period_start,
    v_period_start+interval '1 month',false,true,p_verified_amount,'NGN',
    p_environment,p_payload_sha256,coalesce(p_safe_metadata,'{}'::jsonb)
  ) into v_result;
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object('payment_id',v_payment.id);
end;
$$;

revoke all on function public.create_worker_pro_web_payment() from public,anon;
grant execute on function public.create_worker_pro_web_payment() to authenticated,service_role;
revoke all on function public.confirm_worker_pro_paystack_charge(text,text,numeric,text,text,text,timestamptz,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_worker_pro_paystack_charge(text,text,numeric,text,text,text,timestamptz,text,text,jsonb) to service_role;

commit;
