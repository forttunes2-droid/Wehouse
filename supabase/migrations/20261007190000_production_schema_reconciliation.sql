-- Production schema reconciliation generated from the verified test schema; test-only bootstrap tables are excluded.
create table if not exists public.accommodation_no_show_reviews (no_show_review_id uuid primary key default gen_random_uuid(),subject_type text not null,subject_id text not null,requested_by text not null,property_ready_evidence text[] not null,explanation text not null,arrival_deadline_at timestamptz not null,rate_terms_policy_version_id uuid not null,status text not null default 'submitted',reviewed_by text,reviewed_at timestamptz,decision_reason text,release_action_id uuid,caution_refund_action_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),constraint accommodation_no_show_reviews_subject_type_check check(subject_type=any(array['short_let','hotel']::text[])),constraint accommodation_no_show_reviews_status_check check(status=any(array['submitted','approved','rejected','cancelled']::text[])),constraint accommodation_no_show_reviews_property_ready_evidence_check check(cardinality(property_ready_evidence) between 1 and 8),constraint accommodation_no_show_reviews_explanation_check check(char_length(btrim(explanation)) between 10 and 2000),constraint accommodation_no_show_reviews_requested_by_fkey foreign key(requested_by) references public.profiles(user_id) on delete restrict,constraint accommodation_no_show_reviews_reviewed_by_fkey foreign key(reviewed_by) references public.profiles(user_id) on delete restrict,constraint accommodation_no_show_reviews_rate_terms_policy_version_id_fkey foreign key(rate_terms_policy_version_id) references public.creator_policy_versions(policy_version_id),constraint accommodation_no_show_reviews_release_action_id_fkey foreign key(release_action_id) references public.financial_action_outbox(financial_action_id),constraint accommodation_no_show_reviews_caution_refund_action_id_fkey foreign key(caution_refund_action_id) references public.financial_action_outbox(financial_action_id));
create table if not exists public.listing_reviews (review_id uuid primary key default gen_random_uuid(),listing_id uuid not null,reservation_id text not null unique,user_id text not null,rating integer not null,comment text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),constraint listing_reviews_rating_check check(rating between 1 and 5),constraint listing_reviews_listing_id_fkey foreign key(listing_id) references public.listings(id) on delete cascade,constraint listing_reviews_reservation_id_fkey foreign key(reservation_id) references public.reservations(id) on delete restrict,constraint listing_reviews_user_id_fkey foreign key(user_id) references public.profiles(user_id) on delete restrict);
create table if not exists public.partner_pro_subscriptions (partner_id text primary key,subscription_code text unique,customer_code text,plan_code text not null,billing_period text not null,price_ngn numeric not null,environment text not null,auto_renews boolean not null default true,updated_at timestamptz not null default now(),provider_event_at timestamptz,constraint partner_pro_subscriptions_partner_id_fkey foreign key(partner_id) references public.profiles(user_id) on delete cascade,constraint partner_pro_subscriptions_billing_period_check check(billing_period=any(array['monthly','yearly']::text[])),constraint partner_pro_subscriptions_environment_check check(environment=any(array['test','live']::text[])),constraint partner_pro_subscriptions_price_ngn_check check(price_ngn>0));
create table if not exists public.property_change_requests (change_request_id uuid primary key default gen_random_uuid(),listing_id uuid not null,requested_by text not null,change_type text not null,proposed_changes jsonb not null,reason text not null,materiality text not null,requires_reinspection boolean not null default false,status text not null default 'submitted',reviewed_by text,reviewed_at timestamptz,decision_reason text,reinspection_reference text,before_snapshot jsonb not null,after_snapshot jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),published_at timestamptz,constraint property_change_requests_change_type_check check(change_type=any(array['price','photos','renovation']::text[])),constraint property_change_requests_materiality_check check(materiality=any(array['commercial','media','material']::text[])),constraint property_change_requests_status_check check(status=any(array['submitted','changes_requested','awaiting_reinspection','rejected','published','cancelled']::text[])),constraint property_change_requests_listing_id_fkey foreign key(listing_id) references public.listings(id) on delete cascade,constraint property_change_requests_requested_by_fkey foreign key(requested_by) references public.profiles(user_id),constraint property_change_requests_reviewed_by_fkey foreign key(reviewed_by) references public.profiles(user_id));
alter table public.hotel_bookings add column if not exists adult_count integer not null default 1; alter table public.hotel_bookings add column if not exists child_count integer not null default 0; alter table public.hotel_bookings add column if not exists infant_count integer not null default 0; alter table public.hotel_bookings add column if not exists pet_count integer not null default 0; alter table public.hotel_bookings add column if not exists party_details_set boolean not null default false; alter table public.hotel_bookings add column if not exists cancellation_policy_version_id uuid; alter table public.hotel_rate_plans add column if not exists cancellation_template text not null default 'standard'; alter table public.hotel_rate_plans add column if not exists cancellation_policy_version_id uuid; alter table public.hotel_rooms add column if not exists pets_allowed boolean not null default false; alter table public.listings add column if not exists pets_allowed boolean not null default false; alter table public.listings add column if not exists minimum_stay_nights integer; alter table public.listings add column if not exists maximum_stay_nights integer; alter table public.listings add column if not exists non_refundable_rate_enabled boolean not null default false; alter table public.listings add column if not exists non_refundable_discount_percent numeric(5,2); alter table public.listings add column if not exists rating numeric(3,2); alter table public.listings add column if not exists review_count integer not null default 0; alter table public.reservations add column if not exists adult_count integer not null default 1; alter table public.reservations add column if not exists child_count integer not null default 0; alter table public.reservations add column if not exists infant_count integer not null default 0; alter table public.reservations add column if not exists pet_count integer not null default 0; alter table public.reservations add column if not exists party_details_set boolean not null default false; alter table public.reservations add column if not exists short_stay_rate_type text; alter table public.reservations add column if not exists short_stay_discount_percent_snapshot numeric(5,2); alter table public.reservations add column if not exists short_stay_cancellation_policy_snapshot jsonb; alter table public.reservations add column if not exists short_stay_cancellation_policy_version_id uuid; alter table public.reservations add column if not exists short_stay_rate_terms_policy_version_id uuid; alter table public.worker_pro_job_costs add column if not exists cost_ngn numeric not null default 0;
do $recon$ begin if not exists (select 1 from pg_constraint where conname='hotel_bookings_cancellation_policy_version_id_fkey' and conrelid='public.hotel_bookings'::regclass) then execute $stmt$alter table public.hotel_bookings add constraint hotel_bookings_cancellation_policy_version_id_fkey foreign key(cancellation_policy_version_id) references public.creator_policy_versions(policy_version_id)$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='hotel_rate_plans_cancellation_policy_version_id_fkey' and conrelid='public.hotel_rate_plans'::regclass) then execute $stmt$alter table public.hotel_rate_plans add constraint hotel_rate_plans_cancellation_policy_version_id_fkey foreign key(cancellation_policy_version_id) references public.creator_policy_versions(policy_version_id)$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='hotel_rate_plans_cancellation_template_check' and conrelid='public.hotel_rate_plans'::regclass) then execute $stmt$alter table public.hotel_rate_plans add constraint hotel_rate_plans_cancellation_template_check check(cancellation_template=any(array['standard','non_refundable','standard_legacy']::text[]))$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='listings_maximum_stay_nights_check' and conrelid='public.listings'::regclass) then execute $stmt$alter table public.listings add constraint listings_maximum_stay_nights_check check(maximum_stay_nights is null or maximum_stay_nights between 1 and 365)$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='listings_minimum_stay_nights_check' and conrelid='public.listings'::regclass) then execute $stmt$alter table public.listings add constraint listings_minimum_stay_nights_check check(minimum_stay_nights is null or minimum_stay_nights between 1 and 365)$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='listings_non_refundable_discount_percent_check' and conrelid='public.listings'::regclass) then execute $stmt$alter table public.listings add constraint listings_non_refundable_discount_percent_check check(non_refundable_discount_percent is null or (non_refundable_discount_percent>0 and non_refundable_discount_percent<100))$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='listings_stay_night_order_check' and conrelid='public.listings'::regclass) then execute $stmt$alter table public.listings add constraint listings_stay_night_order_check check(minimum_stay_nights is null or maximum_stay_nights is null or maximum_stay_nights>=minimum_stay_nights)$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='reservations_short_stay_cancellation_policy_version_id_fkey' and conrelid='public.reservations'::regclass) then execute $stmt$alter table public.reservations add constraint reservations_short_stay_cancellation_policy_version_id_fkey foreign key(short_stay_cancellation_policy_version_id) references public.creator_policy_versions(policy_version_id)$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='reservations_short_stay_discount_snapshot_check' and conrelid='public.reservations'::regclass) then execute $stmt$alter table public.reservations add constraint reservations_short_stay_discount_snapshot_check check(short_stay_discount_percent_snapshot is null or short_stay_discount_percent_snapshot between 0 and 30)$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='reservations_short_stay_rate_terms_policy_version_id_fkey' and conrelid='public.reservations'::regclass) then execute $stmt$alter table public.reservations add constraint reservations_short_stay_rate_terms_policy_version_id_fkey foreign key(short_stay_rate_terms_policy_version_id) references public.creator_policy_versions(policy_version_id)$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='reservations_short_stay_rate_type_check' and conrelid='public.reservations'::regclass) then execute $stmt$alter table public.reservations add constraint reservations_short_stay_rate_type_check check(short_stay_rate_type is null or short_stay_rate_type=any(array['standard','non_refundable']::text[]))$stmt$; end if; end $recon$; do $recon$ begin if not exists (select 1 from pg_constraint where conname='worker_pro_job_costs_cost_ngn_check' and conrelid='public.worker_pro_job_costs'::regclass) then execute $stmt$alter table public.worker_pro_job_costs add constraint worker_pro_job_costs_cost_ngn_check check(cost_ngn between 0 and 10000000)$stmt$; end if; end $recon$;
create index if not exists partner_pro_subscription_customer_plan on public.partner_pro_subscriptions(customer_code,plan_code,environment) where customer_code is not null and auto_renews; create index if not exists property_change_requests_listing_created_idx on public.property_change_requests(listing_id,created_at desc); create index if not exists property_change_requests_review_queue_idx on public.property_change_requests(status,created_at) where status in ('submitted','awaiting_reinspection'); create unique index if not exists property_change_requests_one_open_kind on public.property_change_requests(listing_id,change_type) where status in ('submitted','changes_requested','awaiting_reinspection'); create index if not exists listing_reviews_listing_created_idx on public.listing_reviews(listing_id,created_at desc); create index if not exists listing_reviews_user_idx on public.listing_reviews(user_id,created_at desc); create unique index if not exists accommodation_no_show_one_open_subject on public.accommodation_no_show_reviews(subject_type,subject_id) where status='submitted'; create index if not exists accommodation_no_show_subject_idx on public.accommodation_no_show_reviews(subject_type,subject_id); create index if not exists accommodation_no_show_requester_idx on public.accommodation_no_show_reviews(requested_by,created_at desc); create index if not exists accommodation_no_show_review_queue on public.accommodation_no_show_reviews(status,created_at); create index if not exists accommodation_no_show_policy_idx on public.accommodation_no_show_reviews(rate_terms_policy_version_id); create index if not exists accommodation_no_show_reviewer_idx on public.accommodation_no_show_reviews(reviewed_by) where reviewed_by is not null; create index if not exists accommodation_no_show_release_action_idx on public.accommodation_no_show_reviews(release_action_id) where release_action_id is not null; create index if not exists accommodation_no_show_caution_action_idx on public.accommodation_no_show_reviews(caution_refund_action_id) where caution_refund_action_id is not null;

CREATE OR REPLACE FUNCTION public.cancel_my_hotel_booking(p_booking_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id text:=public.current_profile_user_id();
  v_changed integer;
begin
  if v_user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  update public.hotel_bookings
  set status='cancelled',
      payment_status=case when payment_status='paid'
        then payment_status else 'expired' end,
      updated_at=now()
  where booking_id=p_booking_id and user_id=v_user_id
    and status='pending' and payment_status<>'paid';
  get diagnostics v_changed=row_count;
  if v_changed=0 then
    raise exception 'Only your unpaid pending Hotel booking can be cancelled';
  end if;
  update public.booking_payments
  set status='cancelled',updated_at=now()
  where hotel_booking_id=p_booking_id and user_id=v_user_id
    and purpose='hotel_booking' and status='pending';
  return true;
end
$function$;
revoke all on function public.cancel_my_hotel_booking(p_booking_id integer) from public, anon, authenticated, service_role;

grant execute on function public.cancel_my_hotel_booking(p_booking_id integer) to service_role;
grant execute on function public.cancel_my_hotel_booking(p_booking_id integer) to authenticated;

CREATE OR REPLACE FUNCTION public.confirm_partner_pro_paystack_charge(p_reference text, p_transaction_id text, p_amount_minor bigint, p_environment text, p_source text, p_customer_code text DEFAULT NULL::text, p_subscription_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_payment public.booking_payments; v_end timestamptz; v_period text; v_recurring boolean;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
 if p_source not in ('webhook','edge_function') or p_environment not in ('test','live') or nullif(btrim(coalesce(p_transaction_id,'')),'') is null then raise exception 'Invalid provider receipt'; end if;
 select * into v_payment from public.booking_payments where paystack_reference=p_reference and purpose='partner_pro_access' for update;
 if v_payment.id is null then raise exception 'Partner Pro payment not found'; end if;
 if v_payment.status in ('paid','completed') then
   if v_payment.paystack_transaction_id is distinct from p_transaction_id then raise exception 'Transaction conflict'; end if;
   return jsonb_build_object('success',true,'already_processed',true);
 end if;
 if v_payment.currency<>'NGN' or round(v_payment.amount_total*100)<>p_amount_minor
   or v_payment.metadata->>'paystack_environment' is distinct from p_environment then raise exception 'Amount, currency or environment mismatch'; end if;
 if exists(select 1 from public.booking_payments where paystack_transaction_id=p_transaction_id and id<>v_payment.id) then raise exception 'Transaction belongs to another payment'; end if;
 if v_payment.status='review_required' then return jsonb_build_object('success',false,'requires_review',true,'error','This charge is under Finance review'); end if;
 if v_payment.status<>'pending' then
   update public.booking_payments set status='review_required',paystack_transaction_id=p_transaction_id,
     verified_amount=amount_total,verified_at=now(),verification_source=p_source,webhook_processed=true,updated_at=now() where id=v_payment.id;
   return jsonb_build_object('success',false,'requires_review',true,'error','This charged checkout expired; Finance will review it');
 end if;
 v_period:=v_payment.metadata->>'billing_period'; v_recurring:=coalesce((v_payment.metadata->>'auto_renew')::boolean,false);
 if v_period not in ('monthly','yearly') then raise exception 'Invalid access period'; end if;
 perform 1 from public.profiles where user_id=v_payment.user_id for update;
 if not found then raise exception 'Partner account missing'; end if;
 select current_period_end into v_end from public.partner_pro_entitlements where partner_id=v_payment.user_id for update;
 v_end:=greatest(coalesce(v_end,now()),now())+case when v_period='yearly' then interval '1 year' else interval '1 month' end;
 update public.booking_payments set status='paid',paystack_transaction_id=p_transaction_id,verified_amount=amount_total,verified_at=now(),
   verification_source=p_source,paid_at=now(),webhook_processed=true,updated_at=now(),
   metadata=metadata||jsonb_build_object('paystack_customer_code',p_customer_code,'paystack_subscription_code',p_subscription_code)
   where id=v_payment.id;
 insert into public.partner_pro_entitlements(partner_id,current_period_end,last_payment_id) values(v_payment.user_id,v_end,v_payment.id)
 on conflict(partner_id) do update set current_period_end=excluded.current_period_end,last_payment_id=excluded.last_payment_id,updated_at=now();
 if v_recurring then
   insert into public.partner_pro_subscriptions(partner_id,subscription_code,customer_code,plan_code,billing_period,price_ngn,environment,auto_renews)
   values(v_payment.user_id,nullif(p_subscription_code,''),nullif(p_customer_code,''),v_payment.metadata->>'plan_code',v_period,v_payment.amount_total,p_environment,true)
   on conflict(partner_id) do update set subscription_code=excluded.subscription_code,customer_code=excluded.customer_code,
     plan_code=excluded.plan_code,billing_period=excluded.billing_period,price_ngn=excluded.price_ngn,
     environment=excluded.environment,auto_renews=true,updated_at=now();
 end if;
 return jsonb_build_object('success',true,'current_period_end',v_end);
end $function$;
revoke all on function public.confirm_partner_pro_paystack_charge(p_reference text, p_transaction_id text, p_amount_minor bigint, p_environment text, p_source text, p_customer_code text, p_subscription_code text) from public, anon, authenticated, service_role;

grant execute on function public.confirm_partner_pro_paystack_charge(p_reference text, p_transaction_id text, p_amount_minor bigint, p_environment text, p_source text, p_customer_code text, p_subscription_code text) to service_role;

CREATE OR REPLACE FUNCTION public.create_my_partner_pro_payment(p_billing_period text, p_auto_renew boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_price numeric; v_sales boolean;
 v_period text:=lower(btrim(coalesce(p_billing_period,''))); v_version text; v_terms text; v_sha text;
 v_plan text; v_payment public.booking_payments; v_reference text;
begin
 if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then raise exception 'Property Partner workspace required'; end if;
 if v_period not in ('monthly','yearly') then raise exception 'Choose monthly or yearly access'; end if;
 perform 1 from public.profiles where user_id=v_actor and not coalesce(deleted,false) and not coalesce(suspended,false)
   and not coalesce(banned,false) for update;
 if not found then raise exception 'Account is not active'; end if;
 if exists(select 1 from public.partner_pro_entitlements where partner_id=v_actor and review_started_at is not null) then raise exception 'Partner Pro payment is under review'; end if;
 if exists(select 1 from public.partner_pro_subscriptions where partner_id=v_actor and auto_renews) then raise exception 'Manage your current renewing subscription before buying another period'; end if;
 select lower(value) in ('true','1','yes','on') into v_sales from public.platform_settings where key='partner_pro_sales_enabled' and is_active;
 select coalesce(nullif(value,'')::numeric,0) into v_price from public.platform_settings
   where key=case when v_period='yearly' then 'partner_pro_yearly_price_ngn' else 'partner_pro_monthly_price_ngn' end and is_active;
 select value into v_plan from public.platform_settings
   where key=case when v_period='yearly' then 'partner_pro_yearly_plan_code' else 'partner_pro_monthly_plan_code' end and is_active;
 select value into v_version from public.platform_settings where key='partner_pro_terms_version' and is_active;
 select value into v_terms from public.platform_settings where key='partner_pro_terms_content' and is_active;
 if not coalesce(v_sales,false) or coalesce(v_price,0)<=0 then raise exception 'Partner Pro purchase is unavailable'; end if;
 if p_auto_renew and (coalesce(v_plan,'') !~ '^PLN_[A-Za-z0-9]+$') then raise exception 'Recurring checkout is not configured for this period'; end if;
 if length(btrim(coalesce(v_terms,'')))<100 or length(btrim(coalesce(v_version,'')))<1 then raise exception 'Partner Pro terms are unavailable'; end if;
 v_sha:=encode(extensions.digest(convert_to(v_terms,'UTF8'),'sha256'),'hex');
 if not exists(select 1 from public.partner_pro_terms_acceptances where partner_id=v_actor and terms_version=v_version and terms_sha256=v_sha) then raise exception 'Accept the current terms first'; end if;
 update public.booking_payments set status='expired',updated_at=now() where user_id=v_actor and purpose='partner_pro_access' and status='pending'
   and (created_at<now()-interval '30 minutes' or amount_total is distinct from v_price or metadata->>'billing_period' is distinct from v_period
     or metadata->>'terms_sha256' is distinct from v_sha or coalesce((metadata->>'auto_renew')::boolean,false) is distinct from p_auto_renew);
 select * into v_payment from public.booking_payments where user_id=v_actor and purpose='partner_pro_access' and status='pending' for update;
 if v_payment.id is not null then return jsonb_build_object('success',true,'reference',v_payment.paystack_reference,'existing',true); end if;
 v_reference:='WHPP-'||gen_random_uuid()::text;
 insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,type,booking_type,amount,amount_total,net_amount,
   amount_commission,currency,status,purpose,payment_method,metadata)
 values(v_reference,v_reference,v_actor,v_actor,'partner_pro_access','partner_pro_access',v_price,v_price,v_price,0,'NGN','pending',
   'partner_pro_access','paystack',jsonb_build_object('billing_period',v_period,'terms_version',v_version,
     'terms_sha256',v_sha,'price_snapshot_ngn',v_price,'auto_renew',p_auto_renew,'plan_code',case when p_auto_renew then v_plan else null end));
 return jsonb_build_object('success',true,'reference',v_reference,'existing',false);
end $function$;
revoke all on function public.create_my_partner_pro_payment(p_billing_period text, p_auto_renew boolean) from public, anon, authenticated, service_role;

grant execute on function public.create_my_partner_pro_payment(p_billing_period text, p_auto_renew boolean) to service_role;
grant execute on function public.create_my_partner_pro_payment(p_billing_period text, p_auto_renew boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.create_my_property_inspection_batch_v4(p_batch_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_auth_id text:=(select auth.uid())::text;
  v_actor text:=public.current_profile_user_id();
  v_result jsonb;
  v_created jsonb;
  v_item jsonb;
  v_position integer;
  v_request_id uuid;
  v_max_guests integer;
  v_display_name text;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  if public.account_identity_checks_enabled()
     and not public.account_identity_is_current(v_actor) then
    raise exception 'Complete the private identity check before submitting properties';
  end if;
  if not exists(
    select 1 from public.property_submission_batches batch
    where batch.id=p_batch_id
      and batch.partner_user_id=v_auth_id
      and batch.status in ('draft','submitting')
    for update
  ) then raise exception 'Property submission batch not found'; end if;
  update public.property_submission_batches
  set status='submitting',updated_at=now() where id=p_batch_id;
  v_result:=public.create_my_property_inspection_batch_v3(p_items);
  for v_created in select value from jsonb_array_elements(v_result->'requests') loop
    v_position:=(v_created->>'position')::integer;
    v_request_id:=(v_created->>'id')::uuid;
    v_item:=p_items->(v_position-1);
    v_max_guests:=nullif(v_item->>'max_guests','')::integer;
    v_display_name:=nullif(btrim(coalesce(v_item->>'property_display_name','')),'');
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and coalesce(v_max_guests,0)<1 then
      raise exception 'Property %: Short Let guest capacity must be at least 1',v_position;
    end if;
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and v_display_name is null then
      raise exception 'Property %: Short Let property or host name is required',v_position;
    end if;
    update public.inspection_requests set
      submission_schema_version=2,
      hotel_program=case when v_item->>'property_type'='hotel'
        then v_item->'hotel_program' else null end,
      max_guests=case
        when v_item->>'property_type'='apartment'
          and v_item->>'sub_type'='short_let'
        then v_max_guests else null end,
      property_display_name=case
        when v_item->>'property_type'='apartment'
          and v_item->>'sub_type'='short_let'
        then v_display_name else null end,
      submission_batch_id=p_batch_id,
      updated_at=now()
    where id=v_request_id and owner_id=v_actor;
    update public.property_submission_items
    set inspection_request_id=v_request_id,status='submitted',updated_at=now()
    where batch_id=p_batch_id and position=v_position-1;
  end loop;
  update public.property_submission_batches
  set status='submitted',submitted_at=now(),updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  return v_result||jsonb_build_object('batch_id',p_batch_id);
exception when others then
  update public.property_submission_batches
  set status='draft',updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  raise;
end;
$function$;
revoke all on function public.create_my_property_inspection_batch_v4(p_batch_id uuid, p_items jsonb) from public, anon, authenticated, service_role;

grant execute on function public.create_my_property_inspection_batch_v4(p_batch_id uuid, p_items jsonb) to service_role;
grant execute on function public.create_my_property_inspection_batch_v4(p_batch_id uuid, p_items jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.create_my_verified_hotel_review(p_hotel_id integer, p_rating integer, p_comment text DEFAULT NULL::text)
 RETURNS hotel_reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user text:=public.current_profile_user_id();
  v_review public.hotel_reviews;
  v_comment text:=nullif(btrim(coalesce(p_comment,'')),'');
begin
  if v_user is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if length(coalesce(v_comment,''))>2000 then
    raise exception 'Review must be 2000 characters or fewer';
  end if;
  if not exists(
    select 1 from public.hotel_bookings
    where hotel_id=p_hotel_id and user_id=v_user and payment_status='paid'
      and checked_in_at is not null
      and (checked_out_at is not null or status='completed')
      and status in ('checked_out','completed')
  ) then
    raise exception 'A verified paid stay is required before reviewing this Hotel';
  end if;

  insert into public.hotel_reviews(hotel_id,user_id,rating,comment)
  values(p_hotel_id,v_user,p_rating,v_comment)
  on conflict(hotel_id,user_id) do update
  set rating=excluded.rating,comment=excluded.comment,created_at=now()
  returning * into v_review;

  update public.hotels hotel set
    rating=(select round(avg(review.rating)::numeric,1)
      from public.hotel_reviews review where review.hotel_id=p_hotel_id),
    review_count=(select count(*) from public.hotel_reviews review
      where review.hotel_id=p_hotel_id),
    updated_at=now()
  where hotel.hotel_id=p_hotel_id;
  return v_review;
end
$function$;
revoke all on function public.create_my_verified_hotel_review(p_hotel_id integer, p_rating integer, p_comment text) from public, anon, authenticated, service_role;

grant execute on function public.create_my_verified_hotel_review(p_hotel_id integer, p_rating integer, p_comment text) to service_role;
grant execute on function public.create_my_verified_hotel_review(p_hotel_id integer, p_rating integer, p_comment text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_my_verified_listing_review(p_listing_id text, p_rating integer, p_comment text DEFAULT NULL::text)
 RETURNS listing_reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_reservation public.reservations;
  v_review public.listing_reviews;
  v_comment text:=nullif(btrim(coalesce(p_comment,'')),'');
begin
  if v_actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if length(coalesce(v_comment,''))>2000 then
    raise exception 'Review must be 2000 characters or fewer';
  end if;
  select * into v_listing from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.deleted_at is null limit 1;
  if v_listing.id is null then raise exception 'Apartment not found'; end if;

  select * into v_reservation
  from public.reservations r
  where r.listing_id=v_listing.id::text
    and r.user_id=v_actor
    and not exists(
      select 1 from public.listing_reviews review
      where review.reservation_id=r.id
    )
    and (
      (
        r.stay_type='short_let'
        and r.checked_in_at is not null
        and (r.checked_out_at is not null or r.status in ('completed','cancelled','refunded'))
        and r.rent_payment_status='paid'
      )
      or (
        coalesce(r.stay_type,'long_stay')='long_stay'
        and (r.verified_handover_at is not null or r.occupancy_started_at is not null)
        and r.status in ('occupied','completed','cancelled','refunded')
        and r.rent_payment_status in ('upfront_paid','paid')
      )
    )
  order by coalesce(r.checked_out_at,r.completed_at,r.processed_at,r.updated_at) desc
  limit 1
  for update;
  if v_reservation.id is null then
    raise exception 'A verified stay or occupancy is required before reviewing this apartment';
  end if;

  insert into public.listing_reviews(
    listing_id,reservation_id,user_id,rating,comment
  ) values(
    v_listing.id,v_reservation.id,v_actor,p_rating,v_comment
  ) returning * into v_review;

  update public.listings listing set
    rating=(select round(avg(review.rating)::numeric,2)
      from public.listing_reviews review where review.listing_id=v_listing.id),
    review_count=(select count(*)::integer
      from public.listing_reviews review where review.listing_id=v_listing.id),
    updated_at=now()
  where listing.id=v_listing.id;

  return v_review;
end
$function$;
revoke all on function public.create_my_verified_listing_review(p_listing_id text, p_rating integer, p_comment text) from public, anon, authenticated, service_role;

grant execute on function public.create_my_verified_listing_review(p_listing_id text, p_rating integer, p_comment text) to service_role;
grant execute on function public.create_my_verified_listing_review(p_listing_id text, p_rating integer, p_comment text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_short_stay_reservation_v2(p_listing_id text, p_check_in date, p_check_out date, p_guest_count integer, p_rate_type text)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_result public.reservations;
  v_platform_min integer:=1;
  v_platform_max integer:=90;
  v_min_nights integer;
  v_max_nights integer;
  v_nights integer;
  v_rate_type text:=lower(btrim(coalesce(p_rate_type,'standard')));
  v_discount numeric(5,2):=0;
  v_effective_rate numeric(12,2);
  v_policy jsonb:='{}'::jsonb;
begin
  if v_actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'An active Personal account is required';
  end if;
  select * into v_listing from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.deleted_at is null and l.sub_type='short_let'
  limit 1;
  if v_listing.id is null then raise exception 'Short Let not found'; end if;
  if v_rate_type not in ('standard','non_refundable') then
    raise exception 'Choose a valid Short Let rate';
  end if;
  if v_rate_type='non_refundable' and not v_listing.non_refundable_rate_enabled then
    raise exception 'This Short Let does not offer a non-refundable rate';
  end if;

  select coalesce(nullif(value,'')::integer,1) into v_platform_min
  from public.platform_settings
  where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
  select coalesce(nullif(value,'')::integer,90) into v_platform_max
  from public.platform_settings
  where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
  v_platform_min:=greatest(coalesce(v_platform_min,1),1);
  v_platform_max:=greatest(coalesce(v_platform_max,90),v_platform_min);
  v_min_nights:=greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min);
  v_max_nights:=least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max);
  v_max_nights:=greatest(v_max_nights,v_min_nights);
  v_nights:=p_check_out-p_check_in;
  if v_nights<v_min_nights or v_nights>v_max_nights then
    raise exception 'This Short Let requires a stay between % and % nights',v_min_nights,v_max_nights;
  end if;

  if v_rate_type='non_refundable' then
    v_discount:=round(coalesce(v_listing.non_refundable_discount_percent,0),2);
    if v_discount<1 or v_discount>30 then
      raise exception 'This non-refundable rate is not configured';
    end if;
  end if;
  v_effective_rate:=round(v_listing.price*(1-v_discount/100),2);

  select p.value into v_policy
  from public.creator_policy_versions p
  where p.policy_key='short_let_cancellation'
    and p.scope_type='global' and p.scope_key='*' and p.status='active'
    and p.effective_from<=now()
    and (p.effective_until is null or p.effective_until>now())
  order by p.effective_from desc,p.version desc limit 1;
  if v_policy='{}'::jsonb then raise exception 'Short Let cancellation policy is unavailable'; end if;

  select * into v_result from public.create_short_stay_reservation(
    v_listing.id::text,p_check_in,p_check_out,p_guest_count
  );
  if v_result.user_id<>v_actor or v_result.status<>'payment_pending'
     or v_result.reservation_fee_status<>'payment_pending' then
    raise exception 'This pending reservation cannot change rate';
  end if;

  update public.reservations set
    nightly_rate_snapshot=v_effective_rate,
    stay_rent_total=round(v_effective_rate*stay_nights,2),
    short_stay_rate_type=v_rate_type,
    short_stay_discount_percent_snapshot=v_discount,
    short_stay_cancellation_policy_snapshot=v_policy||jsonb_build_object(
      'rate_type',v_rate_type,
      'non_refundable',v_rate_type='non_refundable',
      'discount_percent',v_discount,
      'security_deposit_never_cancellation_charge',true,
      'provider_failure_reviewable',true,
      'payment_error_reviewable',true
    ),
    updated_at=now()
  where id=v_result.id
  returning * into v_result;

  update public.booking_payments set
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'short_stay_rate_type',v_rate_type,
      'discount_percent',v_discount,
      'nightly_rate',v_effective_rate,
      'stay_rent_total',v_result.stay_rent_total
    ),
    updated_at=now()
  where paystack_reference=v_result.payment_reference
    and status='pending';

  return v_result;
end
$function$;
revoke all on function public.create_short_stay_reservation_v2(p_listing_id text, p_check_in date, p_check_out date, p_guest_count integer, p_rate_type text) from public, anon, authenticated, service_role;

grant execute on function public.create_short_stay_reservation_v2(p_listing_id text, p_check_in date, p_check_out date, p_guest_count integer, p_rate_type text) to service_role;
grant execute on function public.create_short_stay_reservation_v2(p_listing_id text, p_check_in date, p_check_out date, p_guest_count integer, p_rate_type text) to authenticated;

CREATE OR REPLACE FUNCTION public.creator_get_booking_money_rules_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_result jsonb:=public.creator_get_booking_money_rules();
  v_active jsonb;
  v_scheduled jsonb;
begin
  select coalesce(jsonb_object_agg(policy_key,payload),'{}'::jsonb)
  into v_active
  from (
    select distinct on(policy_key) policy_key,jsonb_build_object(
      'policy_version_id',policy_version_id,'version',version,'value',value,
      'effective_from',effective_from,'legal_review_state',legal_review_state,
      'disclosure_text',disclosure_text
    ) payload
    from public.creator_policy_versions
    where scope_type='global' and scope_key='*' and status='active'
      and effective_from<=now()
      and (effective_until is null or effective_until>now())
      and policy_key in(
        'commission_short_let_wehouse_managed',
        'commission_long_let_wehouse_managed'
      )
    order by policy_key,effective_from desc,version desc
  ) rows;

  select coalesce(jsonb_object_agg(policy_key,payload),'{}'::jsonb)
  into v_scheduled
  from (
    select distinct on(policy_key) policy_key,jsonb_build_object(
      'policy_version_id',policy_version_id,'version',version,'value',value,
      'effective_from',effective_from,'legal_review_state',legal_review_state,
      'disclosure_text',disclosure_text
    ) payload
    from public.creator_policy_versions
    where scope_type='global' and scope_key='*' and status='scheduled'
      and policy_key in(
        'commission_short_let_wehouse_managed',
        'commission_long_let_wehouse_managed'
      )
    order by policy_key,effective_from desc,version desc
  ) rows;

  return jsonb_set(
    jsonb_set(v_result,'{active}',coalesce(v_result->'active','{}'::jsonb)||v_active,true),
    '{scheduled}',coalesce(v_result->'scheduled','{}'::jsonb)||v_scheduled,true
  );
end
$function$;
revoke all on function public.creator_get_booking_money_rules_v2() from public, anon, authenticated, service_role;

grant execute on function public.creator_get_booking_money_rules_v2() to service_role;
grant execute on function public.creator_get_booking_money_rules_v2() to authenticated;

CREATE OR REPLACE FUNCTION public.creator_get_booking_money_rules_v3()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_result jsonb:=public.creator_get_booking_money_rules_v2();
  v_active jsonb; v_scheduled jsonb;
begin
  select coalesce(jsonb_object_agg(policy_key,payload),'{}'::jsonb) into v_active
  from(
    select distinct on(policy_key) policy_key,jsonb_build_object(
      'policy_version_id',policy_version_id,'version',version,'value',value,
      'effective_from',effective_from,'legal_review_state',legal_review_state,
      'disclosure_text',disclosure_text
    ) payload
    from public.creator_policy_versions
    where scope_type='global' and scope_key='*' and status='active'
      and effective_from<=now() and (effective_until is null or effective_until>now())
      and policy_key in('accommodation_non_refundable_rate','hotel_standard_cancellation')
    order by policy_key,effective_from desc,version desc
  ) policies;
  select coalesce(jsonb_object_agg(policy_key,payload),'{}'::jsonb) into v_scheduled
  from(
    select distinct on(policy_key) policy_key,jsonb_build_object(
      'policy_version_id',policy_version_id,'version',version,'value',value,
      'effective_from',effective_from,'legal_review_state',legal_review_state,
      'disclosure_text',disclosure_text
    ) payload
    from public.creator_policy_versions
    where scope_type='global' and scope_key='*' and status='scheduled'
      and policy_key in('accommodation_non_refundable_rate','hotel_standard_cancellation')
    order by policy_key,effective_from desc,version desc
  ) policies;
  return jsonb_set(
    jsonb_set(v_result,'{active}',coalesce(v_result->'active','{}'::jsonb)||v_active,true),
    '{scheduled}',coalesce(v_result->'scheduled','{}'::jsonb)||v_scheduled,true
  );
end
$function$;
revoke all on function public.creator_get_booking_money_rules_v3() from public, anon, authenticated, service_role;

grant execute on function public.creator_get_booking_money_rules_v3() to service_role;
grant execute on function public.creator_get_booking_money_rules_v3() to authenticated;

CREATE OR REPLACE FUNCTION public.creator_publish_booking_money_rules_v2(p_creator_elevation_id uuid, p_rules jsonb, p_effective_from timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_base jsonb;
  v_comm jsonb:=p_rules->'commissions';
  v_effective timestamptz:=coalesce(p_effective_from,now());
  v_item jsonb;
  v_current jsonb;
  v_published public.creator_policy_versions;
  v_changed integer:=0;
  v_extra jsonb:='{}'::jsonb;
begin
  if jsonb_typeof(v_comm)<>'object' then
    raise exception 'Complete commission rules are required';
  end if;
  if coalesce((v_comm->>'short_let_wehouse_percent')::numeric,-1) not between 0 and 50
     or coalesce((v_comm->>'long_let_wehouse_percent')::numeric,-1) not between 0 and 50 then
    raise exception 'Managed-service commission percentages must be between 0 and 50';
  end if;

  -- The legacy bundle remains the single validator/publisher for every existing
  -- money rule. Calling it inside this function keeps the whole publication in
  -- one database transaction.
  v_base:=public.creator_publish_booking_money_rules(
    p_creator_elevation_id,p_rules,v_effective,p_reason
  );
  v_changed:=coalesce((v_base->>'changed_policy_count')::integer,0);

  for v_item in
    select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object(
        'key','commission_short_let_wehouse_managed',
        'value',jsonb_build_object('percent',(v_comm->>'short_let_wehouse_percent')::numeric),
        'disclosure','WeHouse-managed Short Let commission on accommodation value.'
      ),
      jsonb_build_object(
        'key','commission_long_let_wehouse_managed',
        'value',jsonb_build_object('percent',(v_comm->>'long_let_wehouse_percent')::numeric),
        'disclosure','WeHouse-managed Long Let commission on eligible rent value.'
      )
    ))
  loop
    select value into v_current
    from public.creator_policy_versions
    where policy_key=v_item->>'key' and scope_type='global' and scope_key='*'
      and status=case when v_effective>now() then 'scheduled' else 'active' end
    order by effective_from desc,version desc limit 1;

    if v_current is distinct from v_item->'value' then
      select * into v_published
      from public.creator_publish_policy(
        p_creator_elevation_id,v_item->>'key','global','*',v_item->'value',
        jsonb_build_object('type','percent'),v_effective,true,
        v_item->>'disclosure','pending',p_reason
      );
      v_extra:=v_extra||jsonb_build_object(v_item->>'key',jsonb_build_object(
        'policy_version_id',v_published.policy_version_id,
        'version',v_published.version,'status',v_published.status,
        'effective_from',v_published.effective_from
      ));
      v_changed:=v_changed+1;
    end if;
  end loop;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    public.current_profile_user_id(),'creator_publish_management_commissions',
    'creator_policy_bundle',md5(v_effective::text||coalesce(p_reason,'')),
    jsonb_build_object(
      'managed_policy_changes',jsonb_object_length(v_extra),
      'effective_from',v_effective,'reason',p_reason
    )::text,now()
  );

  return v_base||jsonb_build_object(
    'changed_policy_count',v_changed,
    'published',coalesce(v_base->'published','{}'::jsonb)||v_extra
  );
end
$function$;
revoke all on function public.creator_publish_booking_money_rules_v2(p_creator_elevation_id uuid, p_rules jsonb, p_effective_from timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;

grant execute on function public.creator_publish_booking_money_rules_v2(p_creator_elevation_id uuid, p_rules jsonb, p_effective_from timestamp with time zone, p_reason text) to service_role;
grant execute on function public.creator_publish_booking_money_rules_v2(p_creator_elevation_id uuid, p_rules jsonb, p_effective_from timestamp with time zone, p_reason text) to authenticated;

CREATE OR REPLACE FUNCTION public.creator_publish_booking_money_rules_v3(p_creator_elevation_id uuid, p_rules jsonb, p_effective_from timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_base jsonb; v_short jsonb:=p_rules->'short_let';
  v_hotel jsonb:=p_rules->'hotel'; v_effective timestamptz:=coalesce(p_effective_from,now());
  v_min numeric; v_max numeric; v_hotel_hours integer;
  v_item jsonb; v_current jsonb; v_published public.creator_policy_versions;
  v_extra jsonb:='{}'::jsonb; v_changed integer:=0;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
    raise exception 'Recent Creator policy authentication required';
  end if;
  if jsonb_typeof(v_short)<>'object' or jsonb_typeof(v_hotel)<>'object' then
    raise exception 'Complete accommodation rules are required';
  end if;
  v_min:=(v_short->>'non_refundable_discount_min_percent')::numeric;
  v_max:=(v_short->>'non_refundable_discount_max_percent')::numeric;
  v_hotel_hours:=(v_hotel->>'standard_full_refund_hours_before_check_in')::integer;
  if v_min is null or v_max is null or v_min<1 or v_max>30 or v_min>v_max then
    raise exception 'Choose a valid non-refundable discount range';
  end if;
  if v_hotel_hours is null or v_hotel_hours not between 0 and 720 then
    raise exception 'Hotel Standard cancellation deadline is invalid';
  end if;
  v_base:=public.creator_publish_booking_money_rules_v2(
    p_creator_elevation_id,p_rules,v_effective,p_reason
  );
  v_changed:=coalesce((v_base->>'changed_policy_count')::integer,0);
  for v_item in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object(
      'key','accommodation_non_refundable_rate',
      'value',jsonb_build_object(
        'minimum_discount_percent',v_min,'maximum_discount_percent',v_max,
        'guest_cancellation_refund_percent',0,
        'no_show_provider_eligible_after_review',true,
        'security_deposit_full_refund_without_occupancy',true,
        'provider_failure_overrides_non_refundable',true,
        'payment_or_listing_mismatch_reviewable',true,
        'payment_protection_required',true
      ),
      'schema',jsonb_build_object('type','accommodation_rate_terms'),
      'disclosure','A lower non-refundable accommodation price remains protected against provider failure, payment error and listing mismatch.'
    ),
    jsonb_build_object(
      'key','hotel_standard_cancellation',
      'value',jsonb_build_object(
        'full_refund_hours_before_check_in',v_hotel_hours,
        'late_cancellation_requires_review',true,
        'provider_failure_full_refund',true,
        'payment_protection_required',true
      ),
      'schema',jsonb_build_object('type','cancellation_policy'),
      'disclosure','Hotel Standard rates use the Creator-approved cancellation deadline shown before payment.'
    )
  )) loop
    select value into v_current from public.creator_policy_versions
    where policy_key=v_item->>'key' and scope_type='global' and scope_key='*'
      and status=case when v_effective>now() then 'scheduled' else 'active' end
    order by effective_from desc,version desc limit 1;
    if v_current is distinct from v_item->'value' then
      select * into v_published from public.creator_publish_policy(
        p_creator_elevation_id,v_item->>'key','global','*',v_item->'value',
        v_item->'schema',v_effective,true,v_item->>'disclosure','pending',p_reason
      );
      v_extra:=v_extra||jsonb_build_object(v_item->>'key',jsonb_build_object(
        'policy_version_id',v_published.policy_version_id,'version',v_published.version,
        'status',v_published.status,'effective_from',v_published.effective_from
      ));
      v_changed:=v_changed+1;
    end if;
  end loop;
  return v_base||jsonb_build_object(
    'changed_policy_count',v_changed,
    'published',coalesce(v_base->'published','{}'::jsonb)||v_extra
  );
end
$function$;
revoke all on function public.creator_publish_booking_money_rules_v3(p_creator_elevation_id uuid, p_rules jsonb, p_effective_from timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;

grant execute on function public.creator_publish_booking_money_rules_v3(p_creator_elevation_id uuid, p_rules jsonb, p_effective_from timestamp with time zone, p_reason text) to service_role;
grant execute on function public.creator_publish_booking_money_rules_v3(p_creator_elevation_id uuid, p_rules jsonb, p_effective_from timestamp with time zone, p_reason text) to authenticated;

CREATE OR REPLACE FUNCTION public.creator_set_partner_pro_setting(p_key text, p_value text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_value text:=btrim(coalesce(p_value,'')); v_month numeric; v_year numeric; v_version text; v_terms text;
begin
 if not public.current_actor_has_workspace('creator',null) then raise exception 'Creator access required'; end if;
 if p_key not in ('partner_pro_monthly_price_ngn','partner_pro_yearly_price_ngn','partner_pro_monthly_plan_code',
   'partner_pro_yearly_plan_code','partner_pro_terms_version','partner_pro_terms_content','partner_pro_sales_enabled') then
   raise exception 'Setting is not part of Property Partner Pro'; end if;
 if p_key in ('partner_pro_monthly_price_ngn','partner_pro_yearly_price_ngn') then
   if v_value !~ '^[0-9]+(\.[0-9]{1,2})?$' or v_value::numeric>10000000 then raise exception 'Invalid Partner Pro price'; end if;
 elsif p_key in ('partner_pro_monthly_plan_code','partner_pro_yearly_plan_code') then
   if v_value<>'' and v_value !~ '^PLN_[A-Za-z0-9]+$' then raise exception 'Invalid Paystack plan code'; end if;
 elsif p_key='partner_pro_sales_enabled' then
   if v_value not in ('true','false') then raise exception 'Invalid sales setting'; end if;
   if v_value='true' then
     select coalesce(nullif(value,'')::numeric,0) into v_month from public.platform_settings where key='partner_pro_monthly_price_ngn';
     select coalesce(nullif(value,'')::numeric,0) into v_year from public.platform_settings where key='partner_pro_yearly_price_ngn';
     select value into v_version from public.platform_settings where key='partner_pro_terms_version';
     select value into v_terms from public.platform_settings where key='partner_pro_terms_content';
     if coalesce(v_month,0)<=0 and coalesce(v_year,0)<=0 then raise exception 'Set a Partner Pro price first'; end if;
     if length(btrim(coalesce(v_version,'')))<1 or length(btrim(coalesce(v_terms,'')))<100 then raise exception 'Publish complete Partner Pro terms first'; end if;
   end if;
 elsif p_key='partner_pro_terms_version' and length(v_value)>100 then raise exception 'Terms version is too long';
 elsif p_key='partner_pro_terms_content' and length(v_value)>50000 then raise exception 'Terms are too long'; end if;
 if p_key in ('partner_pro_monthly_price_ngn','partner_pro_yearly_price_ngn','partner_pro_monthly_plan_code',
   'partner_pro_yearly_plan_code','partner_pro_terms_version','partner_pro_terms_content') and exists(
   select 1 from public.platform_settings where key=p_key and value is distinct from v_value) then
   update public.platform_settings set value='false',updated_at=now() where key='partner_pro_sales_enabled';
 end if;
 update public.platform_settings set value=v_value,updated_at=now() where key=p_key;
 if not found then raise exception 'Partner Pro setting is missing'; end if;
 insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
 values(public.current_profile_user_id(),'partner_pro_setting','platform_settings',p_key,
   jsonb_build_object('updated',true,'sales_enabled',(select value from public.platform_settings where key='partner_pro_sales_enabled'))::text,now());
 return true;
end $function$;
revoke all on function public.creator_set_partner_pro_setting(p_key text, p_value text) from public, anon, authenticated, service_role;

grant execute on function public.creator_set_partner_pro_setting(p_key text, p_value text) to service_role;
grant execute on function public.creator_set_partner_pro_setting(p_key text, p_value text) to authenticated;

CREATE OR REPLACE FUNCTION public.current_actor_can_host_reservation(p_reservation_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists(
    select 1
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
    join public.property_host_assignments a
      on a.listing_id=l.id
     and a.user_id=r.responsible_host_user_id
     and a.status='active'
    join public.profiles p on p.user_id=a.user_id
    where r.id=p_reservation_id
      and r.management_mode_snapshot='host'
      and r.responsible_host_user_id=public.current_profile_user_id()
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
  )
$function$;
revoke all on function public.current_actor_can_host_reservation(p_reservation_id text) from public, anon, authenticated, service_role;

grant execute on function public.current_actor_can_host_reservation(p_reservation_id text) to service_role;
grant execute on function public.current_actor_can_host_reservation(p_reservation_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.current_actor_can_manage_property(p_listing_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists(
    select 1 from public.property_host_assignments a
    join public.profiles p on p.user_id=a.user_id
    join public.listings l on l.id=a.listing_id
    where a.listing_id=p_listing_id and a.user_id=public.current_profile_user_id()
      and a.status='active'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        (a.assignment_role='owner'
          and public.user_has_active_workspace(a.user_id,'property_partner'))
        or (a.assignment_role='manager' and (
          l.management_mode='host'
          or exists(select 1 from public.reservations r
            where (r.listing_id=l.id::text or r.listing_id=l.listing_id)
              and r.management_mode_snapshot='host'
              and r.responsible_host_user_id=a.user_id
              and r.status not in ('completed','cancelled','refunded','expired'))
        ))
      )
  )
$function$;
revoke all on function public.current_actor_can_manage_property(p_listing_id uuid) from public, anon, authenticated, service_role;

grant execute on function public.current_actor_can_manage_property(p_listing_id uuid) to service_role;
grant execute on function public.current_actor_can_manage_property(p_listing_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.decide_accommodation_no_show_review(p_no_show_review_id uuid, p_decision text, p_reason text)
 RETURNS accommodation_no_show_reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor public.profiles; v_review public.accommodation_no_show_reviews;
  v_res public.reservations; v_listing public.listings;
  v_booking public.hotel_bookings; v_hotel public.hotels;
  v_protection public.payment_protection_transactions;
  v_release uuid; v_refund uuid; v_remaining numeric;
begin
  select * into v_actor from public.profiles
  where user_id=public.current_profile_user_id()
    and role in('creator','admin','staff')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false);
  if v_actor.user_id is null
     or (v_actor.role='staff' and not public.current_staff_has_permission('operations')) then
    raise exception 'Property Operations access required';
  end if;
  if p_decision not in('approve','reject') or char_length(btrim(coalesce(p_reason,'')))<10 then
    raise exception 'A clear review decision and reason are required';
  end if;
  select * into v_review from public.accommodation_no_show_reviews
  where no_show_review_id=p_no_show_review_id for update;
  if v_review.no_show_review_id is null or v_review.status<>'submitted' then
    raise exception 'No-show review is not awaiting a decision';
  end if;
  if v_review.subject_type='short_let' then
    select * into v_res from public.reservations where id=v_review.subject_id for update;
    select * into v_listing from public.listings
    where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
    if v_actor.role<>'creator' and not public.current_actor_in_scope(v_listing.state,v_listing.city) then
      raise exception 'Stay is outside your assigned branch';
    end if;
    select * into v_protection from public.payment_protection_transactions
    where id=v_res.stay_payment_protection_id for update;
  else
    select * into v_booking from public.hotel_bookings
    where booking_id::text=v_review.subject_id for update;
    select * into v_hotel from public.hotels where hotel_id=v_booking.hotel_id;
    if v_actor.role<>'creator' and not public.current_actor_in_scope(v_hotel.state,v_hotel.city) then
      raise exception 'Stay is outside your assigned branch';
    end if;
    select * into v_protection from public.payment_protection_transactions
    where id=v_booking.payment_protection_id for update;
  end if;
  if p_decision='reject' then
    update public.accommodation_no_show_reviews set
      status='rejected',reviewed_by=v_actor.user_id,reviewed_at=now(),
      decision_reason=btrim(p_reason),updated_at=now()
    where no_show_review_id=v_review.no_show_review_id returning * into v_review;
    return v_review;
  end if;
  if v_protection.id is null or v_protection.protection_state not in('protected','release_eligible') then
    raise exception 'Accommodation payment is not protected for settlement';
  end if;
  if exists(
    select 1 from public.operational_cases c
    where c.subject_type=v_review.subject_type and c.subject_id=v_review.subject_id
      and c.status not in('resolved','closed')
  ) then raise exception 'Resolve the open stay issue before a no-show payout'; end if;
  update public.accommodation_no_show_reviews set
    status='approved',reviewed_by=v_actor.user_id,reviewed_at=now(),
    decision_reason=btrim(p_reason),updated_at=now()
  where no_show_review_id=v_review.no_show_review_id
  returning * into v_review;
  if v_protection.protection_state='protected' then
    insert into public.payment_protection_transitions(
      payment_protection_id,from_state,to_state,event_type,event_key,
      actor_user_id,actor_type,reason,metadata
    ) values(
      v_protection.id,'protected','release_eligible','no_show_review_approved',
      'no-show-release-eligible:'||v_review.no_show_review_id,
      v_actor.user_id,'operations',btrim(p_reason),
      jsonb_build_object('no_show_review_id',v_review.no_show_review_id)
    ) on conflict(event_key) do nothing;
    update public.payment_protection_transactions set
      protection_state='release_eligible',status='release_eligible',
      release_eligible_at=now(),updated_at=now()
    where id=v_protection.id and protection_state='protected';
  end if;
  v_remaining:=v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount;
  if v_remaining<=0 then raise exception 'No protected accommodation balance remains'; end if;
  insert into public.financial_action_outbox(
    action_type,subject_type,subject_id,payment_protection_id,amount,
    idempotency_key,metadata
  ) values(
    case when v_review.subject_type='short_let' then 'release_short_let_stay'
      else 'release_hotel_stay' end,
    v_review.subject_type,v_review.subject_id,v_protection.id,v_remaining,
    'approved-no-show-release:'||v_review.no_show_review_id,
    jsonb_build_object('no_show_review_id',v_review.no_show_review_id,
      'settlement','provider_net_after_wehouse_commission')
  ) on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
  returning financial_action_id into v_release;
  if v_review.subject_type='short_let' then
    update public.reservations set status='no_show',canonical_state='no_show',
      processed_by=v_actor.user_id,processed_at=now(),
      security_deposit_status=case when caution_payment_protection_id is null
        then security_deposit_status else 'refund_due' end,updated_at=now()
    where id=v_res.id;
    if v_res.caution_payment_protection_id is not null then
      select amount_total-released_amount-refunded_amount into v_remaining
      from public.payment_protection_transactions
      where id=v_res.caution_payment_protection_id for update;
      if coalesce(v_remaining,0)>0 then
        insert into public.financial_action_outbox(
          action_type,subject_type,subject_id,payment_protection_id,amount,
          idempotency_key,metadata
        ) values(
          'refund_unclaimed_caution','short_let',v_res.id,
          v_res.caution_payment_protection_id,v_remaining,
          'no-show-caution-refund:'||v_review.no_show_review_id,
          jsonb_build_object('refund_destination','original_payment',
            'reason','no_occupancy_no_damage')
        ) on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
        returning financial_action_id into v_refund;
      end if;
    end if;
  else
    update public.hotel_bookings set status='no_show',canonical_state='no_show',
      completed_by=v_actor.user_id,completion_source='wehouse_review',updated_at=now()
    where booking_id=v_booking.booking_id;
  end if;
  update public.accommodation_no_show_reviews set
    release_action_id=v_release,
    caution_refund_action_id=v_refund,updated_at=now()
  where no_show_review_id=v_review.no_show_review_id returning * into v_review;
  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor.user_id,'approve_accommodation_no_show',v_review.subject_type,
    v_review.subject_id,jsonb_build_object(
      'no_show_review_id',v_review.no_show_review_id,
      'release_action_id',v_release,'caution_refund_action_id',v_refund,
      'reason',btrim(p_reason)
    )::text,now()
  );
  return v_review;
end
$function$;
revoke all on function public.decide_accommodation_no_show_review(p_no_show_review_id uuid, p_decision text, p_reason text) from public, anon, authenticated, service_role;

grant execute on function public.decide_accommodation_no_show_review(p_no_show_review_id uuid, p_decision text, p_reason text) to service_role;
grant execute on function public.decide_accommodation_no_show_review(p_no_show_review_id uuid, p_decision text, p_reason text) to authenticated;

CREATE OR REPLACE FUNCTION public.enforce_listing_non_refundable_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_terms jsonb; v_min numeric; v_max numeric;
begin
  if new.sub_type is distinct from 'short_let' or not new.non_refundable_rate_enabled then
    if new.sub_type is distinct from 'short_let' then
      new.non_refundable_rate_enabled:=false;
      new.non_refundable_discount_percent:=null;
    end if;
    return new;
  end if;
  select value into v_terms from public.creator_policy_versions
  where policy_key='accommodation_non_refundable_rate'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  v_min:=(v_terms->>'minimum_discount_percent')::numeric;
  v_max:=(v_terms->>'maximum_discount_percent')::numeric;
  if new.non_refundable_discount_percent is null
     or new.non_refundable_discount_percent<v_min
     or new.non_refundable_discount_percent>v_max then
    raise exception 'Non-refundable discount must be between % and % percent',v_min,v_max;
  end if;
  return new;
end
$function$;
revoke all on function public.enforce_listing_non_refundable_policy() from public, anon, authenticated, service_role;

grant execute on function public.enforce_listing_non_refundable_policy() to service_role;

CREATE OR REPLACE FUNCTION public.enforce_management_commission_on_protection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_res public.reservations;
  v_listing public.listings;
  v_policy record;
  v_group public.shared_housing_groups;
begin
  if new.subject_type not in ('short_let_stay','long_let_year_one','shared_housing_share') then
    return new;
  end if;

  if new.subject_type='shared_housing_share' then
    select g.* into v_group
    from public.shared_housing_members m
    join public.shared_housing_groups g on g.id=m.group_id
    where m.id::text=new.subject_id;
    if v_group.id is null then
      raise exception 'Shared payment group is missing';
    end if;
    if v_group.reservation_id is not null then
      select * into v_res from public.reservations where id=v_group.reservation_id;
    end if;
    select * into v_listing from public.listings where id=v_group.listing_id;
  else
    select * into v_res from public.reservations where id=new.subject_id;
    if v_res.id is not null then
      select * into v_listing from public.listings
      where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
    end if;
  end if;

  if v_listing.id is null then raise exception 'Apartment listing is missing'; end if;
  select * into v_policy
  from private.resolve_apartment_commission_policy(
    case when new.subject_type='short_let_stay' or v_listing.sub_type='short_let'
      then 'short_let' else 'long_stay' end,
    coalesce(v_res.management_mode_snapshot,v_listing.management_mode,'wehouse'),
    v_res.commission_policy_version_id
  );
  if v_policy.policy_version_id is null or v_policy.percent not between 0 and 50 then
    raise exception 'Snapshotted apartment commission policy is missing or invalid';
  end if;
  new.commission_rate:=v_policy.percent;
  new.amount_commission:=round(new.amount_total*v_policy.percent/100,2);
  new.amount_payee:=new.amount_total-new.amount_commission;
  return new;
end
$function$;
revoke all on function public.enforce_management_commission_on_protection() from public, anon, authenticated, service_role;

grant execute on function public.enforce_management_commission_on_protection() to service_role;

CREATE OR REPLACE FUNCTION public.enforce_short_let_listing_stay_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_listing public.listings;
  v_platform_min integer:=1;
  v_platform_max integer:=90;
  v_min_nights integer;
  v_max_nights integer;
  v_nights integer;
  v_discount numeric(5,2):=0;
  v_policy jsonb:='{}'::jsonb;
begin
  if new.stay_type is distinct from 'short_let'
     or new.stay_check_in is null or new.stay_check_out is null then
    return new;
  end if;

  select * into v_listing from public.listings l
  where (l.id::text=new.listing_id or l.listing_id=new.listing_id)
    and l.deleted_at is null and l.sub_type='short_let'
  limit 1;
  if v_listing.id is null then raise exception 'Short Let not found'; end if;

  select coalesce(nullif(value,'')::integer,1) into v_platform_min
  from public.platform_settings
  where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
  select coalesce(nullif(value,'')::integer,90) into v_platform_max
  from public.platform_settings
  where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
  v_platform_min:=greatest(coalesce(v_platform_min,1),1);
  v_platform_max:=greatest(coalesce(v_platform_max,90),v_platform_min);
  v_min_nights:=greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min);
  v_max_nights:=least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max);
  v_max_nights:=greatest(v_max_nights,v_min_nights);
  v_nights:=new.stay_check_out-new.stay_check_in;
  if v_nights<v_min_nights or v_nights>v_max_nights then
    raise exception 'This Short Let requires a stay between % and % nights',v_min_nights,v_max_nights;
  end if;

  new.short_stay_rate_type:=lower(btrim(coalesce(new.short_stay_rate_type,'standard')));
  if new.short_stay_rate_type not in ('standard','non_refundable') then
    raise exception 'Choose a valid Short Let rate';
  end if;
  if tg_op='UPDATE'
     and old.short_stay_rate_type is distinct from new.short_stay_rate_type
     and not (old.status='payment_pending' and old.reservation_fee_status='payment_pending') then
    raise exception 'The booked Short Let rate cannot be changed';
  end if;
  if new.short_stay_rate_type='non_refundable' then
    if not v_listing.non_refundable_rate_enabled then
      raise exception 'This Short Let does not offer a non-refundable rate';
    end if;
    v_discount:=round(coalesce(v_listing.non_refundable_discount_percent,0),2);
    if v_discount<1 or v_discount>30 then
      raise exception 'This non-refundable rate is not configured';
    end if;
  end if;

  select p.value into v_policy
  from public.creator_policy_versions p
  where p.policy_key='short_let_cancellation'
    and p.scope_type='global' and p.scope_key='*' and p.status='active'
    and p.effective_from<=now()
    and (p.effective_until is null or p.effective_until>now())
  order by p.effective_from desc,p.version desc limit 1;
  if v_policy='{}'::jsonb then
    raise exception 'Short Let cancellation policy is unavailable';
  end if;

  new.stay_nights:=v_nights;
  new.nightly_rate_snapshot:=round(v_listing.price*(1-v_discount/100),2);
  new.stay_rent_total:=round(new.nightly_rate_snapshot*v_nights,2);
  new.short_stay_discount_percent_snapshot:=v_discount;
  new.short_stay_cancellation_policy_snapshot:=v_policy||jsonb_build_object(
    'rate_type',new.short_stay_rate_type,
    'non_refundable',new.short_stay_rate_type='non_refundable',
    'discount_percent',v_discount,
    'security_deposit_never_cancellation_charge',true,
    'provider_failure_reviewable',true,
    'payment_error_reviewable',true
  );
  return new;
end
$function$;
revoke all on function public.enforce_short_let_listing_stay_rules() from public, anon, authenticated, service_role;

grant execute on function public.enforce_short_let_listing_stay_rules() to service_role;

CREATE OR REPLACE FUNCTION public.get_accommodation_rate_terms()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_nonref public.creator_policy_versions;
  v_short public.creator_policy_versions;
  v_hotel public.creator_policy_versions;
begin
  select * into v_nonref from public.creator_policy_versions
  where policy_key='accommodation_non_refundable_rate'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  select * into v_short from public.creator_policy_versions
  where policy_key='short_let_cancellation'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  select * into v_hotel from public.creator_policy_versions
  where policy_key='hotel_standard_cancellation'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  if v_nonref.policy_version_id is null or v_short.policy_version_id is null
     or v_hotel.policy_version_id is null then
    raise exception 'Active accommodation rate terms are unavailable';
  end if;
  return jsonb_build_object(
    'source_of_truth','creator_policy_versions',
    'allowed_rate_types',jsonb_build_array('standard','non_refundable'),
    'non_refundable',jsonb_build_object(
      'policy_version_id',v_nonref.policy_version_id,'version',v_nonref.version,
      'value',v_nonref.value,'disclosure_text',v_nonref.disclosure_text
    ),
    'short_let_standard',jsonb_build_object(
      'policy_version_id',v_short.policy_version_id,'version',v_short.version,
      'value',v_short.value,'disclosure_text',v_short.disclosure_text
    ),
    'hotel_standard',jsonb_build_object(
      'policy_version_id',v_hotel.policy_version_id,'version',v_hotel.version,
      'value',v_hotel.value,'disclosure_text',v_hotel.disclosure_text
    )
  );
end
$function$;
revoke all on function public.get_accommodation_rate_terms() from public, anon, authenticated, service_role;

grant execute on function public.get_accommodation_rate_terms() to service_role;
grant execute on function public.get_accommodation_rate_terms() to anon;
grant execute on function public.get_accommodation_rate_terms() to authenticated;

CREATE OR REPLACE FUNCTION public.get_discoverable_listings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',l.id,
      'listing_id',l.listing_id,
      'title',l.title,
      'description',l.description,
      'price',l.price,
      'currency',l.currency,
      'state',l.state,
      'city',l.city,
      'address',l.address,
      'images',coalesce(l.images,array[]::text[]),
      'videos',coalesce(l.videos,array[]::text[]),
      'bedrooms',l.bedrooms,
      'bathrooms',l.bathrooms,
      'availability_status',l.availability_status,
      'status',l.status,
      'property_type',l.property_type,
      'sub_type',l.sub_type,
      'security_deposit_amount',l.security_deposit_amount,
      'max_guests',l.max_guests,
      'pets_allowed',l.pets_allowed,
      'max_occupants',l.max_occupants,
      'future_installments_allowed',l.future_installments_allowed,
      'minimum_stay_nights',l.minimum_stay_nights,
      'maximum_stay_nights',l.maximum_stay_nights,
      'non_refundable_rate_enabled',l.non_refundable_rate_enabled,
      'non_refundable_discount_percent',l.non_refundable_discount_percent,
      'rating',l.rating,
      'review_count',l.review_count,
      'amenities',coalesce(l.amenities,array[]::text[]),
      'created_at',l.created_at,
      'updated_at',l.updated_at,
      'gps_latitude',null,
      'gps_longitude',null,
      'location_accuracy_m',null,
      'location_exact',false,
      'partner_display_name',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
    ) order by l.created_at desc
  ),'[]'::jsonb)
  from public.listings l
  left join public.profiles p on p.user_id=coalesce(l.partner_id,l.owner_id)
  where l.deleted_at is null
    and l.inspection_request_id is not null
    and l.approved_at is not null
    and l.status='available'
    and l.availability_status='available'
$function$;
revoke all on function public.get_discoverable_listings() from public, anon, authenticated, service_role;

grant execute on function public.get_discoverable_listings() to service_role;
grant execute on function public.get_discoverable_listings() to anon;
grant execute on function public.get_discoverable_listings() to authenticated;

CREATE OR REPLACE FUNCTION public.get_hotel_review_summary(p_hotel_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if public.get_public_hotel_detail(p_hotel_id) is null then return null; end if;
  return jsonb_build_object(
    'reviews',coalesce((select jsonb_agg(review order by created_at desc) from (
      select r.created_at,jsonb_build_object(
        'review_id',r.review_id,
        'hotel_id',r.hotel_id,
        'rating',r.rating,
        'comment',r.comment,
        'created_at',r.created_at,
        'profiles',jsonb_build_object('username',p.username,'avatar_url',p.avatar_url)
      ) review
      from public.hotel_reviews r
      left join public.profiles p on p.user_id=r.user_id
      where r.hotel_id=p_hotel_id
      order by r.created_at desc limit 100
    ) rows),'[]'::jsonb),
    'eligible',exists(
      select 1 from public.hotel_bookings b
      where b.hotel_id=p_hotel_id
        and b.user_id=public.current_profile_user_id()
        and b.payment_status='paid'
        and b.checked_in_at is not null
        and (b.checked_out_at is not null or b.status='completed')
        and b.status in ('checked_out','completed')
    )
  );
end
$function$;
revoke all on function public.get_hotel_review_summary(p_hotel_id integer) from public, anon, authenticated, service_role;

grant execute on function public.get_hotel_review_summary(p_hotel_id integer) to service_role;
grant execute on function public.get_hotel_review_summary(p_hotel_id integer) to anon;
grant execute on function public.get_hotel_review_summary(p_hotel_id integer) to authenticated;

CREATE OR REPLACE FUNCTION public.get_listing_review_summary(p_listing_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_listing public.listings;
  v_actor text:=public.current_profile_user_id();
  v_eligible_reservation text;
begin
  if public.get_public_listing_detail(p_listing_id) is null then return null; end if;
  select * into v_listing from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.deleted_at is null limit 1;

  if v_actor is not null then
    select r.id into v_eligible_reservation
    from public.reservations r
    where r.listing_id=v_listing.id::text
      and r.user_id=v_actor
      and not exists(
        select 1 from public.listing_reviews review
        where review.reservation_id=r.id
      )
      and (
        (
          r.stay_type='short_let'
          and r.checked_in_at is not null
          and (r.checked_out_at is not null or r.status in ('completed','cancelled','refunded'))
          and r.rent_payment_status='paid'
        )
        or (
          coalesce(r.stay_type,'long_stay')='long_stay'
          and (r.verified_handover_at is not null or r.occupancy_started_at is not null)
          and r.status in ('occupied','completed','cancelled','refunded')
          and r.rent_payment_status in ('upfront_paid','paid')
        )
      )
    order by coalesce(r.checked_out_at,r.completed_at,r.processed_at,r.updated_at) desc
    limit 1;
  end if;

  return jsonb_build_object(
    'rating',v_listing.rating,
    'review_count',v_listing.review_count,
    'reviews',coalesce((
      select jsonb_agg(review order by created_at desc) from (
        select r.created_at,jsonb_build_object(
          'review_id',r.review_id,
          'listing_id',r.listing_id,
          'rating',r.rating,
          'comment',r.comment,
          'created_at',r.created_at,
          'profiles',jsonb_build_object(
            'username',p.username,
            'avatar_url',p.avatar_url
          )
        ) review
        from public.listing_reviews r
        left join public.profiles p on p.user_id=r.user_id
        where r.listing_id=v_listing.id
        order by r.created_at desc
        limit 100
      ) rows
    ),'[]'::jsonb),
    'eligible',v_eligible_reservation is not null,
    'eligible_reservation_id',v_eligible_reservation
  );
end
$function$;
revoke all on function public.get_listing_review_summary(p_listing_id text) from public, anon, authenticated, service_role;

grant execute on function public.get_listing_review_summary(p_listing_id text) to service_role;
grant execute on function public.get_listing_review_summary(p_listing_id text) to anon;
grant execute on function public.get_listing_review_summary(p_listing_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_accommodation_no_show_review_queue(p_status text DEFAULT 'submitted'::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  select * into v_actor from public.profiles
  where user_id=public.current_profile_user_id()
    and role in('creator','admin','staff')
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false);
  if v_actor.user_id is null
     or (v_actor.role='staff' and not public.current_staff_has_permission('operations')) then
    raise exception 'Property Operations access required';
  end if;
  if p_status not in('submitted','approved','rejected','all') then
    raise exception 'Unsupported review status';
  end if;

  select coalesce(jsonb_agg(to_jsonb(queue_row) order by queue_row.created_at),'[]'::jsonb)
  into v_result
  from (
    select
      review.no_show_review_id,review.subject_type,review.subject_id,
      review.requested_by,coalesce(requester.full_name,requester.username,'Provider') requested_by_name,
      review.property_ready_evidence,review.explanation,review.arrival_deadline_at,
      review.status,review.reviewed_by,review.reviewed_at,review.decision_reason,
      review.release_action_id,review.caution_refund_action_id,
      review.created_at,review.updated_at,
      case when review.subject_type='short_let' then coalesce(listing.title,'Short Let')
        else coalesce(hotel.name,'Hotel') end subject_label,
      case when review.subject_type='short_let'
        then concat_ws(', ',listing.city,listing.state)
        else concat_ws(', ',hotel.city,hotel.state) end subject_location,
      case when review.subject_type='short_let' then reservation.stay_rent_total
        else booking.total_price end accommodation_amount,
      case when review.subject_type='short_let' then reservation.booking_code
        else booking.booking_code end booking_code
    from public.accommodation_no_show_reviews review
    join public.profiles requester on requester.user_id=review.requested_by
    left join public.reservations reservation
      on review.subject_type='short_let' and reservation.id=review.subject_id
    left join lateral(
      select candidate.* from public.listings candidate
      where candidate.id::text=reservation.listing_id
         or candidate.listing_id=reservation.listing_id
      limit 1
    ) listing on true
    left join public.hotel_bookings booking
      on review.subject_type='hotel' and booking.booking_id::text=review.subject_id
    left join public.hotels hotel on hotel.hotel_id=booking.hotel_id
    where (p_status='all' or review.status=p_status)
      and (
        v_actor.role='creator'
        or (review.subject_type='short_let'
          and public.current_actor_in_scope(listing.state,listing.city))
        or (review.subject_type='hotel'
          and public.current_actor_in_scope(hotel.state,hotel.city))
      )
    order by review.created_at
    limit least(greatest(coalesce(p_limit,50),1),100)
  ) queue_row;
  return v_result;
end
$function$;
revoke all on function public.get_my_accommodation_no_show_review_queue(p_status text, p_limit integer) from public, anon, authenticated, service_role;

grant execute on function public.get_my_accommodation_no_show_review_queue(p_status text, p_limit integer) to service_role;
grant execute on function public.get_my_accommodation_no_show_review_queue(p_status text, p_limit integer) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_accommodation_no_show_subject(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_profile public.profiles;
  v_res public.reservations;
  v_listing public.listings;
  v_booking public.hotel_bookings;
  v_hotel public.hotels;
  v_review public.accommodation_no_show_reviews;
  v_deadline timestamptz;
  v_access boolean:=false;
  v_eligible boolean:=false;
  v_reason text:='This stay is not eligible for no-show review.';
  v_label text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_subject_type not in('short_let','hotel') then raise exception 'Unsupported stay type'; end if;
  select * into v_profile from public.profiles where user_id=v_actor;

  if p_subject_type='short_let' then
    select * into v_res from public.reservations
    where id=p_subject_id and stay_type='short_let';
    if v_res.id is null then raise exception 'Short Let stay not found'; end if;
    select * into v_listing from public.listings
    where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
    v_access:=(v_res.management_mode_snapshot='host'
      and v_res.responsible_host_user_id=v_actor
      and public.current_actor_can_manage_property(v_listing.id))
      or (v_profile.role in('creator','admin','staff')
        and (v_profile.role<>'staff' or public.current_staff_has_permission('operations'))
        and (v_profile.role='creator' or public.current_actor_in_scope(v_listing.state,v_listing.city)));
    v_label:=coalesce(v_listing.title,'Short Let stay');
    if v_res.requested_move_in_at is not null then
      v_deadline:=v_res.requested_move_in_at
        +make_interval(hours=>greatest(coalesce(v_res.arrival_issue_window_hours,2),1));
    end if;
    if v_res.short_stay_rate_type<>'non_refundable' then
      v_reason:='Only a booked Non-refundable rate can use this review.';
    elsif v_res.rent_payment_status<>'paid' then
      v_reason:='The accommodation payment is not confirmed.';
    elsif v_res.status<>'ready_for_move_in' or v_res.checked_in_at is not null then
      v_reason:='This stay is no longer awaiting guest arrival.';
    elsif v_deadline is null then
      v_reason:='Record the agreed arrival time before requesting review.';
    elsif now()<v_deadline then
      v_reason:='The guest arrival window is still open.';
    else
      v_eligible:=true;
      v_reason:='Upload current property-ready photos and explain the attempted arrival handover.';
    end if;
  else
    select * into v_booking from public.hotel_bookings
    where booking_id::text=p_subject_id;
    if v_booking.booking_id is null then raise exception 'Hotel stay not found'; end if;
    select * into v_hotel from public.hotels where hotel_id=v_booking.hotel_id;
    v_access:=public.hotel_actor_has_capability(v_booking.hotel_id,'stay.check_in')
      or (v_profile.role in('creator','admin','staff')
        and (v_profile.role<>'staff' or public.current_staff_has_permission('operations'))
        and (v_profile.role='creator' or public.current_actor_in_scope(v_hotel.state,v_hotel.city)));
    v_label:=coalesce(v_hotel.name,'Hotel stay');
    v_deadline:=((v_booking.check_in::text||' '||v_hotel.check_in_time::text)::timestamp
      at time zone v_hotel.timezone)
      +make_interval(hours=>greatest(coalesce(v_booking.arrival_issue_window_hours,2),1));
    if coalesce(v_booking.rate_plan_snapshot->>'cancellation_template',
      case when coalesce((v_booking.rate_plan_snapshot->>'refundable')::boolean,false)
        then 'standard_legacy' else 'non_refundable' end)<>'non_refundable' then
      v_reason:='Only a booked Non-refundable package can use this review.';
    elsif v_booking.payment_status<>'paid' then
      v_reason:='The accommodation payment is not confirmed.';
    elsif v_booking.status<>'confirmed' or v_booking.checked_in_at is not null then
      v_reason:='This stay is no longer awaiting guest arrival.';
    elsif now()<v_deadline then
      v_reason:='The guest arrival window is still open.';
    else
      v_eligible:=true;
      v_reason:='Upload current room-ready photos and explain the attempted check-in.';
    end if;
  end if;

  if not v_access then raise exception 'Responsible arrival operator access required'; end if;
  select * into v_review
  from public.accommodation_no_show_reviews
  where subject_type=p_subject_type and subject_id=p_subject_id
  order by created_at desc limit 1;
  return jsonb_build_object(
    'subject_type',p_subject_type,
    'subject_id',p_subject_id,
    'label',v_label,
    'eligible',v_eligible and v_review.no_show_review_id is null,
    'eligibility_reason',case when v_review.no_show_review_id is null then v_reason
      else 'A no-show review has already been submitted for this stay.' end,
    'arrival_deadline_at',v_deadline,
    'review',case when v_review.no_show_review_id is null then null else to_jsonb(v_review) end
  );
end
$function$;
revoke all on function public.get_my_accommodation_no_show_subject(p_subject_type text, p_subject_id text) from public, anon, authenticated, service_role;

grant execute on function public.get_my_accommodation_no_show_subject(p_subject_type text, p_subject_id text) to service_role;
grant execute on function public.get_my_accommodation_no_show_subject(p_subject_type text, p_subject_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_home_pet_policies()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'pets_allowed',l.pets_allowed)
   order by l.title),'[]'::jsonb)
 from public.property_host_assignments a join public.listings l on l.id=a.listing_id
 where a.user_id=public.current_profile_user_id() and a.assignment_role='owner'
   and a.status='active' and l.deleted_at is null and l.sub_type='short_let'
$function$;
revoke all on function public.get_my_home_pet_policies() from public, anon, authenticated, service_role;

grant execute on function public.get_my_home_pet_policies() to service_role;
grant execute on function public.get_my_home_pet_policies() to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_hotel_bookings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user text:=public.current_profile_user_id();
begin
  if v_user is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;

  return coalesce((
    select jsonb_agg(
      to_jsonb(booking)||jsonb_build_object(
        'hotels',(
          to_jsonb(hotel)
            -'gps_latitude'-'gps_longitude'-'owner_id'
            -'inspection_request_id'-'approved_by'
        )||jsonb_build_object(
          'address',hotel.address,
          'gps_latitude',null,
          'gps_longitude',null,
          'location_exact',false
        ),
        'hotel_rooms',to_jsonb(room),
        'hotel_rate_plans',to_jsonb(rate_plan)
      )
      order by booking.created_at desc
    )
    from public.hotel_bookings booking
    join public.hotels hotel on hotel.hotel_id=booking.hotel_id
    join public.hotel_rooms room on room.room_id=booking.room_id
    left join public.hotel_rate_plans rate_plan
      on rate_plan.rate_plan_id=booking.rate_plan_id
    where booking.user_id=v_user
  ),'[]'::jsonb);
end
$function$;
revoke all on function public.get_my_hotel_bookings() from public, anon, authenticated, service_role;

grant execute on function public.get_my_hotel_bookings() to service_role;
grant execute on function public.get_my_hotel_bookings() to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_managed_properties()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'listing_id',l.listing_id,'title',l.title,
    'address',l.address,'city',l.city,'state',l.state,
    'images',l.images,'videos',l.videos,'price',l.price,
    'availability_status',l.availability_status,'status',l.status,
    'property_type',l.property_type,'sub_type',l.sub_type,
    'bedrooms',l.bedrooms,'bathrooms',l.bathrooms,
    'management_mode',l.management_mode,
    'management_updated_at',l.management_updated_at,
    '_assignment_role','owner','_assignment_status',a.status,
    '_access_level','full_hosting','_can_manage',true,
    '_can_control_commercials',l.management_mode='host','_is_owner',true
  ) order by l.created_at desc),'[]'::jsonb) into v_result
  from public.property_host_assignments a
  join public.listings l on l.id=a.listing_id
  where a.user_id=v_actor and a.assignment_role='owner' and a.status='active'
    and l.deleted_at is null and l.approved_at is not null
    and l.status in ('available','unavailable','reserved','occupied','maintenance','closed');
  return v_result;
end
$function$;
revoke all on function public.get_my_managed_properties() from public, anon, authenticated, service_role;

grant execute on function public.get_my_managed_properties() to service_role;
grant execute on function public.get_my_managed_properties() to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_partner_pro()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_price_month numeric:=0; v_price_year numeric:=0;
 v_sales boolean:=false; v_terms text:=''; v_version text:=''; v_sha text;
 v_end timestamptz; v_review timestamptz; v_accepted boolean:=false; v_month_plan text; v_year_plan text;
 v_subscription public.partner_pro_subscriptions;
begin
 if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then raise exception 'Property Partner workspace required'; end if;
 select coalesce(nullif(value,'')::numeric,0) into v_price_month from public.platform_settings where key='partner_pro_monthly_price_ngn' and is_active;
 select coalesce(nullif(value,'')::numeric,0) into v_price_year from public.platform_settings where key='partner_pro_yearly_price_ngn' and is_active;
 select lower(value) in ('true','1','yes','on') into v_sales from public.platform_settings where key='partner_pro_sales_enabled' and is_active;
 select value into v_month_plan from public.platform_settings where key='partner_pro_monthly_plan_code' and is_active;
 select value into v_year_plan from public.platform_settings where key='partner_pro_yearly_plan_code' and is_active;
 select coalesce(value,'') into v_version from public.platform_settings where key='partner_pro_terms_version' and is_active;
 select coalesce(value,'') into v_terms from public.platform_settings where key='partner_pro_terms_content' and is_active;
 select current_period_end,review_started_at into v_end,v_review from public.partner_pro_entitlements where partner_id=v_actor;
 select * into v_subscription from public.partner_pro_subscriptions where partner_id=v_actor;
 v_sha:=encode(extensions.digest(convert_to(coalesce(v_terms,''),'UTF8'),'sha256'),'hex');
 select exists(select 1 from public.partner_pro_terms_acceptances where partner_id=v_actor and terms_version=v_version and terms_sha256=v_sha) into v_accepted;
 return jsonb_build_object('active',coalesce(v_end>now() and v_review is null,false),'under_review',v_review is not null,
   'current_period_end',v_end,'sales_enabled',coalesce(v_sales,false),'monthly_price_ngn',coalesce(v_price_month,0),
   'yearly_price_ngn',coalesce(v_price_year,0),'terms_version',coalesce(v_version,''),'terms_content',coalesce(v_terms,''),
   'terms_accepted',v_accepted,'auto_renews',coalesce(v_subscription.auto_renews,false),
   'subscription_period',v_subscription.billing_period,'monthly_renewal_ready',nullif(v_month_plan,'') is not null,
   'yearly_renewal_ready',nullif(v_year_plan,'') is not null,'subscription_managed',v_subscription.subscription_code is not null);
end $function$;
revoke all on function public.get_my_partner_pro() from public, anon, authenticated, service_role;

grant execute on function public.get_my_partner_pro() to service_role;
grant execute on function public.get_my_partner_pro() to authenticated;

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
    select id,asset_kind,asset_id,title,due_on,status,created_at from public.partner_pro_tasks
    where owner_id=v_actor and public.partner_pro_owns_asset(asset_kind,asset_id)
    order by due_on nulls last,created_at desc limit 200
  ) t;
  return jsonb_build_object('assets',v_assets,'stays',v_stays,'income',v_income,
    'tasks',v_tasks,'stays_limited',jsonb_array_length(v_stays)=1000,
    'tasks_limited',jsonb_array_length(v_tasks)=200);
end $function$;
revoke all on function public.get_my_partner_pro_overview() from public, anon, authenticated, service_role;

grant execute on function public.get_my_partner_pro_overview() to service_role;
grant execute on function public.get_my_partner_pro_overview() to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_payment_receipts(p_reference text DEFAULT NULL::text, p_subject_type text DEFAULT NULL::text, p_subject_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_user text; v_result jsonb;
begin
  select user_id into v_user from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false);
  if v_user is null then raise exception 'Active account required'; end if;
  select coalesce(jsonb_agg(receipt order by paid_at desc),'[]'::jsonb) into v_result
  from (
    select coalesce(bp.paid_at,bp.verified_at) paid_at,
      jsonb_build_object(
        'id',bp.id,'reference',coalesce(bp.paystack_reference,bp.payment_reference),
        'purpose',bp.purpose,'amount',bp.verified_amount,'currency',bp.currency,
        'paid_at',coalesce(bp.paid_at,bp.verified_at),'status',bp.status,
        'refund_processed_at',bp.refund_processed_at,
        'environment',case when bp.metadata->>'paystack_domain' in ('test','live') then bp.metadata->>'paystack_domain' else null end,
        'payer_name',coalesce(nullif(hb.guest_name,''),nullif(p.full_name,''),p.username,'WeHouse customer'),
        'merchant_name',coalesce(h.name,r.listing_title,nullif(worker.full_name,''),worker.username,'WeHouse'),
        'description',case when bp.purpose='hotel_booking' then coalesce(hr.room_type,'Hotel stay')
          when bp.purpose='worker_booking' then coalesce(wb.service_type,'Service booking')
          when r.stay_type='short_let' then 'Short Let stay'
          when bp.purpose='apartment_reservation' then 'Apartment reservation fee'
          when bp.purpose='apartment_rent' then 'Apartment rent'
          when bp.purpose='worker_pro_subscription' then 'Worker Pro subscription'
          when bp.purpose='shared_housing_share' then 'Shared home contribution'
          else 'WeHouse payment' end,
        'package_name',hb.rate_plan_name,'cancellation_snapshot',hb.cancellation_snapshot,
        'booking_id',coalesce(hb.booking_id::text,wb.id::text,r.id),
        'booking_type',case when hb.booking_id is not null then 'hotel' when wb.id is not null then 'service' when r.id is not null then 'housing' else null end,
        'check_in',coalesce(hb.check_in,r.stay_check_in),'check_out',coalesce(hb.check_out,r.stay_check_out),
        'nights',coalesce(hb.total_nights,r.stay_nights),'guests',coalesce(hb.guest_count,r.guest_count),
        'stay_amount',case when r.stay_type='short_let' then r.stay_rent_total else null end,
        'deposit_amount',case when r.stay_type='short_let' then r.security_deposit_snapshot else null end
      ) receipt
    from public.booking_payments bp
    join public.profiles p on p.user_id=v_user
    left join public.hotel_bookings hb on hb.booking_id=bp.hotel_booking_id
    left join public.hotels h on h.hotel_id=hb.hotel_id
    left join public.hotel_rooms hr on hr.room_id=hb.room_id
    left join public.worker_bookings wb on wb.id=bp.worker_booking_id
    left join public.profiles worker on worker.user_id=wb.worker_id
    left join public.reservations r on r.id=bp.metadata->>'reservation_id'
    where coalesce(bp.payer_user_id,bp.user_id)=v_user
      and bp.status in ('paid','completed','refunded','partially_refunded')
      and bp.verified_at is not null and bp.paystack_transaction_id is not null
      and bp.verified_amount is not null
      and (p_reference is null or p_reference=coalesce(bp.paystack_reference,bp.payment_reference))
      and (p_subject_type is null
        or (p_subject_type='hotel' and hb.booking_id::text=p_subject_id)
        or (p_subject_type='service' and wb.id::text=p_subject_id)
        or (p_subject_type='housing' and r.id=p_subject_id))
    order by coalesce(bp.paid_at,bp.verified_at) desc
    limit 100
  ) receipts;
  return v_result;
end;
$function$;
revoke all on function public.get_my_payment_receipts(p_reference text, p_subject_type text, p_subject_id text) from public, anon, authenticated, service_role;

grant execute on function public.get_my_payment_receipts(p_reference text, p_subject_type text, p_subject_id text) to service_role;
grant execute on function public.get_my_payment_receipts(p_reference text, p_subject_type text, p_subject_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_property_change_requests(p_listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not exists(
    select 1 from public.property_host_assignments a
    where a.listing_id=p_listing_id and a.user_id=v_actor and a.status='active'
  ) then raise exception 'Property access required'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb)
  into v_result from public.property_change_requests r
  where r.listing_id=p_listing_id and r.requested_by=v_actor;
  return v_result;
end
$function$;
revoke all on function public.get_my_property_change_requests(p_listing_id uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_my_property_change_requests(p_listing_id uuid) to service_role;
grant execute on function public.get_my_property_change_requests(p_listing_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_property_host_controls(p_listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_listing public.listings;
  v_platform_min integer:=1;
  v_platform_max integer:=90;
  v_min_nights integer;
  v_max_nights integer;
  v_access text;
  v_cancellation jsonb:='{}'::jsonb;
begin
  if not public.current_actor_can_manage_property(p_listing_id) then
    raise exception 'You do not manage this property';
  end if;
  v_access:=public.current_actor_property_host_access_level(p_listing_id);

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null;
  if v_listing.id is null then raise exception 'Property not found'; end if;

  if v_listing.sub_type='short_let' then
    select coalesce(nullif(value,'')::integer,1) into v_platform_min
    from public.platform_settings
    where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
    select coalesce(nullif(value,'')::integer,90) into v_platform_max
    from public.platform_settings
    where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
    v_platform_min:=greatest(coalesce(v_platform_min,1),1);
    v_platform_max:=greatest(coalesce(v_platform_max,90),v_platform_min);
    v_min_nights:=greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min);
    v_max_nights:=least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max);
    v_max_nights:=greatest(v_max_nights,v_min_nights);

    select p.value into v_cancellation
    from public.creator_policy_versions p
    where p.policy_key='short_let_cancellation'
      and p.scope_type='global' and p.scope_key='*' and p.status='active'
      and p.effective_from<=now()
      and (p.effective_until is null or p.effective_until>now())
    order by p.effective_from desc,p.version desc limit 1;
  end if;

  return jsonb_build_object(
    'listing_id',v_listing.id,
    'sub_type',v_listing.sub_type,
    'price',v_listing.price,
    'currency',coalesce(v_listing.currency,'NGN'),
    'status',v_listing.status,
    'availability_status',v_listing.availability_status,
    'host_booking_paused',v_listing.host_booking_paused,
    'access_level',v_access,
    'can_manage_commercials',public.current_actor_can_change_property_commercials(v_listing.id),
    'accepting_reservations',
      (not v_listing.host_booking_paused
       and v_listing.status='available'
       and v_listing.availability_status='available'),
    'min_nights',case when v_listing.sub_type='short_let' then v_min_nights else null end,
    'max_nights',case when v_listing.sub_type='short_let' then v_max_nights else null end,
    'non_refundable_rate_enabled',case when v_listing.sub_type='short_let'
      then v_listing.non_refundable_rate_enabled else false end,
    'non_refundable_discount_percent',case when v_listing.sub_type='short_let'
      then v_listing.non_refundable_discount_percent else null end,
    'standard_cancellation',v_cancellation,
    'date_blocks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'block_id',b.block_id,
        'start_date',b.start_date,
        'reopen_date',b.reopen_date,
        'created_at',b.created_at
      ) order by b.start_date)
      from public.property_host_date_blocks b
      where b.listing_id=v_listing.id and b.reopened_at is null
    ),'[]'::jsonb)
  );
end
$function$;
revoke all on function public.get_my_property_host_controls(p_listing_id uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_my_property_host_controls(p_listing_id uuid) to service_role;
grant execute on function public.get_my_property_host_controls(p_listing_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_property_host_controls_v2(p_listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_result jsonb:=public.get_my_property_host_controls(p_listing_id);
  v_terms jsonb;
begin
  select value into v_terms from public.creator_policy_versions
  where policy_key='accommodation_non_refundable_rate'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  if v_terms is null then raise exception 'Accommodation rate terms are unavailable'; end if;
  return v_result||jsonb_build_object(
    'non_refundable_discount_limits',jsonb_build_object(
      'minimum_percent',(v_terms->>'minimum_discount_percent')::numeric,
      'maximum_percent',(v_terms->>'maximum_discount_percent')::numeric
    )
  );
end
$function$;
revoke all on function public.get_my_property_host_controls_v2(p_listing_id uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_my_property_host_controls_v2(p_listing_id uuid) to service_role;
grant execute on function public.get_my_property_host_controls_v2(p_listing_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_property_management(p_listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_listing public.listings; v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_listing from public.listings where id=p_listing_id and deleted_at is null;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if not public.current_actor_can_manage_property(v_listing.id) then
    raise exception 'You do not manage this property';
  end if;

  return jsonb_build_object(
    'listing_id',v_listing.id,
    'management_mode',v_listing.management_mode,
    'wehouse_management_status',v_listing.wehouse_management_status,
    'management_host_user_id',v_listing.management_host_user_id,
    'management_updated_at',v_listing.management_updated_at,
    'assignments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id',a.assignment_id,
        'user_id',a.user_id,
        'name',coalesce(p.full_name,p.username),
        'username',p.username,
        'role',a.assignment_role,
        'status',a.status,
        'access_level',case when a.assignment_role='owner' then 'full_hosting' else a.access_level end
      ) order by a.assignment_role,a.created_at)
      from public.property_host_assignments a
      join public.profiles p on p.user_id=a.user_id
      where a.listing_id=v_listing.id and a.status<>'revoked'
    ),'[]'::jsonb)
  );
end
$function$;
revoke all on function public.get_my_property_management(p_listing_id uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_my_property_management(p_listing_id uuid) to service_role;
grant execute on function public.get_my_property_management(p_listing_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_property_partner_stays(p_listing_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select coalesce(jsonb_agg(to_jsonb(stay) order by stay.created_at desc),'[]'::jsonb)
  into v_result from (
    select r.id reservation_id,coalesce(r.stay_type,'long_stay') stay_type,r.status,
      r.rent_payment_status payment_status,r.manual_payment_status,
      r.reservation_fee_status,r.reservation_fee_snapshot,r.reservation_fee_paid_at,
      r.rent_paid_at,r.stay_check_in check_in,r.stay_check_out check_out,r.stay_nights nights,
      coalesce(r.guest_count,1) guest_count,r.requested_move_in_at,r.move_in_requested_at,
      r.tenancy_start_date,r.tenancy_end_date,r.created_at,
      r.management_mode_snapshot,r.responsible_host_user_id,
      l.id::text listing_id,l.listing_id public_listing_code,l.title listing_title,
      a.assignment_role,
      case when a.assignment_role='owner' then 'full_hosting' else a.access_level end access_level
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id
    join public.property_host_assignments a
      on a.listing_id=l.id and a.user_id=v_actor and a.status='active'
    where (p_listing_id is null or l.id::text=p_listing_id or l.listing_id=p_listing_id)
      and public.current_actor_can_manage_property(l.id)
      and (
        (r.management_mode_snapshot='host'
          and (a.assignment_role='owner' or r.responsible_host_user_id=v_actor)
          and (r.reservation_fee_status='paid' or r.manual_payment_status in ('paid','completed')))
        or (r.management_mode_snapshot='wehouse' and a.assignment_role='owner'
          and ((coalesce(r.stay_type,'long_stay')='short_let'
            and ((r.rent_payment_status='paid' and r.rent_paid_at is not null)
              or r.status in ('occupied','completed')))
          or (coalesce(r.stay_type,'long_stay')<>'short_let'
            and ((r.rent_payment_status in ('paid','upfront_paid') and r.rent_paid_at is not null)
              or r.status in ('occupied','completed')))))
      )
    order by r.created_at desc limit 50
  ) stay;
  return v_result;
end
$function$;
revoke all on function public.get_my_property_partner_stays(p_listing_id text) from public, anon, authenticated, service_role;

grant execute on function public.get_my_property_partner_stays(p_listing_id text) to service_role;
grant execute on function public.get_my_property_partner_stays(p_listing_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_staff_security_monitor()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  v_actor:=public._current_team_actor();
  if v_actor.role<>'staff' or not public.current_staff_has_permission('security_operations') then
    raise exception 'Security Operations access required';
  end if;
  if nullif(btrim(v_actor.assigned_state),'') is null then
    raise exception 'Security Operations coverage is incomplete';
  end if;

  with scoped_profiles as (
    select p.* from public.profiles p
    where public.current_actor_in_scope(
      coalesce(nullif(p.assigned_state,''),nullif(p.state,'')),
      coalesce(nullif(p.assigned_lga,''),nullif(p.local_government,''),nullif(p.city,''))
    )
  ), recent_sessions as (
    select s.*,p.full_name,p.username,p.role
    from public.user_sessions s
    join scoped_profiles p on p.user_id=s.user_id
    where s.login_time>=now()-interval '30 days'
  ), untrusted_devices as (
    select user_id,
      coalesce(max(full_name),max(username),'Account') name,
      count(*) attempts,
      max(login_time) last_attempt
    from recent_sessions
    where trust_status='pending' and login_time>=now()-interval '24 hours'
    group by user_id
  ), concurrent_devices as (
    select user_id,
      coalesce(max(full_name),max(username),'Account') name,
      count(distinct coalesce(nullif(device_id,''),id::text)) devices,
      count(distinct nullif(ip_address,'')) networks
    from recent_sessions
    where is_active=true and last_seen>=now()-interval '2 hours'
    group by user_id
    having count(distinct coalesce(nullif(device_id,''),id::text))>=3
  ), bursts as (
    select user_id,
      coalesce(max(full_name),max(username),'Account') name,
      count(*) attempts
    from recent_sessions
    where login_time>=now()-interval '30 minutes'
    group by user_id
    having count(*)>=5
  ), provider_risk as (
    select distinct
      coalesce(bp.payer_user_id,bp.user_id) user_id,
      coalesce(p.full_name,p.username,'Account') name,
      e.event_type,
      e.processing_status,
      e.provider_reference,
      e.received_at
    from public.verified_provider_events e
    join public.booking_payments bp
      on bp.paystack_reference=e.provider_reference
    join scoped_profiles p
      on p.user_id=coalesce(bp.payer_user_id,bp.user_id)
    where e.received_at>=now()-interval '7 days'
      and (
        lower(e.event_type) like '%chargeback%'
        or lower(e.event_type) like '%dispute%'
        or e.processing_status='failed'
      )
  ), privilege_changes as (
    select h.user_id,
      coalesce(p.full_name,p.username,'Account') name,
      h.old_role,h.new_role,h.changed_by,h.created_at
    from public.role_change_history h
    join scoped_profiles p on p.user_id=h.user_id
    where h.created_at>=now()-interval '7 days'
      and h.new_role in ('staff','admin','creator')
  ), restricted as (
    select count(*)::integer total from scoped_profiles
    where coalesce(banned,false) or coalesce(suspended,false) or coalesce(deleted,false)
  ), alerts as (
    select jsonb_build_object(
      'kind','untrusted_device',
      'severity','high',
      'target_user_id',user_id,
      'title','Unreviewed device sign-in',
      'detail',name||' has '||attempts||' recent device sign-in'||case when attempts=1 then '' else 's' end||' awaiting account verification.'
    ) item from untrusted_devices
    union all
    select jsonb_build_object(
      'kind','concurrent_devices',
      'severity','review',
      'target_user_id',user_id,
      'title','Concurrent device pattern',
      'detail',name||' has '||devices||' recently active devices across '||networks||' recorded network'||case when networks=1 then '' else 's' end||'. Confirm the devices before escalation.'
    ) from concurrent_devices
    union all
    select jsonb_build_object(
      'kind','login_burst',
      'severity','high',
      'target_user_id',user_id,
      'title','Rapid sign-in pattern',
      'detail',name||' recorded '||attempts||' session starts within 30 minutes. Review device trust and the authentication trail.'
    ) from bursts
    union all
    select jsonb_build_object(
      'kind','provider_payment_risk',
      'severity','high',
      'target_user_id',user_id,
      'title','Payment provider risk event',
      'detail',name||' has a verified '||replace(event_type,'_',' ')||' event ('||processing_status||') for reference '||provider_reference||'. Coordinate with Finance before any account decision.'
    ) from provider_risk
    union all
    select jsonb_build_object(
      'kind','privileged_access_change',
      'severity','review',
      'target_user_id',user_id,
      'title','Privileged access changed',
      'detail',name||' changed from '||old_role||' to '||new_role||'. Verify the recorded authority and audit trail.'
    ) from privilege_changes
  ), auth_events as (
    select a.id,a.created_at,
      coalesce(a.payload->>'action','authentication_event') action,
      coalesce(p.full_name,p.username,'Branch account') name
    from auth.audit_log_entries a
    join scoped_profiles p
      on p.auth_id=coalesce(a.payload->>'user_id',a.payload->>'actor_id')
    where a.created_at>=now()-interval '30 days'
    order by a.created_at desc
    limit 50
  )
  select jsonb_build_object(
    'stats',jsonb_build_object(
      'active_sessions',(select count(*) from recent_sessions where is_active=true),
      'untrusted_devices',(select coalesce(sum(attempts),0) from untrusted_devices),
      'concurrent_device_accounts',(select count(*) from concurrent_devices),
      'login_bursts',(select count(*) from bursts),
      'provider_risk_events',(select count(*) from provider_risk),
      'privilege_changes',(select count(*) from privilege_changes),
      'restricted_accounts',(select total from restricted)
    ),
    'alerts',coalesce((select jsonb_agg(item) from alerts),'[]'::jsonb),
    'sessions',coalesce((
      select jsonb_agg(x order by x.last_seen desc) from (
        select user_id,id session_id,coalesce(full_name,username,'Branch account') name,
          role,device,browser,os,is_active,last_seen,login_time,trust_status
        from recent_sessions order by last_seen desc nulls last limit 50
      ) x
    ),'[]'::jsonb),
    'admin_actions',coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select a.id,a.action,a.target_type,a.target_id,a.details,
          a.admin_id actor_id,a.admin_email actor_email,a.created_at
        from public.admin_audit_log a
        left join public.profiles actor on actor.user_id=a.admin_id
        where a.created_at>=now()-interval '30 days'
          and public.current_actor_in_scope(
            coalesce(nullif(actor.assigned_state,''),v_actor.assigned_state),
            coalesce(nullif(actor.assigned_lga,''),v_actor.assigned_lga)
          )
        order by a.created_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'auth_events',coalesce((select jsonb_agg(auth_events order by created_at desc) from auth_events),'[]'::jsonb),
    'auth_audit_available',true
  ) into v_result;
  return v_result;
end
$function$;
revoke all on function public.get_my_staff_security_monitor() from public, anon, authenticated, service_role;

grant execute on function public.get_my_staff_security_monitor() to service_role;
grant execute on function public.get_my_staff_security_monitor() to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_worker_pro_business()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.worker_pro_current_actor();
begin
  return jsonb_build_object(
    'schedule',coalesce((select jsonb_agg(to_jsonb(j) order by j.scheduled_date,j.booking_code)
      from (select b.id,b.booking_code,b.service_type,b.scheduled_date,b.status,
        coalesce(nullif(customer.full_name,''),customer.username,'Customer') customer_name
        from public.worker_bookings b left join public.profiles customer on customer.user_id=b.user_id
        where b.worker_id=v_actor and b.scheduled_date between current_date-30 and current_date+365
          and b.status in ('confirmed','in_progress','completed_pending_approval')
        order by b.scheduled_date,b.created_at limit 150) j),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(to_jsonb(c) order by c.completed_jobs desc,c.last_job_at desc)
      from (select b.user_id customer_id,coalesce(nullif(p.full_name,''),p.username,'Customer') customer_name,
        count(*) completed_jobs,max(coalesce(b.completed_at,b.updated_at)) last_job_at,
        max(b.service_type) last_service,coalesce(n.note,'') note
        from public.worker_bookings b join public.profiles p on p.user_id=b.user_id
        join public.worker_customer_record_consents consent on consent.worker_id=b.worker_id and consent.customer_id=b.user_id
        left join public.worker_pro_customer_notes n on n.worker_id=v_actor and n.customer_id=b.user_id
        where b.worker_id=v_actor and b.status='approved_released'
        group by b.user_id,p.full_name,p.username,n.note
        order by count(*) desc,max(coalesce(b.completed_at,b.updated_at)) desc limit 100) c),'[]'::jsonb),
    'packages',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at)
      from (select id,title,description,price_ngn,active,created_at
        from public.worker_pro_service_packages where worker_id=v_actor
        order by created_at limit 20) p),'[]'::jsonb),
    'reminders',coalesce((select jsonb_agg(to_jsonb(r) order by r.due_at)
      from (select id,booking_id,due_at,note,done_at from public.worker_pro_reminders
        where worker_id=v_actor and (done_at is null or due_at>now()-interval '30 days')
        order by due_at limit 150) r),'[]'::jsonb),
    'receipts',coalesce((select jsonb_agg(to_jsonb(r) order by r.completed_at desc)
      from (select b.id booking_id,b.booking_code,b.service_type,b.user_id customer_id,
        coalesce(nullif(p.full_name,''),p.username,'Customer') customer_name,
        coalesce(b.negotiated_amount,b.agreed_amount) total_ngn,b.worker_receives worker_earnings_ngn,
        coalesce(b.completed_at,b.updated_at) completed_at,coalesce(n.note,'') note,
        coalesce(cost.cost_ngn,0) cost_ngn,coalesce(cost.note,'') cost_note
        from public.worker_bookings b join public.profiles p on p.user_id=b.user_id
        left join public.worker_pro_receipt_notes n on n.worker_id=v_actor and n.booking_id=b.id
        left join public.worker_pro_job_costs cost on cost.worker_id=v_actor and cost.booking_id=b.id
        where b.worker_id=v_actor and b.status='approved_released'
        order by coalesce(b.completed_at,b.updated_at) desc limit 100) r),'[]'::jsonb)
  );
end $function$;
revoke all on function public.get_my_worker_pro_business() from public, anon, authenticated, service_role;

grant execute on function public.get_my_worker_pro_business() to service_role;
grant execute on function public.get_my_worker_pro_business() to authenticated;

CREATE OR REPLACE FUNCTION public.get_property_change_requests_for_review(p_listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_listing public.listings; v_result jsonb;
begin
  select * into v_listing from public.listings where id=p_listing_id and deleted_at is null;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if not (
    public.current_actor_has_workspace('creator',null)
    or (public.current_actor_has_workspace('admin',v_listing.state)
      and public.current_actor_in_scope(v_listing.state,v_listing.city))
    or (public.current_actor_has_workspace('staff',null)
      and public.current_staff_has_permission('operations')
      and public.current_actor_in_scope(v_listing.state,v_listing.city))
  ) then raise exception 'Property Operations authority required'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb)
  into v_result from public.property_change_requests r
  where r.listing_id=p_listing_id;
  return v_result;
end
$function$;
revoke all on function public.get_property_change_requests_for_review(p_listing_id uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_property_change_requests_for_review(p_listing_id uuid) to service_role;
grant execute on function public.get_property_change_requests_for_review(p_listing_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_public_hotel_detail(p_hotel_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_hotel public.hotels;
  v_actor public.profiles;
  v_internal boolean:=false;
  v_rooms jsonb;
  v_facilities jsonb;
begin
  select * into v_hotel
  from public.hotels h
  where h.hotel_id=p_hotel_id;
  if v_hotel.hotel_id is null then return null; end if;

  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal:=(v_hotel.owner_id=v_actor.user_id
      and public.current_actor_has_workspace('property_partner',null))
      or exists(
        select 1
        from public.hotel_team_members member
        where member.hotel_id=v_hotel.hotel_id
          and member.member_user_id=v_actor.user_id
          and member.status='active'
      )
      or public.current_actor_has_workspace('creator',null)
      or (
        public.current_actor_has_workspace('admin',v_hotel.state)
        and public.current_actor_in_scope(v_hotel.state,v_hotel.city)
      )
      or (
        public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_hotel.state,v_hotel.city)
      );
  end if;

  if not v_internal and not (
    v_hotel.status='active'
    and v_hotel.approved_at is not null
    and v_hotel.published_at is not null
  ) then return null; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'room_id',room.room_id,
      'room_type',room.room_type,
      'description',room.description,
      'price_per_night',room.price_per_night,
      'max_guests',room.max_guests,
      'pets_allowed',room.pets_allowed,
      'bed_type',room.bed_type,
      'images',coalesce(room.images,array[]::text[]),
      'amenities',coalesce(room.amenities,array[]::text[]),
      'rate_plans',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'rate_plan_id',plan.rate_plan_id,
            'room_id',plan.room_id,
            'name',plan.name,
            'description',plan.description,
            'meal_plan',plan.meal_plan,
            'payment_timing',plan.payment_timing,
            'refundable',plan.refundable,
            'cancellation_hours',plan.cancellation_hours,
            'price_per_night',plan.price_per_night,
            'included_features',coalesce(plan.included_features,array[]::text[]),
            'active',plan.active,
            'arrival_issue_window_hours',plan.arrival_issue_window_hours
          )
          order by plan.price_per_night,plan.rate_plan_id
        )
        from public.hotel_rate_plans plan
        where plan.room_id=room.room_id
          and (plan.active or v_internal)
      ),'[]'::jsonb)
    ) || case when v_internal then jsonb_build_object('hotel_id',room.hotel_id,'total_rooms',room.total_rooms) else '{}'::jsonb end
    order by room.price_per_night,room.room_id
  ),'[]'::jsonb)
  into v_rooms
  from public.hotel_rooms room
  where room.hotel_id=v_hotel.hotel_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'venue_id',venue.venue_id,
      'hotel_id',venue.hotel_id,
      'name',venue.name,
      'kind',venue.kind,
      'description',venue.description,
      'opening_hours',venue.opening_hours,
      'package_notes',venue.package_notes,
      'active',venue.active
    ) order by venue.kind,venue.name
  ),'[]'::jsonb)
  into v_facilities
  from public.hotel_venues venue
  where venue.hotel_id=v_hotel.hotel_id
    and (venue.active or v_internal);

  return jsonb_build_object(
    'hotel_id',v_hotel.hotel_id,
    'name',v_hotel.name,
    'description',v_hotel.description,
    'state',v_hotel.state,
    'city',v_hotel.city,
    'area',v_hotel.area,
    'address',v_hotel.address,
    'images',coalesce(v_hotel.images,array[]::text[]),
    'amenities',coalesce(v_hotel.amenities,array[]::text[]),
    'status',v_hotel.status,
    'rating',v_hotel.rating,
    'review_count',v_hotel.review_count,
    'featured',v_hotel.featured,
    'gps_latitude',case when v_internal then v_hotel.gps_latitude else null end,
    'gps_longitude',case when v_internal then v_hotel.gps_longitude else null end,
    'location_exact',v_internal,
    'check_in_time',v_hotel.check_in_time,
    'check_out_time',v_hotel.check_out_time,
    'timezone',v_hotel.timezone,
    'hotel_rooms',v_rooms,
    'venues',v_facilities
  );
end;
$function$;
revoke all on function public.get_public_hotel_detail(p_hotel_id integer) from public, anon, authenticated, service_role;

grant execute on function public.get_public_hotel_detail(p_hotel_id integer) to service_role;
grant execute on function public.get_public_hotel_detail(p_hotel_id integer) to anon;
grant execute on function public.get_public_hotel_detail(p_hotel_id integer) to authenticated;

CREATE OR REPLACE FUNCTION public.get_public_listing_detail(p_listing_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_listing public.listings;
  v_actor public.profiles;
  v_partner_name text;
  v_internal boolean:=false;
  v_platform_min integer:=1;
  v_platform_max integer:=90;
  v_cancellation jsonb:='{}'::jsonb;
begin
  -- Keep the hot text-key lookup indexable at multi-million catalog scale.
  select * into v_listing
  from public.listings l
  where l.listing_id=p_listing_id
    and l.deleted_at is null
  limit 1;
  -- UUID callers retain canonical-id compatibility without forcing an OR/cast
  -- across the entire listings table.
  if v_listing.id is null and p_listing_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}

  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
  into v_partner_name
  from public.profiles p
  where p.user_id=coalesce(v_listing.partner_id,v_listing.owner_id);

  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal:=public.current_actor_can_manage_property(v_listing.id)
      or public.current_actor_has_workspace('creator',null)
      or (
        public.current_actor_has_workspace('admin',v_listing.state)
        and public.current_actor_in_scope(v_listing.state,v_listing.city)
      )
      or (
        public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_listing.state,v_listing.city)
      );
  end if;

  if not v_internal and not (
    v_listing.status='available'
    and v_listing.availability_status='available'
    and v_listing.inspection_request_id is not null
    and v_listing.approved_at is not null
  ) then return null; end if;

  if v_listing.sub_type='short_let' then
    select coalesce(nullif(value,'')::integer,1) into v_platform_min
    from public.platform_settings
    where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
    select coalesce(nullif(value,'')::integer,90) into v_platform_max
    from public.platform_settings
    where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
    select p.value into v_cancellation
    from public.creator_policy_versions p
    where p.policy_key='short_let_cancellation'
      and p.scope_type='global' and p.scope_key='*' and p.status='active'
      and p.effective_from<=now()
      and (p.effective_until is null or p.effective_until>now())
    order by p.effective_from desc,p.version desc limit 1;
    v_platform_min:=greatest(coalesce(v_platform_min,1),1);
    v_platform_max:=greatest(coalesce(v_platform_max,90),v_platform_min);
  end if;

  if v_internal then
    return to_jsonb(v_listing)||jsonb_build_object(
      'location_exact',true,
      'partner_display_name',v_partner_name,
      'minimum_stay_nights',case when v_listing.sub_type='short_let' then
        greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min) else null end,
      'maximum_stay_nights',case when v_listing.sub_type='short_let' then
        greatest(
          least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max),
          greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min)
        ) else null end,
      'standard_cancellation',v_cancellation
    );
  end if;

  return jsonb_build_object(
    'id',v_listing.id,
    'listing_id',v_listing.listing_id,
    'title',v_listing.title,
    'description',v_listing.description,
    'price',v_listing.price,
    'currency',v_listing.currency,
    'state',v_listing.state,
    'city',v_listing.city,
    'address',v_listing.address,
    'images',coalesce(v_listing.images,array[]::text[]),
    'videos',coalesce(v_listing.videos,array[]::text[]),
    'bedrooms',v_listing.bedrooms,
    'bathrooms',v_listing.bathrooms,
    'availability_status',v_listing.availability_status,
    'status',v_listing.status,
    'property_type',v_listing.property_type,
    'sub_type',v_listing.sub_type,
    'security_deposit_amount',v_listing.security_deposit_amount,
    'max_guests',v_listing.max_guests,
    'pets_allowed',v_listing.pets_allowed,
    'max_occupants',v_listing.max_occupants,
    'future_installments_allowed',v_listing.future_installments_allowed,
    'minimum_stay_nights',case when v_listing.sub_type='short_let' then
      greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min) else null end,
    'maximum_stay_nights',case when v_listing.sub_type='short_let' then
      greatest(
        least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max),
        greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min)
      ) else null end,
    'non_refundable_rate_enabled',v_listing.non_refundable_rate_enabled,
    'non_refundable_discount_percent',v_listing.non_refundable_discount_percent,
    'standard_cancellation',v_cancellation,
    'rating',v_listing.rating,
    'review_count',v_listing.review_count,
    'amenities',coalesce(v_listing.amenities,array[]::text[]),
    'created_at',v_listing.created_at,
    'updated_at',v_listing.updated_at,
    'gps_latitude',null,
    'gps_longitude',null,
    'location_accuracy_m',null,
    'location_exact',false,
    'partner_display_name',v_partner_name
  );
end
$function$;
revoke all on function public.get_public_listing_detail(p_listing_id text) from public, anon, authenticated, service_role;

grant execute on function public.get_public_listing_detail(p_listing_id text) to service_role;
grant execute on function public.get_public_listing_detail(p_listing_id text) to anon;
grant execute on function public.get_public_listing_detail(p_listing_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.get_short_let_date_availability(p_listing_id text, p_check_in date, p_check_out date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_listing public.listings;
  v_platform_min integer:=1;
  v_platform_max integer:=90;
  v_min_nights integer;
  v_max_nights integer;
  v_advance_days integer:=365;
  v_nights integer;
  v_available boolean:=false;
  v_reason text;
begin
  select * into v_listing
  from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.sub_type='short_let'
    and l.deleted_at is null
    and l.inspection_request_id is not null
    and l.approved_at is not null
  limit 1;

  if v_listing.id is null then
    return jsonb_build_object('available',false,'reason','not_found');
  end if;
  if v_listing.status<>'available' or v_listing.availability_status<>'available'
     or v_listing.host_booking_paused then
    return jsonb_build_object('available',false,'reason','not_published');
  end if;

  select coalesce(nullif(value,'')::integer,1) into v_platform_min
  from public.platform_settings
  where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
  select coalesce(nullif(value,'')::integer,90) into v_platform_max
  from public.platform_settings
  where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
  select coalesce(nullif(value,'')::integer,365) into v_advance_days
  from public.platform_settings
  where key='short_stay_booking_advance_days' and coalesce(is_active,true) limit 1;

  v_platform_min:=greatest(coalesce(v_platform_min,1),1);
  v_platform_max:=greatest(coalesce(v_platform_max,90),v_platform_min);
  v_min_nights:=greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min);
  v_max_nights:=least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max);
  v_max_nights:=greatest(v_max_nights,v_min_nights);
  v_advance_days:=greatest(coalesce(v_advance_days,365),v_max_nights);

  if p_check_in is null or p_check_out is null
     or p_check_in<timezone('Africa/Lagos',now())::date
     or p_check_out<=p_check_in then
    v_reason:='invalid_dates';
  elsif p_check_in>timezone('Africa/Lagos',now())::date+v_advance_days
     or p_check_out>timezone('Africa/Lagos',now())::date+v_advance_days then
    v_reason:='outside_booking_window';
  else
    v_nights:=p_check_out-p_check_in;
    if v_nights<v_min_nights or v_nights>v_max_nights then
      v_reason:='invalid_length';
    elsif exists(
      select 1 from public.property_host_date_blocks b
      where b.listing_id=v_listing.id and b.reopened_at is null
        and daterange(b.start_date,b.reopen_date,'[)')
          && daterange(p_check_in,p_check_out,'[)')
    ) then
      v_reason:='dates_unavailable';
    elsif exists(
      select 1 from public.reservations r
      where r.listing_id=v_listing.id::text
        and r.stay_type='short_let'
        and r.status=any(array['reserved','ready_for_move_in','occupied']::text[])
        and daterange(r.stay_check_in,r.stay_check_out,'[)')
          && daterange(p_check_in,p_check_out,'[)')
    ) then
      v_reason:='dates_unavailable';
    else
      v_available:=true;
      v_reason:='available';
    end if;
  end if;

  return jsonb_build_object(
    'available',v_available,
    'reason',v_reason,
    'nights',case when p_check_in is not null and p_check_out is not null
      then p_check_out-p_check_in else null end,
    'min_nights',v_min_nights,
    'max_nights',v_max_nights
  );
end
$function$;
revoke all on function public.get_short_let_date_availability(p_listing_id text, p_check_in date, p_check_out date) from public, anon, authenticated, service_role;

grant execute on function public.get_short_let_date_availability(p_listing_id text, p_check_in date, p_check_out date) to service_role;
grant execute on function public.get_short_let_date_availability(p_listing_id text, p_check_in date, p_check_out date) to anon;
grant execute on function public.get_short_let_date_availability(p_listing_id text, p_check_in date, p_check_out date) to authenticated;

CREATE OR REPLACE FUNCTION public.guard_accommodation_release_outbox()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_deadline timestamptz; v_open_issue boolean; v_state text;
  v_approved_no_show boolean:=false;
begin
  if new.action_type not in('release_short_let_stay','release_hotel_stay') then return new; end if;
  if new.status<>'pending' then return new; end if;
  select exists(
    select 1 from public.accommodation_no_show_reviews review
    where review.subject_type=new.subject_type and review.subject_id=new.subject_id
      and review.status='approved'
      and new.idempotency_key='approved-no-show-release:'||review.no_show_review_id
  ) into v_approved_no_show;
  if new.action_type='release_short_let_stay' then
    select reservation.arrival_issue_deadline_at,
      exists(select 1 from public.operational_cases case_row
        where case_row.subject_type='short_let' and case_row.subject_id=reservation.id
          and case_row.status not in('resolved','closed'))
    into v_deadline,v_open_issue from public.reservations reservation
    where reservation.id=new.subject_id;
  else
    select booking.arrival_issue_deadline_at,
      exists(select 1 from public.operational_cases case_row
        where case_row.subject_type='hotel' and case_row.subject_id=booking.booking_id::text
          and case_row.status not in('resolved','closed'))
    into v_deadline,v_open_issue from public.hotel_bookings booking
    where booking.booking_id::text=new.subject_id;
  end if;
  select protection_state into v_state from public.payment_protection_transactions
  where id=new.payment_protection_id;
  if coalesce(v_open_issue,false) or v_state not in('protected','release_eligible') then
    return null;
  end if;
  if not v_approved_no_show and (v_deadline is null or now()<v_deadline) then return null; end if;
  return new;
end
$function$;
revoke all on function public.guard_accommodation_release_outbox() from public, anon, authenticated, service_role;

grant execute on function public.guard_accommodation_release_outbox() to service_role;

CREATE OR REPLACE FUNCTION public.invite_property_host_manager(p_listing_id uuid, p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_target public.profiles;
  v_listing public.listings;
  v_assignment public.property_host_assignments;
begin
  select l.* into v_listing
  from public.listings l
  where l.id=p_listing_id
    and l.deleted_at is null
    and exists(
      select 1 from public.property_host_assignments a
      where a.listing_id=l.id
        and a.user_id=v_actor
        and a.assignment_role='owner'
        and a.status='active'
    )
  for update;

  if v_listing.id is null then
    raise exception 'Only the property owner can invite a co-host';
  end if;

  if v_listing.approved_at is null
     or v_listing.status not in ('available','unavailable','reserved','occupied','maintenance','closed') then
    raise exception 'Co-hosts can be added after this home is published';
  end if;

  if v_listing.management_updated_at is null or v_listing.management_mode<>'host' then
    raise exception 'Choose Host manages before inviting a co-host';
  end if;

  select * into v_target
  from public.profiles
  where lower(username)=lower(btrim(p_username))
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_target.user_id is null or v_target.user_id=v_actor then
    raise exception 'Choose another existing WeHouse user';
  end if;

  if not public.user_has_active_workspace(v_target.user_id,'property_partner') then
    raise exception 'That user must activate a Property Partner workspace first';
  end if;

  insert into public.property_host_assignments(
    listing_id,user_id,assignment_role,status,invited_by,invited_at,accepted_at,revoked_at,updated_at
  ) values(
    p_listing_id,v_target.user_id,'manager','invited',v_actor,now(),null,null,now()
  )
  on conflict(listing_id,user_id) do update set
    assignment_role='manager',
    status='invited',
    invited_by=v_actor,
    invited_at=now(),
    accepted_at=null,
    revoked_at=null,
    updated_at=now()
  returning * into v_assignment;

  return jsonb_build_object(
    'success',true,
    'assignment_id',v_assignment.assignment_id,
    'user_id',v_target.user_id,
    'username',v_target.username,
    'status',v_assignment.status
  );
end
$function$;
revoke all on function public.invite_property_host_manager(p_listing_id uuid, p_username text) from public, anon, authenticated, service_role;

grant execute on function public.invite_property_host_manager(p_listing_id uuid, p_username text) to service_role;
grant execute on function public.invite_property_host_manager(p_listing_id uuid, p_username text) to authenticated;

CREATE OR REPLACE FUNCTION public.partner_save_hotel_rate_plan(p_rate_plan_id integer, p_room_id integer, p_name text, p_description text, p_meal_plan text, p_payment_timing text, p_refundable boolean, p_cancellation_hours integer, p_price_per_night integer, p_included_features text[], p_active boolean DEFAULT true)
 RETURNS hotel_rate_plans
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_room public.hotel_rooms; v_plan public.hotel_rate_plans;
  v_before jsonb:='{}'::jsonb; v_actor text:=public.current_profile_user_id();
  v_policy public.creator_policy_versions; v_template text;
  v_hours integer;
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id;
  if v_room.room_id is null then raise exception 'Room type not found'; end if;
  if not public.hotel_actor_has_capability(v_room.hotel_id,'hotel.rate.manage') then
    raise exception 'Hotel rate capability required';
  end if;
  if nullif(btrim(p_name),'') is null or coalesce(p_price_per_night,0)<=0 then
    raise exception 'Package name and nightly price are required';
  end if;
  if p_meal_plan not in('room_only','breakfast','half_board','full_board','all_inclusive') then
    raise exception 'Choose a valid meal plan';
  end if;
  if p_payment_timing<>'pay_now' then
    raise exception 'Current hotel packages require WeHouse secure payment';
  end if;
  v_template:=case when coalesce(p_refundable,false) then 'standard'
    else 'non_refundable' end;
  select * into v_policy from public.creator_policy_versions
  where policy_key=case when v_template='standard'
      then 'hotel_standard_cancellation' else 'accommodation_non_refundable_rate' end
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  if v_policy.policy_version_id is null then
    raise exception 'Creator-approved cancellation terms are unavailable';
  end if;
  v_hours:=case when v_template='standard'
    then (v_policy.value->>'full_refund_hours_before_check_in')::integer else null end;
  if p_rate_plan_id is not null and not coalesce(p_active,true) and not exists(
    select 1 from public.hotel_rate_plans plan
    where plan.room_id=v_room.room_id and plan.active
      and plan.rate_plan_id<>p_rate_plan_id
  ) then raise exception 'A room must keep at least one visible package'; end if;
  if p_rate_plan_id is null then
    insert into public.hotel_rate_plans(
      hotel_id,room_id,name,description,meal_plan,payment_timing,refundable,
      cancellation_hours,cancellation_template,cancellation_policy_version_id,
      price_per_night,included_features,active
    ) values(
      v_room.hotel_id,v_room.room_id,btrim(p_name),
      nullif(btrim(coalesce(p_description,'')),''),p_meal_plan,'pay_now',
      v_template='standard',v_hours,v_template,v_policy.policy_version_id,
      p_price_per_night,coalesce(p_included_features,array[]::text[]),
      coalesce(p_active,true)
    ) returning * into v_plan;
  else
    select to_jsonb(plan) into v_before from public.hotel_rate_plans plan
    where plan.rate_plan_id=p_rate_plan_id and plan.room_id=v_room.room_id;
    update public.hotel_rate_plans set
      name=btrim(p_name),description=nullif(btrim(coalesce(p_description,'')),''),
      meal_plan=p_meal_plan,payment_timing='pay_now',refundable=v_template='standard',
      cancellation_hours=v_hours,cancellation_template=v_template,
      cancellation_policy_version_id=v_policy.policy_version_id,
      price_per_night=p_price_per_night,
      included_features=coalesce(p_included_features,array[]::text[]),
      active=coalesce(p_active,true),updated_at=now()
    where rate_plan_id=p_rate_plan_id and room_id=v_room.room_id
    returning * into v_plan;
    if v_plan.rate_plan_id is null then raise exception 'Package not found for this room'; end if;
  end if;
  insert into public.hotel_commercial_change_audit(
    hotel_id,actor_user_id,action,target_type,target_id,before_values,after_values
  ) values(
    v_room.hotel_id,v_actor,
    case when p_rate_plan_id is null then 'future_rate_plan_created'
      else 'future_rate_plan_updated' end,
    'hotel_rate_plan',v_plan.rate_plan_id::text,coalesce(v_before,'{}'::jsonb),to_jsonb(v_plan)
  );
  return v_plan;
end
$function$;
revoke all on function public.partner_save_hotel_rate_plan(p_rate_plan_id integer, p_room_id integer, p_name text, p_description text, p_meal_plan text, p_payment_timing text, p_refundable boolean, p_cancellation_hours integer, p_price_per_night integer, p_included_features text[], p_active boolean) from public, anon, authenticated, service_role;

grant execute on function public.partner_save_hotel_rate_plan(p_rate_plan_id integer, p_room_id integer, p_name text, p_description text, p_meal_plan text, p_payment_timing text, p_refundable boolean, p_cancellation_hours integer, p_price_per_night integer, p_included_features text[], p_active boolean) to service_role;
grant execute on function public.partner_save_hotel_rate_plan(p_rate_plan_id integer, p_room_id integer, p_name text, p_description text, p_meal_plan text, p_payment_timing text, p_refundable boolean, p_cancellation_hours integer, p_price_per_night integer, p_included_features text[], p_active boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.process_verified_paystack_charge(p_provider_event_key text, p_event_type text, p_provider_reference text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text, p_transaction_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_event public.verified_provider_events;
  v_payment public.booking_payments;
  v_result jsonb;
  v_amount numeric(18,2);
  v_payer text;
  v_payee text;
  v_subject_type text;
  v_subject_id text;
  v_component text;
  v_rate numeric:=0;
  v_policy_id uuid;
  v_protection public.payment_protection_transactions;
  v_stay_protection public.payment_protection_transactions;
  v_caution_protection public.payment_protection_transactions;
  v_reservation public.reservations;
  v_listing public.listings;
  v_hotel_booking public.hotel_bookings;
  v_group public.shared_housing_groups;
  v_stay_amount numeric(18,2):=0;
  v_caution_amount numeric(18,2):=0;
  v_entries jsonb;
  v_liability_total numeric(18,2):=0;
  v_ledger_transaction_id uuid;
  v_error text;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'service role required';
  end if;
  if p_event_type<>'charge.success'
    or nullif(btrim(p_provider_event_key),'') is null
    or nullif(btrim(p_provider_reference),'') is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_signature_verified_at is null
    or p_amount_minor<=0
    or upper(p_currency)<>'NGN'
  then raise exception 'Invalid verified Paystack charge'; end if;
  v_amount:=round((p_amount_minor::numeric/100)::numeric,2);

  insert into public.verified_provider_events(
    provider,provider_event_key,event_type,provider_reference,payload_sha256,
    signature_verified_at,processing_status
  ) values(
    'paystack',p_provider_event_key,p_event_type,p_provider_reference,
    lower(p_payload_sha256),p_signature_verified_at,'received'
  ) on conflict do nothing;

  select * into v_event
  from public.verified_provider_events
  where provider='paystack'
    and event_type=p_event_type
    and provider_reference=p_provider_reference
  for update;
  if v_event.provider_event_id is null then
    raise exception 'Provider event could not be registered';
  end if;
  if v_event.provider_event_key<>p_provider_event_key
    or v_event.payload_sha256<>lower(p_payload_sha256) then
    raise exception 'Provider event replay does not match the verified receipt';
  end if;
  if v_event.processing_status='processed' then
    return jsonb_build_object(
      'success',true,'already_processed',true,
      'provider_event_id',v_event.provider_event_id
    );
  end if;

  select * into v_payment from public.booking_payments
  where paystack_reference=p_provider_reference for update;
  if v_payment.id is null then
    update public.verified_provider_events
    set processing_status='ignored',processed_at=now(),
        processing_error='No matching WeHouse payment reference'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',true,'ignored',true);
  end if;
  if round(coalesce(v_payment.amount_total,v_payment.amount,0)::numeric*100)
      <>p_amount_minor then
    update public.verified_provider_events
    set processing_status='failed',processed_at=now(),
        processing_error='Verified amount does not match the payment request'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Amount mismatch');
  end if;
  if upper(coalesce(v_payment.currency,'NGN'))<>'NGN' then
    update public.verified_provider_events
    set processing_status='failed',processed_at=now(),
        processing_error='Verified currency does not match the payment request'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Currency mismatch');
  end if;

  if v_payment.purpose='worker_booking' then
    select (p.value->>'percent')::numeric,p.policy_version_id
    into v_rate,v_policy_id from public.creator_policy_versions p
    where p.policy_key='commission_worker' and p.scope_type='global'
      and p.scope_key='*' and p.status='active'
      and p.effective_from<=now()
      and (p.effective_until is null or p.effective_until>now())
    order by p.effective_from desc limit 1;
    if v_rate is null or v_rate<0 or v_rate>50 then
      raise exception 'Active Creator Worker commission is required';
    end if;
    update public.platform_settings
    set value=v_rate::text,editable=false,is_active=true,updated_at=now()
    where key='worker_commission_rate';
  end if;

  begin
    if v_payment.purpose='worker_booking' then
      if v_payment.worker_booking_id is null then
        raise exception 'Worker booking link is missing';
      end if;
      v_result:=public.confirm_worker_booking_payment(
        v_payment.worker_booking_id,p_provider_reference,v_amount,'NGN',p_transaction_id
      );
    elsif v_payment.purpose='shared_housing_share' then
      v_result:=public.confirm_shared_housing_payment(
        p_provider_reference,p_transaction_id,v_amount
      );
    elsif v_payment.purpose in(
      'apartment_reservation','apartment_rent','rent_plan_contribution',
      'hotel_booking','worker_verification'
    ) then
      v_result:=public.confirm_booking_payment(
        p_provider_reference,p_transaction_id,v_amount,'webhook',v_payment.purpose
      );
    else
      raise exception 'Unsupported payment purpose: %',coalesce(v_payment.purpose,'missing');
    end if;
    if not coalesce((v_result->>'success')::boolean,false) then
      raise exception '%',coalesce(v_result->>'error','Lifecycle payment confirmation failed');
    end if;

    v_payer:=coalesce(v_payment.payer_user_id,v_payment.user_id);
    v_payee:=v_payment.payee_user_id;
    v_component:=coalesce(v_payment.metadata->>'payment_component','');

    if v_payment.listing_id is not null then
      select * into v_listing from public.listings
      where id::text=v_payment.listing_id limit 1;
      v_payee:=coalesce(v_payee,v_listing.partner_id,v_listing.owner_id);
    end if;

    if v_payment.purpose='worker_booking' then
      select * into v_protection
      from public.payment_protection_transactions
      where booking_type='worker_booking'
        and booking_id=v_payment.worker_booking_id
      for update;
      if v_protection.id is null then
        raise exception 'Worker payment did not create Payment Protection';
      end if;
      update public.payment_protection_transactions
      set subject_type='worker_booking',subject_id=v_payment.worker_booking_id::text,
          amount_commission=round(v_amount*v_rate/100,2),
          amount_payee=v_amount-round(v_amount*v_rate/100,2),
          commission_rate=v_rate,updated_at=now()
      where id=v_protection.id returning * into v_protection;
      update public.worker_bookings
      set payment_protection_id=v_protection.id,policy_version_id=v_policy_id,
          wehouse_fee=v_protection.amount_commission,
          worker_commission=v_protection.amount_commission,
          worker_receives=v_protection.amount_payee,updated_at=now()
      where id=v_payment.worker_booking_id;

    elsif v_payment.purpose='apartment_rent' then
      select * into v_reservation from public.reservations
      where id=v_payment.metadata->>'reservation_id' for update;
      if v_reservation.id is null then raise exception 'Reservation link is missing'; end if;
      if v_listing.id is null then
        select * into v_listing from public.listings
        where id::text=v_reservation.listing_id limit 1;
        v_payee:=coalesce(v_payee,v_listing.partner_id,v_listing.owner_id);
      end if;
      if v_payee is null then raise exception 'Property payee is missing'; end if;

      if v_component='short_stay_rent' or v_reservation.stay_type='short_let' then
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_short_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Short Let commission is required';
        end if;
        v_stay_amount:=round(coalesce(v_reservation.stay_rent_total,
          (v_payment.metadata->>'stay_rent_total')::numeric,0),2);
        v_caution_amount:=round(coalesce(v_reservation.security_deposit_snapshot,
          (v_payment.metadata->>'security_deposit_amount')::numeric,0),2);
        if v_stay_amount<=0 or v_stay_amount+v_caution_amount<>v_amount then
          raise exception 'Short Let stay and Caution split does not match verified money';
        end if;
        insert into public.payment_protection_transactions(
          booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
          amount_commission,amount_payee,commission_rate,status,
          paystack_reference,protection_state,subject_type,subject_id
        ) values(
          null,'short_let_stay',v_payer,v_payee,v_stay_amount,
          round(v_stay_amount*v_rate/100,2),
          v_stay_amount-round(v_stay_amount*v_rate/100,2),v_rate,
          'protected',p_provider_reference,'awaiting_funds',
          'short_let_stay',v_reservation.id
        ) on conflict(subject_type,subject_id) do update
          set paystack_reference=excluded.paystack_reference,updated_at=now()
        returning * into v_stay_protection;
        if v_caution_amount>0 then
          insert into public.payment_protection_transactions(
            booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
            amount_commission,amount_payee,commission_rate,status,
            paystack_reference,protection_state,subject_type,subject_id
          ) values(
            null,'short_let_caution',v_payer,v_payee,v_caution_amount,
            0,v_caution_amount,0,'protected',p_provider_reference,
            'awaiting_funds','short_let_caution',v_reservation.id
          ) on conflict(subject_type,subject_id) do update
            set paystack_reference=excluded.paystack_reference,updated_at=now()
          returning * into v_caution_protection;
        end if;
        update public.reservations
        set stay_payment_protection_id=v_stay_protection.id,
            caution_payment_protection_id=v_caution_protection.id,
            commission_policy_version_id=v_policy_id,updated_at=now()
        where id=v_reservation.id;
      else
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_long_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Long Let commission is required';
        end if;
        insert into public.payment_protection_transactions(
          booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
          amount_commission,amount_payee,commission_rate,status,
          paystack_reference,protection_state,subject_type,subject_id
        ) values(
          null,'long_let_year_one',v_payer,v_payee,v_amount,
          round(v_amount*v_rate/100,2),v_amount-round(v_amount*v_rate/100,2),
          v_rate,'protected',p_provider_reference,'awaiting_funds',
          'long_let_year_one',v_reservation.id
        ) on conflict(subject_type,subject_id) do update
          set paystack_reference=excluded.paystack_reference,updated_at=now()
        returning * into v_protection;
        update public.reservations
        set year_one_rent_protection_id=v_protection.id,
            commission_policy_version_id=v_policy_id,updated_at=now()
        where id=v_reservation.id;
      end if;

    elsif v_payment.purpose='hotel_booking' then
      select * into v_hotel_booking from public.hotel_bookings
      where booking_id=v_payment.hotel_booking_id for update;
      if v_hotel_booking.booking_id is null then raise exception 'Hotel booking is missing'; end if;
      select h.owner_id into v_payee from public.hotels h
      where h.hotel_id=v_hotel_booking.hotel_id;
      if v_payee is null then raise exception 'Hotel payee is missing'; end if;
      select (p.value->>'percent')::numeric,p.policy_version_id
      into v_rate,v_policy_id from public.creator_policy_versions p
      where p.policy_key='commission_hotel' and p.scope_type='global'
        and p.scope_key='*' and p.status='active'
        and p.effective_from<=now()
        and (p.effective_until is null or p.effective_until>now())
      order by p.effective_from desc limit 1;
      if v_rate is null or v_rate<0 or v_rate>50 then
        raise exception 'Active Creator Hotel commission is required';
      end if;
      insert into public.payment_protection_transactions(
        booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
        amount_commission,amount_payee,commission_rate,status,
        paystack_reference,protection_state,subject_type,subject_id
      ) values(
        null,'hotel_stay',v_payer,v_payee,v_amount,
        round(v_amount*v_rate/100,2),v_amount-round(v_amount*v_rate/100,2),
        v_rate,'protected',p_provider_reference,'awaiting_funds',
        'hotel_stay',v_hotel_booking.booking_id::text
      ) on conflict(subject_type,subject_id) do update
        set paystack_reference=excluded.paystack_reference,updated_at=now()
      returning * into v_protection;
      update public.hotel_bookings
      set payment_protection_id=v_protection.id,policy_version_id=v_policy_id,
          updated_at=now()
      where booking_id=v_hotel_booking.booking_id;

    elsif v_payment.purpose='shared_housing_share'
      and coalesce(v_payment.metadata->>'payment_phase','')<>'reservation_fee' then
      select g.* into v_group from public.shared_housing_groups g
      where g.id=(v_payment.metadata->>'shared_group_id')::uuid;
      if v_group.id is null then raise exception 'Shared payment group is missing'; end if;
      select * into v_listing from public.listings where id=v_group.listing_id;
      v_payee:=coalesce(v_listing.partner_id,v_listing.owner_id);
      if v_payee is null then raise exception 'Shared payment payee is missing'; end if;
      if v_listing.sub_type='short_let' then
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_short_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Short Let commission is required';
        end if;
      else
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_long_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Long Let commission is required';
        end if;
      end if;
      insert into public.payment_protection_transactions(
        booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
        amount_commission,amount_payee,commission_rate,status,
        paystack_reference,protection_state,subject_type,subject_id
      ) values(
        null,'shared_housing_share',v_payer,v_payee,v_amount,
        round(v_amount*v_rate/100,2),v_amount-round(v_amount*v_rate/100,2),
        v_rate,'protected',p_provider_reference,'awaiting_funds',
        'shared_housing_share',v_payment.metadata->>'shared_member_id'
      ) on conflict(subject_type,subject_id) do update
        set paystack_reference=excluded.paystack_reference,updated_at=now()
      returning * into v_protection;
    end if;

    v_entries:=jsonb_build_array(jsonb_build_object(
      'account_key','asset:paystack_clearing:NGN','account_class','asset',
      'amount',v_amount,'memo','Paystack verified charge'
    ));
    for v_protection in
      select p.* from public.payment_protection_transactions p
      where p.paystack_reference=p_provider_reference
        and p.subject_type in(
          'worker_booking','long_let_year_one','short_let_stay',
          'short_let_caution','hotel_stay','shared_housing_share'
        )
      order by p.subject_type,p.id
    loop
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'account_key','liability:payment_protection:'||v_protection.id::text,
        'account_class','liability','owner_type',v_protection.subject_type,
        'owner_id',v_protection.subject_id,'amount',-v_protection.amount_total,
        'memo','Protected customer funds'
      ));
      v_liability_total:=v_liability_total+v_protection.amount_total;
    end loop;
    if v_liability_total>v_amount then
      raise exception 'Payment Protection allocation exceeds verified money';
    end if;
    if v_liability_total<v_amount then
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'account_key',case
          when v_payment.purpose='apartment_reservation'
            or (v_payment.purpose='shared_housing_share'
              and v_payment.metadata->>'payment_phase'='reservation_fee')
            then 'liability:unearned_reservation_fee:'||v_payment.id::text
          when v_payment.purpose='rent_plan_contribution'
            then 'liability:partner_payable:'||coalesce(v_payee,'unresolved')
          else 'liability:customer_funds:'||v_payment.id::text end,
        'account_class','liability','owner_type','booking_payment',
        'owner_id',v_payment.id::text,'amount',-(v_amount-v_liability_total),
        'memo','Unreleased customer funds'
      ));
    end if;

    v_ledger_transaction_id:=public.post_ledger_transaction(
      'paystack-charge:'||p_provider_reference,'provider_charge','NGN',
      'booking_payment',v_payment.id::text,v_event.provider_event_id,
      jsonb_build_object(
        'provider','paystack','provider_reference',p_provider_reference,
        'purpose',v_payment.purpose,'payer_user_id',v_payer
      ),v_entries
    );

    for v_protection in
      select p.* from public.payment_protection_transactions p
      where p.paystack_reference=p_provider_reference
        and p.subject_type in(
          'worker_booking','long_let_year_one','short_let_stay',
          'short_let_caution','hotel_stay','shared_housing_share'
        )
      order by p.subject_type,p.id
    loop
      update public.payment_protection_transactions
      set protected_ledger_transaction_id=v_ledger_transaction_id,updated_at=now()
      where id=v_protection.id;
      if v_protection.protection_state='awaiting_funds' then
        perform public.transition_payment_protection(
          v_protection.id,'protected','provider_charge_verified',
          'paystack-protected:'||p_provider_reference||':'||v_protection.id::text,
          null,'paystack',null,v_ledger_transaction_id,
          jsonb_build_object('provider_event_id',v_event.provider_event_id)
        );
      elsif v_protection.protection_state<>'protected' then
        raise exception 'Existing Payment Protection is not awaiting funds';
      end if;
    end loop;

    update public.verified_provider_events
    set processing_status='processed',processed_at=now(),processing_error=null
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object(
      'success',true,'provider_event_id',v_event.provider_event_id,
      'ledger_transaction_id',v_ledger_transaction_id,
      'lifecycle_result',v_result
    );
  exception when others then
    get stacked diagnostics v_error=message_text;
    update public.verified_provider_events
    set processing_status='failed',processed_at=now(),
        processing_error=left(v_error,500)
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Verified payment requires retry or Finance review');
  end;
end
$function$;
revoke all on function public.process_verified_paystack_charge(p_provider_event_key text, p_event_type text, p_provider_reference text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text, p_transaction_id text) from public, anon, authenticated, service_role;

grant execute on function public.process_verified_paystack_charge(p_provider_event_key text, p_event_type text, p_provider_reference text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text, p_transaction_id text) to service_role;

CREATE OR REPLACE FUNCTION public.process_verified_paystack_refund_event(p_provider_event_key text, p_event_type text, p_original_reference text, p_refund_reference text, p_provider_refund_id text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_event public.verified_provider_events;
  v_action public.financial_action_outbox;
  v_protection public.payment_protection_transactions;
  v_amount numeric(12,2);
  v_match_count integer;
  v_ledger uuid;
  v_new_released numeric(12,2);
  v_new_refunded numeric(12,2);
  v_to_state text;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  if p_event_type not in(
    'refund.pending','refund.processing','refund.needs-attention',
    'refund.failed','refund.processed'
  ) or nullif(btrim(p_provider_event_key),'') is null
    or nullif(btrim(p_original_reference),'') is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_amount_minor<=0 or upper(p_currency)<>'NGN' then
    raise exception 'Invalid verified Paystack refund event'; end if;
  v_amount:=round(p_amount_minor::numeric/100,2);
  insert into public.verified_provider_events(
    provider,provider_event_key,event_type,provider_reference,payload_sha256,
    signature_verified_at,processing_status
  ) values(
    'paystack',p_provider_event_key,p_event_type,
    coalesce(nullif(btrim(p_refund_reference),''),p_provider_event_key),
    lower(p_payload_sha256),p_signature_verified_at,'received'
  ) on conflict do nothing;
  select * into v_event from public.verified_provider_events
  where provider='paystack' and provider_event_key=p_provider_event_key for update;
  if v_event.provider_event_id is null then raise exception 'Refund event was not registered'; end if;
  if v_event.payload_sha256<>lower(p_payload_sha256) then
    raise exception 'Refund event replay checksum mismatch'; end if;
  if v_event.processing_status='processed' then
    return jsonb_build_object('success',true,'already_processed',true); end if;

  select count(*) into v_match_count
  from public.financial_action_outbox a
  join public.payment_protection_transactions p on p.id=a.payment_protection_id
  where a.action_type like 'refund_%'
    and a.status in('provider_pending','provider_attention')
    and p.paystack_reference=p_original_reference
    and a.amount=v_amount
    and (nullif(btrim(p_provider_refund_id),'') is null
      or a.provider_action_id is null
      or a.provider_action_id=p_provider_refund_id);
  if v_match_count=0 then
    update public.verified_provider_events set processing_status='ignored',
      processed_at=now(),processing_error='No matching pending refund action'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',true,'ignored',true);
  end if;
  if v_match_count<>1 then
    update public.verified_provider_events set processing_status='failed',
      processed_at=now(),processing_error='Refund event matched multiple actions'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Refund matching requires Finance review');
  end if;
  select a.* into v_action
  from public.financial_action_outbox a
  join public.payment_protection_transactions p on p.id=a.payment_protection_id
  where a.action_type like 'refund_%'
    and a.status in('provider_pending','provider_attention')
    and p.paystack_reference=p_original_reference and a.amount=v_amount
    and (nullif(btrim(p_provider_refund_id),'') is null
      or a.provider_action_id is null or a.provider_action_id=p_provider_refund_id)
  for update of a;
  update public.financial_action_outbox set
    provider_action_id=coalesce(provider_action_id,nullif(btrim(p_provider_refund_id),'')),
    provider_status=replace(p_event_type,'refund.',''),updated_at=now()
  where financial_action_id=v_action.financial_action_id;

  if p_event_type='refund.needs-attention' then
    update public.financial_action_outbox set status='provider_attention'
    where financial_action_id=v_action.financial_action_id;
  elsif p_event_type='refund.failed' then
    update public.financial_action_outbox set status='manual_review',
      last_error='Paystack reported that the refund failed',updated_at=now()
    where financial_action_id=v_action.financial_action_id;
  elsif p_event_type='refund.processed' then
    select * into v_protection from public.payment_protection_transactions
    where id=v_action.payment_protection_id for update;
    if v_action.amount>
        v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount then
      raise exception 'Refund exceeds the protected balance'; end if;
    v_ledger:=public.post_ledger_transaction(
      'paystack-refund:'||p_provider_event_key,'provider_refund','NGN',
      v_action.subject_type,v_action.subject_id,v_event.provider_event_id,
      jsonb_build_object(
        'financial_action_id',v_action.financial_action_id,
        'original_reference',p_original_reference,
        'refund_reference',p_refund_reference
      ),jsonb_build_array(
        jsonb_build_object(
          'account_key','liability:payment_protection:'||v_protection.id::text,
          'account_class','liability','owner_type',v_protection.subject_type,
          'owner_id',v_protection.subject_id,'amount',v_action.amount,
          'memo','Original-payment refund'
        ),
        jsonb_build_object(
          'account_key','asset:paystack_clearing:NGN','account_class','asset',
          'amount',-v_action.amount,'memo','Paystack processed refund'
        )
      )
    );
    update public.payment_protection_transactions set
      refunded_amount=refunded_amount+v_action.amount,
      refund_ledger_transaction_id=v_ledger,updated_at=now()
    where id=v_protection.id
    returning released_amount,refunded_amount into v_new_released,v_new_refunded;
    v_to_state:=case
      when v_new_refunded=v_protection.amount_total then 'refunded'
      else 'partially_released' end;
    perform public.transition_payment_protection(
      v_protection.id,v_to_state,'provider_refund_processed',
      'provider-refund-processed:'||p_provider_event_key,
      null,'paystack',null,v_ledger,
      jsonb_build_object('financial_action_id',v_action.financial_action_id)
    );
    update public.financial_action_outbox set status='completed',processed_at=now(),
      last_error=null,updated_at=now()
    where financial_action_id=v_action.financial_action_id;
  end if;
  update public.verified_provider_events set processing_status='processed',
    processed_at=now(),processing_error=null
  where provider_event_id=v_event.provider_event_id;
  return jsonb_build_object('success',true,'financial_action_id',v_action.financial_action_id);
end
$function$;
revoke all on function public.process_verified_paystack_refund_event(p_provider_event_key text, p_event_type text, p_original_reference text, p_refund_reference text, p_provider_refund_id text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text) from public, anon, authenticated, service_role;

grant execute on function public.process_verified_paystack_refund_event(p_provider_event_key text, p_event_type text, p_original_reference text, p_refund_reference text, p_provider_refund_id text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text) to service_role;

CREATE OR REPLACE FUNCTION public.property_host_conversation_access(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists(
    select 1
    from public.property_host_conversations c
    join public.reservations r on r.id=c.reservation_id
    left join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
    where c.conversation_id=p_conversation_id
      and (
        c.guest_user_id=public.current_profile_user_id()
        or (
          c.host_user_id=public.current_profile_user_id()
          and r.management_mode_snapshot='host'
          and r.responsible_host_user_id=c.host_user_id
          and exists(
            select 1
            from public.property_host_assignments a
            join public.profiles p on p.user_id=a.user_id
            where a.listing_id=l.id
              and a.user_id=c.host_user_id
              and a.status='active'
              and not coalesce(p.deleted,false)
              and not coalesce(p.suspended,false)
              and not coalesce(p.banned,false)
          )
        )
      )
  )
$function$;
revoke all on function public.property_host_conversation_access(p_conversation_id uuid) from public, anon, authenticated, service_role;

grant execute on function public.property_host_conversation_access(p_conversation_id uuid) to service_role;
grant execute on function public.property_host_conversation_access(p_conversation_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if p_check_in is null or p_check_out is null or p_check_in <= current_date or p_check_out <= p_check_in then
    raise exception 'Choose valid future check-in and check-out dates';
  end if;
  if not exists (
    select 1 from public.hotels h
    join public.hotel_rooms r on r.hotel_id=h.hotel_id
    join public.hotel_rate_plans rp on rp.room_id=r.room_id and rp.hotel_id=h.hotel_id
    where h.hotel_id=p_hotel_id and r.room_id=p_room_id and rp.rate_plan_id=p_rate_plan_id
      and rp.active and h.status='active' and h.approved_at is not null and h.published_at is not null
  ) then raise exception 'Hotel room package is not available'; end if;
  return private.hotel_booking_quote_v2(p_room_id,p_rate_plan_id,p_check_in,p_check_out,null,true);
end;
$function$;
revoke all on function public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date) from public, anon, authenticated, service_role;

grant execute on function public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date) to service_role;
grant execute on function public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date) to authenticated;

CREATE OR REPLACE FUNCTION public.record_partner_pro_renewal(p_reference text, p_transaction_id text, p_amount_minor bigint, p_environment text, p_subscription_code text, p_customer_code text, p_plan_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_subscription public.partner_pro_subscriptions; v_payment public.booking_payments; v_end timestamptz; v_review timestamptz;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
 if p_environment not in ('test','live') or length(coalesce(p_reference,''))<5 or length(coalesce(p_transaction_id,''))<1 then raise exception 'Invalid renewal receipt'; end if;
 select * into v_subscription from public.partner_pro_subscriptions where subscription_code=p_subscription_code for update;
 if v_subscription.partner_id is null then return jsonb_build_object('handled',false); end if;
 if v_subscription.environment<>p_environment or v_subscription.plan_code<>p_plan_code or v_subscription.customer_code is distinct from p_customer_code
   or round(v_subscription.price_ngn*100)<>p_amount_minor then raise exception 'Subscription renewal mismatch'; end if;
 select * into v_payment from public.booking_payments where paystack_reference=p_reference or paystack_transaction_id=p_transaction_id for update;
 if v_payment.id is not null then
   if v_payment.purpose<>'partner_pro_access' or v_payment.paystack_reference<>p_reference or v_payment.paystack_transaction_id is distinct from p_transaction_id then raise exception 'Renewal replay conflict'; end if;
   return jsonb_build_object('handled',true,'already_processed',true);
 end if;
 insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,type,booking_type,amount,amount_total,net_amount,
   amount_commission,currency,status,purpose,payment_method,paystack_transaction_id,verified_amount,verified_at,verification_source,paid_at,webhook_processed,metadata)
 values(p_reference,p_reference,v_subscription.partner_id,v_subscription.partner_id,'partner_pro_access','partner_pro_access',
   v_subscription.price_ngn,v_subscription.price_ngn,v_subscription.price_ngn,0,'NGN',
   case when v_subscription.auto_renews then 'paid' else 'review_required' end,'partner_pro_access','paystack',p_transaction_id,
   v_subscription.price_ngn,now(),'webhook',now(),true,
   jsonb_build_object('billing_period',v_subscription.billing_period,'auto_renew',true,'plan_code',p_plan_code,
     'paystack_environment',p_environment,'paystack_subscription_code',p_subscription_code,'paystack_customer_code',p_customer_code)) returning * into v_payment;
 select current_period_end,review_started_at into v_end,v_review from public.partner_pro_entitlements where partner_id=v_subscription.partner_id for update;
 if not v_subscription.auto_renews or v_review is not null then
   update public.booking_payments set status='review_required' where id=v_payment.id;
   return jsonb_build_object('handled',true,'requires_review',true);
 end if;
 v_end:=greatest(coalesce(v_end,now()),now())+case when v_subscription.billing_period='yearly' then interval '1 year' else interval '1 month' end;
 update public.partner_pro_entitlements set current_period_end=v_end,last_payment_id=v_payment.id,updated_at=now() where partner_id=v_subscription.partner_id;
 return jsonb_build_object('handled',true,'success',true,'current_period_end',v_end);
end $function$;
revoke all on function public.record_partner_pro_renewal(p_reference text, p_transaction_id text, p_amount_minor bigint, p_environment text, p_subscription_code text, p_customer_code text, p_plan_code text) from public, anon, authenticated, service_role;

grant execute on function public.record_partner_pro_renewal(p_reference text, p_transaction_id text, p_amount_minor bigint, p_environment text, p_subscription_code text, p_customer_code text, p_plan_code text) to service_role;

CREATE OR REPLACE FUNCTION public.record_partner_pro_subscription_event(p_subscription_code text, p_customer_code text, p_plan_code text, p_environment text, p_event_type text, p_event_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_subscription public.partner_pro_subscriptions;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
 if p_event_type not in ('subscription.create','subscription.not_renew','subscription.disable') or p_environment not in ('test','live')
   or p_subscription_code !~ '^SUB_[A-Za-z0-9]+$' or p_event_time is null or p_event_time>now()+interval '1 day' then
   raise exception 'Invalid subscription event'; end if;
 select * into v_subscription from public.partner_pro_subscriptions where subscription_code=p_subscription_code for update;
 if v_subscription.partner_id is null and p_event_type='subscription.create' then
   select * into v_subscription from public.partner_pro_subscriptions
   where customer_code=p_customer_code and plan_code=p_plan_code and environment=p_environment and auto_renews for update;
 end if;
 if v_subscription.partner_id is null then return false; end if;
 if v_subscription.environment<>p_environment or (p_plan_code<>'' and v_subscription.plan_code<>p_plan_code)
   or (p_customer_code<>'' and v_subscription.customer_code is distinct from p_customer_code) then raise exception 'Subscription identity mismatch'; end if;
 if v_subscription.provider_event_at is not null and p_event_time<=v_subscription.provider_event_at then return true; end if;
 update public.partner_pro_subscriptions set subscription_code=p_subscription_code,
   auto_renews=p_event_type='subscription.create',provider_event_at=p_event_time,updated_at=now()
   where partner_id=v_subscription.partner_id;
 return true;
end $function$;
revoke all on function public.record_partner_pro_subscription_event(p_subscription_code text, p_customer_code text, p_plan_code text, p_environment text, p_event_type text, p_event_time timestamp with time zone) from public, anon, authenticated, service_role;

grant execute on function public.record_partner_pro_subscription_event(p_subscription_code text, p_customer_code text, p_plan_code text, p_environment text, p_event_type text, p_event_time timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_my_roommate_search()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor public.profiles;
 prefs public.roommate_preferences;
 total integer;
begin
 select * into actor
 from public.profiles
 where auth_id=(select auth.uid())::text
 limit 1;

 if actor.user_id is null
    or not public.current_actor_has_personal_workspace()
    or coalesce(actor.deleted,false)
    or coalesce(actor.suspended,false)
    or coalesce(actor.banned,false)
 then raise exception 'Active Personal account required'; end if;

 select * into prefs
 from public.roommate_preferences
 where user_id=actor.user_id
 for update;

 if coalesce(prefs.practical_preferences_version,0)<>2
 then raise exception 'Confirm your moving plans before finding new matches'; end if;

 if not coalesce(prefs.active,false)
    or prefs.search_status<>'active'
    or not coalesce(actor.privacy_search_visible,true)
    or not coalesce(actor.privacy_profile_visible,true)
 then raise exception 'Roommate matching is paused'; end if;

 delete from public.roommate_search_results
 where searcher_id=actor.user_id
   and status in('new','viewed');

 /*
  * Hard-filter first. The expensive compatibility function is deliberately
  * isolated behind a bounded candidate window. The final 120 rows therefore
  * no longer sit on top of an unbounded candidate scan.
  */
 with hard_candidates as materialized (
   select
     peer.user_id
   from public.profiles peer
   join public.roommate_preferences pp
     on pp.user_id=peer.user_id
   where peer.user_id<>actor.user_id
     and peer.account_kind='consumer'
     and not coalesce(peer.deleted,false)
     and not coalesce(peer.suspended,false)
     and not coalesce(peer.banned,false)
     and coalesce(peer.profile_complete,false)
     and coalesce(peer.privacy_search_visible,true)
     and coalesce(peer.privacy_profile_visible,true)
     and pp.active
     and pp.search_status='active'
     and pp.practical_preferences_version=2

     and public._roommate_normalize(pp.preferred_state)
         = public._roommate_normalize(prefs.preferred_state)
     and public._roommate_normalize(pp.preferred_lga)
         = public._roommate_normalize(prefs.preferred_lga)

     and pp.budget_max >= prefs.budget_min
     and prefs.budget_max >= pp.budget_min

     and (prefs.gender_preference='no_preference' or prefs.gender_preference=lower(peer.gender))
     and (pp.gender_preference='no_preference' or pp.gender_preference=lower(actor.gender))

     and (
       not coalesce(prefs.school_match,false)
       and not coalesce(pp.school_match,false)
       or (
         public._roommate_normalize(coalesce(prefs.school_name,actor.school))
           = public._roommate_normalize(coalesce(pp.school_name,peer.school))
         and public._roommate_normalize(coalesce(prefs.school_name,actor.school)) is not null
       )
     )

     and (
       prefs.room_arrangement='either'
       or pp.room_arrangement='either'
       or prefs.room_arrangement=pp.room_arrangement
     )

     and (
       public._roommate_normalize(prefs.preferred_area) is null
       or public._roommate_normalize(pp.preferred_area) is null
       or public._roommate_normalize(prefs.preferred_area)
          = public._roommate_normalize(pp.preferred_area)
     )

     and (
       prefs.move_in_mode='flexible'
       or pp.move_in_mode='flexible'
       or greatest(
            case when prefs.move_in_mode='asap'
                 then (now() at time zone 'Africa/Lagos')::date
                 else prefs.move_in_from end,
            case when pp.move_in_mode='asap'
                 then (now() at time zone 'Africa/Lagos')::date
                 else pp.move_in_from end,
            (now() at time zone 'Africa/Lagos')::date
          )
          <= least(
            case when prefs.move_in_mode='asap'
                 then (now() at time zone 'Africa/Lagos')::date + 30
                 when prefs.move_in_mode='date' then prefs.move_in_from
                 else prefs.move_in_to end,
            case when pp.move_in_mode='asap'
                 then (now() at time zone 'Africa/Lagos')::date + 30
                 when pp.move_in_mode='date' then pp.move_in_from
                 else pp.move_in_to end
          )
     )

     and not (
       prefs.smoking_preference='no' and pp.smoking_habit<>'never'
       or pp.smoking_preference='no' and prefs.smoking_habit<>'never'
       or prefs.smoking_preference='outdoors' and pp.smoking_habit='smokes'
       or pp.smoking_preference='outdoors' and prefs.smoking_habit='smokes'
     )

     and not exists (
       select 1
       from public.roommate_user_blocks b
       where (b.blocker_user_id=actor.user_id and b.blocked_user_id=peer.user_id)
          or (b.blocker_user_id=peer.user_id and b.blocked_user_id=actor.user_id)
     )

     and not exists (
       select 1
       from public.roommate_search_results r
       where r.searcher_id=actor.user_id
         and r.matched_user_id=peer.user_id
         and r.status in('accepted','declined')
     )

     and not exists (
       select 1
       from public.conversations c
       where c.conversation_type='roommate'
         and c.status in('active','accepted')
         and (
           (c.participant_a=actor.user_id and c.participant_b=peer.user_id)
           or
           (c.participant_b=actor.user_id and c.participant_a=peer.user_id)
         )
     )
   order by peer.user_id
   limit 1000
 ),
 scored as materialized (
   select
     hc.user_id,
     coalesce(
       (public._roommate_practical_pair(actor.user_id,hc.user_id)->>'score')::integer,
       0
     ) as score
   from hard_candidates hc
 )
 insert into public.roommate_search_results(searcher_id,matched_user_id,match_score,status)
 select actor.user_id,user_id,score,'new'
 from scored
 order by score desc,user_id
 limit 120
 on conflict(searcher_id,matched_user_id) do nothing;

 get diagnostics total=row_count;

 update public.roommate_preferences
 set search_match_count=total,
     search_expires_at=null,
     updated_at=now()
 where user_id=actor.user_id;

 return total;
end $function$;
revoke all on function public.refresh_my_roommate_search() from public, anon, authenticated, service_role;

grant execute on function public.refresh_my_roommate_search() to service_role;
grant execute on function public.refresh_my_roommate_search() to authenticated;

CREATE OR REPLACE FUNCTION public.request_accommodation_no_show_review(p_subject_type text, p_subject_id text, p_property_ready_evidence text[], p_explanation text)
 RETURNS accommodation_no_show_reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_profile public.profiles;
  v_res public.reservations; v_listing public.listings;
  v_booking public.hotel_bookings; v_hotel public.hotels;
  v_deadline timestamptz; v_policy public.creator_policy_versions;
  v_result public.accommodation_no_show_reviews;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_subject_type not in('short_let','hotel') then raise exception 'Unsupported stay type'; end if;
  if cardinality(coalesce(p_property_ready_evidence,array[]::text[])) not between 1 and 8
     or char_length(btrim(coalesce(p_explanation,''))) not between 10 and 2000 then
    raise exception 'Property-ready evidence and an explanation are required';
  end if;
  select * into v_profile from public.profiles where user_id=v_actor;
  if p_subject_type='short_let' then
    select * into v_res from public.reservations
    where id=p_subject_id and stay_type='short_let' for update;
    if v_res.id is null or v_res.short_stay_rate_type<>'non_refundable'
       or v_res.status<>'ready_for_move_in' or v_res.rent_payment_status<>'paid'
       or v_res.checked_in_at is not null then
      raise exception 'This Short Let is not eligible for non-refundable no-show review';
    end if;
    select * into v_listing from public.listings
    where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
    if v_res.requested_move_in_at is null then
      raise exception 'The agreed arrival time must be recorded first';
    end if;
    v_deadline:=v_res.requested_move_in_at
      +make_interval(hours=>greatest(coalesce(v_res.arrival_issue_window_hours,2),1));
    if not(
      (v_res.management_mode_snapshot='host'
        and v_res.responsible_host_user_id=v_actor
        and public.current_actor_can_manage_property(v_listing.id))
      or (v_profile.role in('creator','admin','staff')
        and (v_profile.role<>'staff' or public.current_staff_has_permission('operations'))
        and (v_profile.role='creator' or public.current_actor_in_scope(v_listing.state,v_listing.city)))
    ) then raise exception 'Responsible stay operator access required'; end if;
    select * into v_policy from public.creator_policy_versions
    where policy_version_id=v_res.short_stay_rate_terms_policy_version_id
      and policy_key='accommodation_non_refundable_rate';
  else
    select * into v_booking from public.hotel_bookings
    where booking_id::text=p_subject_id for update;
    if v_booking.booking_id is null or v_booking.payment_status<>'paid'
       or v_booking.status<>'confirmed' or v_booking.checked_in_at is not null
       or coalesce(v_booking.rate_plan_snapshot->>'cancellation_template',
         case when coalesce((v_booking.rate_plan_snapshot->>'refundable')::boolean,false)
           then 'standard_legacy' else 'non_refundable' end)<>'non_refundable' then
      raise exception 'This hotel stay is not eligible for non-refundable no-show review';
    end if;
    select * into v_hotel from public.hotels where hotel_id=v_booking.hotel_id;
    v_deadline:=((v_booking.check_in::text||' '||v_hotel.check_in_time::text)::timestamp
      at time zone v_hotel.timezone)
      +make_interval(hours=>greatest(coalesce(v_booking.arrival_issue_window_hours,2),1));
    if not public.hotel_actor_has_capability(v_booking.hotel_id,'stay.check_in')
       and not(v_profile.role in('creator','admin','staff')
         and (v_profile.role<>'staff' or public.current_staff_has_permission('operations'))
         and (v_profile.role='creator' or public.current_actor_in_scope(v_hotel.state,v_hotel.city))) then
      raise exception 'Hotel arrival access required';
    end if;
    select * into v_policy from public.creator_policy_versions
    where policy_version_id=v_booking.cancellation_policy_version_id
      and policy_key='accommodation_non_refundable_rate';
  end if;
  if v_policy.policy_version_id is null then raise exception 'Booked no-show terms are unavailable'; end if;
  if now()<v_deadline then raise exception 'The arrival window is still open'; end if;
  insert into public.accommodation_no_show_reviews(
    subject_type,subject_id,requested_by,property_ready_evidence,explanation,
    arrival_deadline_at,rate_terms_policy_version_id
  ) values(
    p_subject_type,p_subject_id,v_actor,p_property_ready_evidence,btrim(p_explanation),
    v_deadline,v_policy.policy_version_id
  ) returning * into v_result;
  return v_result;
end
$function$;
revoke all on function public.request_accommodation_no_show_review(p_subject_type text, p_subject_id text, p_property_ready_evidence text[], p_explanation text) from public, anon, authenticated, service_role;

grant execute on function public.request_accommodation_no_show_review(p_subject_type text, p_subject_id text, p_property_ready_evidence text[], p_explanation text) to service_role;
grant execute on function public.request_accommodation_no_show_review(p_subject_type text, p_subject_id text, p_property_ready_evidence text[], p_explanation text) to authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_property_host_invite(p_assignment_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_assignment public.property_host_assignments;
  v_invitation_id uuid;
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;

  select invitation_id into v_invitation_id
  from public.resource_invitations
  where resource_type='property'
    and subject_assignment_id=p_assignment_id
    and intended_user_id=v_actor
    and status='pending'
  order by created_at desc
  limit 1;

  if v_invitation_id is not null then
    return public.respond_to_resource_invitation(v_invitation_id,p_accept,null);
  end if;

  update public.property_host_assignments
  set status=case when p_accept then 'active' else 'declined' end,
      accepted_at=case when p_accept then now() else null end,
      revoked_at=case when p_accept then null else now() end,
      updated_at=now()
  where assignment_id=p_assignment_id and user_id=v_actor and status='invited'
  returning * into v_assignment;

  if v_assignment.assignment_id is null then raise exception 'Active invitation not found'; end if;
  return jsonb_build_object('success',true,'status',v_assignment.status,'listing_id',v_assignment.listing_id);
end
$function$;
revoke all on function public.respond_to_property_host_invite(p_assignment_id uuid, p_accept boolean) from public, anon, authenticated, service_role;

grant execute on function public.respond_to_property_host_invite(p_assignment_id uuid, p_accept boolean) to service_role;
grant execute on function public.respond_to_property_host_invite(p_assignment_id uuid, p_accept boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.review_property_change_request(p_change_request_id uuid, p_decision text, p_reason text, p_reinspection_reference text DEFAULT NULL::text)
 RETURNS property_change_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_request public.property_change_requests;
  v_listing public.listings;
  v_images text[];
begin
  if p_decision not in ('approve','changes_requested','reject')
     or char_length(btrim(coalesce(p_reason,'')))<5 then
    raise exception 'Choose a valid decision and record the reason';
  end if;
  select * into v_request from public.property_change_requests
  where change_request_id=p_change_request_id for update;
  if v_request.change_request_id is null
     or v_request.status not in ('submitted','changes_requested','awaiting_reinspection') then
    raise exception 'Open property change request not found';
  end if;
  select * into v_listing from public.listings
  where id=v_request.listing_id and deleted_at is null for update;
  if not (
    public.current_actor_has_workspace('creator',null)
    or (public.current_actor_has_workspace('admin',v_listing.state)
      and public.current_actor_in_scope(v_listing.state,v_listing.city))
    or (public.current_actor_has_workspace('staff',null)
      and public.current_staff_has_permission('operations')
      and public.current_actor_in_scope(v_listing.state,v_listing.city))
  ) then raise exception 'Property Operations authority required'; end if;

  if p_decision='changes_requested' then
    update public.property_change_requests set status='changes_requested',
      reviewed_by=v_actor,reviewed_at=now(),decision_reason=btrim(p_reason),updated_at=now()
    where change_request_id=p_change_request_id returning * into v_request;
  elsif p_decision='reject' then
    update public.property_change_requests set status='rejected',
      reviewed_by=v_actor,reviewed_at=now(),decision_reason=btrim(p_reason),updated_at=now()
    where change_request_id=p_change_request_id returning * into v_request;
  elsif v_request.requires_reinspection
        and char_length(btrim(coalesce(p_reinspection_reference,'')))<3 then
    update public.property_change_requests set status='awaiting_reinspection',
      reviewed_by=v_actor,reviewed_at=now(),decision_reason=btrim(p_reason),updated_at=now()
    where change_request_id=p_change_request_id returning * into v_request;
  else
    if v_request.change_type='price' then
      update public.listings set price=(v_request.proposed_changes->>'price')::numeric,updated_at=now()
      where id=v_listing.id;
    elsif v_request.change_type='photos' then
      select array_agg(value order by ordinality) into v_images
      from jsonb_array_elements_text(v_request.proposed_changes->'images') with ordinality;
      update public.listings set images=v_images,updated_at=now() where id=v_listing.id;
    else
      if v_request.proposed_changes ? 'images' then
        select array_agg(value order by ordinality) into v_images
        from jsonb_array_elements_text(v_request.proposed_changes->'images') with ordinality;
      end if;
      update public.listings set
        description=coalesce(nullif(btrim(v_request.proposed_changes->>'description'),''),description),
        images=coalesce(v_images,images),updated_at=now()
      where id=v_listing.id;
    end if;
    select * into v_listing from public.listings where id=v_listing.id;
    update public.property_change_requests set status='published',
      reviewed_by=v_actor,reviewed_at=now(),decision_reason=btrim(p_reason),
      reinspection_reference=nullif(btrim(coalesce(p_reinspection_reference,'')),''),
      after_snapshot=jsonb_build_object(
        'price',v_listing.price,'description',v_listing.description,
        'images',to_jsonb(v_listing.images),'bedrooms',v_listing.bedrooms,
        'bathrooms',v_listing.bathrooms,'amenities',to_jsonb(v_listing.amenities)
      ),published_at=now(),updated_at=now()
    where change_request_id=p_change_request_id returning * into v_request;
  end if;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'review_property_change_request','property_change_request',
    p_change_request_id::text,jsonb_build_object(
      'decision',p_decision,'resulting_status',v_request.status,
      'listing_id',v_request.listing_id,'reason',btrim(p_reason),
      'reinspection_reference',nullif(btrim(coalesce(p_reinspection_reference,'')),'')
    )::text,now());
  return v_request;
end
$function$;
revoke all on function public.review_property_change_request(p_change_request_id uuid, p_decision text, p_reason text, p_reinspection_reference text) from public, anon, authenticated, service_role;

grant execute on function public.review_property_change_request(p_change_request_id uuid, p_decision text, p_reason text, p_reinspection_reference text) to service_role;
grant execute on function public.review_property_change_request(p_change_request_id uuid, p_decision text, p_reason text, p_reinspection_reference text) to authenticated;

CREATE OR REPLACE FUNCTION public.review_wehouse_property_management(p_listing_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if not (
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null)
    or (public.current_actor_has_workspace('staff',null) and public.current_staff_has_permission('operations'))
  ) then
    raise exception 'Property Operations authority required';
  end if;

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null
  for update;

  if v_listing.id is null
     or v_listing.management_updated_at is null
     or v_listing.management_mode<>'wehouse'
     or v_listing.wehouse_management_status<>'requested' then
    raise exception 'WeHouse management was not requested for this property';
  end if;

  if v_listing.approved_at is null
     or v_listing.status not in ('available','unavailable','reserved','occupied','maintenance','closed') then
    raise exception 'Property management starts after publication';
  end if;

  if not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Property is outside your authority';
  end if;

  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set wehouse_management_status=case when p_approve then 'approved' else 'declined' end,
      management_updated_at=now(),
      updated_at=now()
  where id=p_listing_id
  returning * into v_listing;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'wehouse_property_management_review','listing',p_listing_id::text,
    jsonb_build_object(
      'approved',p_approve,
      'reason',nullif(btrim(coalesce(p_reason,'')),'')
    )::text,now());

  return jsonb_build_object(
    'success',true,
    'management_mode',v_listing.management_mode,
    'wehouse_management_status',v_listing.wehouse_management_status
  );
end
$function$;
revoke all on function public.review_wehouse_property_management(p_listing_id uuid, p_approve boolean, p_reason text) from public, anon, authenticated, service_role;

grant execute on function public.review_wehouse_property_management(p_listing_id uuid, p_approve boolean, p_reason text) to service_role;
grant execute on function public.review_wehouse_property_management(p_listing_id uuid, p_approve boolean, p_reason text) to authenticated;

CREATE OR REPLACE FUNCTION public.revoke_property_host_manager(p_assignment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_assignment public.property_host_assignments;
  v_listing public.listings;
  v_transfer_count integer:=0;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_assignment
  from public.property_host_assignments
  where assignment_id=p_assignment_id
  for update;

  if v_assignment.assignment_id is null
     or v_assignment.assignment_role<>'manager'
     or v_assignment.status not in ('active','invited') then
    raise exception 'Active manager assignment not found';
  end if;

  if not exists(
    select 1
    from public.property_host_assignments owner_assignment
    where owner_assignment.listing_id=v_assignment.listing_id
      and owner_assignment.user_id=v_actor
      and owner_assignment.assignment_role='owner'
      and owner_assignment.status='active'
  ) or not public.user_has_active_workspace(v_actor,'property_partner') then
    raise exception 'Only the active property owner can remove a manager';
  end if;

  select * into v_listing
  from public.listings
  where id=v_assignment.listing_id and deleted_at is null
  for update;
  if v_listing.id is null then raise exception 'Property not found'; end if;

  update public.reservations r
  set responsible_host_user_id=v_actor,
      updated_at=now()
  where (r.listing_id=v_listing.id::text or r.listing_id=v_listing.listing_id)
    and r.management_mode_snapshot='host'
    and r.responsible_host_user_id=v_assignment.user_id
    and r.status not in ('completed','cancelled','refunded','expired');
  get diagnostics v_transfer_count = row_count;

  update public.property_host_conversations c
  set host_user_id=v_actor,
      updated_at=now()
  where c.host_user_id=v_assignment.user_id
    and exists(
      select 1
      from public.reservations r
      where r.id=c.reservation_id
        and (r.listing_id=v_listing.id::text or r.listing_id=v_listing.listing_id)
        and r.management_mode_snapshot='host'
        and r.responsible_host_user_id=v_actor
        and r.status not in ('completed','cancelled','refunded','expired')
    );

  if v_listing.management_mode='host'
     and v_listing.management_host_user_id=v_assignment.user_id then
    perform set_config('wehouse.management_rpc','allowed',true);
    update public.listings
    set management_host_user_id=v_actor,
        management_updated_at=now(),
        updated_at=now()
    where id=v_listing.id;
  end if;

  update public.property_host_assignments
  set status='revoked',
      revoked_at=now(),
      updated_at=now()
  where assignment_id=v_assignment.assignment_id
    and assignment_role='manager';

  if not found then return false; end if;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor,'property_host_manager_revoked','listing',v_listing.id::text,
    jsonb_build_object(
      'removed_user_id',v_assignment.user_id,
      'active_reservations_transferred_to_owner',v_transfer_count,
      'new_responsible_host_user_id',v_actor
    )::text,now()
  );

  return true;
end
$function$;
revoke all on function public.revoke_property_host_manager(p_assignment_id uuid) from public, anon, authenticated, service_role;

grant execute on function public.revoke_property_host_manager(p_assignment_id uuid) to service_role;
grant execute on function public.revoke_property_host_manager(p_assignment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.save_my_worker_pro_customer_note(p_customer_id text, p_note text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.worker_pro_current_actor();
begin
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
end $function$;
revoke all on function public.save_my_worker_pro_customer_note(p_customer_id text, p_note text) from public, anon, authenticated, service_role;

grant execute on function public.save_my_worker_pro_customer_note(p_customer_id text, p_note text) to service_role;
grant execute on function public.save_my_worker_pro_customer_note(p_customer_id text, p_note text) to authenticated;

CREATE OR REPLACE FUNCTION public.search_discoverable_hotels(p_query text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_amenities text[] DEFAULT NULL::text[], p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_radius_km numeric DEFAULT NULL::numeric, p_cursor_featured boolean DEFAULT NULL::boolean, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id integer DEFAULT NULL::integer, p_limit integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with picked as materialized (
    select h.* from public.hotels h
    where h.status = 'active' and h.approved_at is not null and h.published_at is not null
      and (nullif(btrim(p_state),'') is null or lower(h.state) = lower(btrim(p_state)))
      and (nullif(btrim(p_city),'') is null or lower(h.city) = lower(btrim(p_city)))
      and (nullif(btrim(p_query),'') is null or
        strpos(lower(h.name),lower(left(btrim(p_query),80))) > 0)
      and (coalesce(cardinality(p_amenities),0) = 0 or h.amenities @> p_amenities)
      and (p_radius_km is null or (p_radius_km between 0 and 20
        and p_lat between -90 and 90 and p_lng between -180 and 180
        and h.gps_latitude between p_lat - p_radius_km/111.2 and p_lat + p_radius_km/111.2
        and h.gps_longitude between p_lng - p_radius_km/111.2/greatest(0.01,abs(cos(radians(p_lat))))
          and p_lng + p_radius_km/111.2/greatest(0.01,abs(cos(radians(p_lat))))
        and 6371.0*2*asin(least(1.0,sqrt(
          power(sin(radians(h.gps_latitude::double precision-p_lat)/2),2)
          +cos(radians(p_lat))*cos(radians(h.gps_latitude::double precision))
           *power(sin(radians(h.gps_longitude::double precision-p_lng)/2),2)
        ))) <= p_radius_km))
      and ((p_min_price is null and p_max_price is null) or exists (
        select 1 from public.hotel_rooms r where r.hotel_id = h.hotel_id
          and (p_min_price is null or coalesce((
            select min(plan.price_per_night) from public.hotel_rate_plans plan
            where plan.room_id = r.room_id and plan.active
          ),r.price_per_night) >= p_min_price)
          and (p_max_price is null or coalesce((
            select min(plan.price_per_night) from public.hotel_rate_plans plan
            where plan.room_id = r.room_id and plan.active
          ),r.price_per_night) <= p_max_price)
      ))
      and (p_cursor_featured is null or p_cursor_created_at is null or p_cursor_id is null
        or (h.featured,h.created_at,h.hotel_id) < (p_cursor_featured,p_cursor_created_at,p_cursor_id))
    order by h.featured desc,h.created_at desc,h.hotel_id desc
    limit least(greatest(coalesce(p_limit,24),1),48)+1
  ), page as materialized (
    select * from picked order by featured desc,created_at desc,hotel_id desc
    limit least(greatest(coalesce(p_limit,24),1),48)
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'hotel_id',h.hotel_id,'name',h.name,'description',h.description,
      'state',h.state,'city',h.city,'area',h.area,'address',h.address,
      'images',coalesce(h.images,array[]::text[]),
      'amenities',coalesce(h.amenities,array[]::text[]),
      'status',h.status,'rating',h.rating,'review_count',h.review_count,
      'featured',h.featured,'created_at',h.created_at,
      'gps_latitude',null,'gps_longitude',null,'location_exact',false,
      'check_in_time',h.check_in_time,'check_out_time',h.check_out_time,'timezone',h.timezone,
      'hotel_rooms',coalesce((select jsonb_agg(jsonb_build_object(
        'room_id',room.room_id,'room_type',room.room_type,
        'price_per_night',coalesce((select min(plan.price_per_night)
          from public.hotel_rate_plans plan where plan.room_id=room.room_id and plan.active),room.price_per_night)
      ) order by room.price_per_night,room.room_id)
        from public.hotel_rooms room where room.hotel_id=h.hotel_id),'[]'::jsonb)
    ) order by h.featured desc,h.created_at desc,h.hotel_id desc) from page h),'[]'::jsonb),
    'has_more',(select count(*) from picked) > (select count(*) from page),
    'next_cursor_featured',(select featured from page order by featured,created_at,hotel_id limit 1),
    'next_cursor_created_at',(select created_at from page order by featured,created_at,hotel_id limit 1),
    'next_cursor_id',(select hotel_id from page order by featured,created_at,hotel_id limit 1)
  );
$function$;
revoke all on function public.search_discoverable_hotels(p_query text, p_state text, p_city text, p_amenities text[], p_min_price numeric, p_max_price numeric, p_lat double precision, p_lng double precision, p_radius_km numeric, p_cursor_featured boolean, p_cursor_created_at timestamp with time zone, p_cursor_id integer, p_limit integer) from public, anon, authenticated, service_role;

grant execute on function public.search_discoverable_hotels(p_query text, p_state text, p_city text, p_amenities text[], p_min_price numeric, p_max_price numeric, p_lat double precision, p_lng double precision, p_radius_km numeric, p_cursor_featured boolean, p_cursor_created_at timestamp with time zone, p_cursor_id integer, p_limit integer) to service_role;
grant execute on function public.search_discoverable_hotels(p_query text, p_state text, p_city text, p_amenities text[], p_min_price numeric, p_max_price numeric, p_lat double precision, p_lng double precision, p_radius_km numeric, p_cursor_featured boolean, p_cursor_created_at timestamp with time zone, p_cursor_id integer, p_limit integer) to anon;
grant execute on function public.search_discoverable_hotels(p_query text, p_state text, p_city text, p_amenities text[], p_min_price numeric, p_max_price numeric, p_lat double precision, p_lng double precision, p_radius_km numeric, p_cursor_featured boolean, p_cursor_created_at timestamp with time zone, p_cursor_id integer, p_limit integer) to authenticated;

CREATE OR REPLACE FUNCTION public.set_apartment_commission_on_reservation(p_reservation_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_res public.reservations;
  v_policy record;
begin
  select * into v_res from public.reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  select * into v_policy from private.resolve_apartment_commission_policy(
    coalesce(v_res.stay_type,'long_stay'),v_res.management_mode_snapshot,
    v_res.commission_policy_version_id
  );
  if v_policy.policy_version_id is null then
    select * into v_policy from private.resolve_apartment_commission_policy(
      coalesce(v_res.stay_type,'long_stay'),v_res.management_mode_snapshot,null
    );
  end if;
  if v_policy.policy_version_id is null or v_policy.percent not between 0 and 50 then
    raise exception 'Active Creator apartment commission policy is missing';
  end if;
  update public.reservations set
    commission_policy_version_id=v_policy.policy_version_id,
    commission_rate=v_policy.percent,updated_at=now()
  where id=p_reservation_id;
  return true;
end
$function$;
revoke all on function public.set_apartment_commission_on_reservation(p_reservation_id text) from public, anon, authenticated, service_role;

grant execute on function public.set_apartment_commission_on_reservation(p_reservation_id text) to service_role;

CREATE OR REPLACE FUNCTION public.set_my_home_pet_policy(p_listing_id uuid, p_allowed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_changed integer;
begin
 if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then raise exception 'Property Partner access required'; end if;
 update public.listings set pets_allowed=coalesce(p_allowed,false),updated_at=now() where id=p_listing_id and deleted_at is null
   and exists(select 1 from public.property_host_assignments a where a.listing_id=p_listing_id
     and a.user_id=v_actor and a.assignment_role='owner' and a.status='active');
 get diagnostics v_changed=row_count;
 if v_changed<>1 then raise exception 'Owned home required'; end if;
 return true;
end $function$;
revoke all on function public.set_my_home_pet_policy(p_listing_id uuid, p_allowed boolean) from public, anon, authenticated, service_role;

grant execute on function public.set_my_home_pet_policy(p_listing_id uuid, p_allowed boolean) to service_role;
grant execute on function public.set_my_home_pet_policy(p_listing_id uuid, p_allowed boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_hotel_room_pet_policy(p_room_id integer, p_allowed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_changed integer;
begin
 if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then raise exception 'Property Partner access required'; end if;
 update public.hotel_rooms room set pets_allowed=coalesce(p_allowed,false),updated_at=now()
   where room.room_id=p_room_id and exists(select 1 from public.hotels hotel
     where hotel.hotel_id=room.hotel_id and hotel.owner_id=v_actor);
 get diagnostics v_changed=row_count;
 if v_changed<>1 then raise exception 'Owned hotel room required'; end if;
 return true;
end $function$;
revoke all on function public.set_my_hotel_room_pet_policy(p_room_id integer, p_allowed boolean) from public, anon, authenticated, service_role;

grant execute on function public.set_my_hotel_room_pet_policy(p_room_id integer, p_allowed boolean) to service_role;
grant execute on function public.set_my_hotel_room_pet_policy(p_room_id integer, p_allowed boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_property_management_mode(p_listing_id uuid, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if p_mode not in ('host','wehouse') then
    raise exception 'Choose Host manages or WeHouse manages';
  end if;

  if not exists(
    select 1
    from public.property_host_assignments a
    where a.listing_id=p_listing_id
      and a.user_id=v_actor
      and a.assignment_role='owner'
      and a.status='active'
  ) then
    raise exception 'Only the property owner can change who manages this home';
  end if;

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null
  for update;

  if v_listing.id is null then
    raise exception 'Property not found';
  end if;

  if v_listing.approved_at is null
     or v_listing.status not in ('available','unavailable','reserved','occupied','maintenance','closed') then
    raise exception 'Choose property management after this home is published';
  end if;

  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set management_mode=p_mode,
      management_host_user_id=case when p_mode='host' then v_actor else null end,
      wehouse_management_status=case
        when p_mode='host' then 'not_required'
        when management_mode='wehouse' and wehouse_management_status='approved' and management_updated_at is not null then 'approved'
        else 'requested'
      end,
      management_updated_at=now(),
      updated_at=now()
  where id=p_listing_id
  returning * into v_listing;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'property_management_mode_changed','listing',p_listing_id::text,
    jsonb_build_object(
      'management_mode',v_listing.management_mode,
      'wehouse_management_status',v_listing.wehouse_management_status,
      'management_host_user_id',v_listing.management_host_user_id
    )::text,now());

  return public.get_my_property_management(p_listing_id);
end
$function$;
revoke all on function public.set_my_property_management_mode(p_listing_id uuid, p_mode text) from public, anon, authenticated, service_role;

grant execute on function public.set_my_property_management_mode(p_listing_id uuid, p_mode text) to service_role;
grant execute on function public.set_my_property_management_mode(p_listing_id uuid, p_mode text) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_property_stay_rules(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_platform_min integer:=1;
  v_platform_max integer:=90;
  v_discount numeric(5,2);
begin
  if not public.current_actor_can_change_property_commercials(p_listing_id) then
    raise exception 'Full hosting access is required to change future stay rules';
  end if;
  select * into v_listing from public.listings
  where id=p_listing_id and deleted_at is null for update;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if v_listing.sub_type<>'short_let' then
    raise exception 'Stay-length and non-refundable rates are only for Short Lets';
  end if;

  select coalesce(nullif(value,'')::integer,1) into v_platform_min
  from public.platform_settings
  where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
  select coalesce(nullif(value,'')::integer,90) into v_platform_max
  from public.platform_settings
  where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
  v_platform_min:=greatest(coalesce(v_platform_min,1),1);
  v_platform_max:=greatest(coalesce(v_platform_max,90),v_platform_min);
  if p_min_nights is null or p_max_nights is null
     or p_min_nights<v_platform_min or p_max_nights>v_platform_max
     or p_max_nights<p_min_nights then
    raise exception 'Stay length must be between % and % nights',v_platform_min,v_platform_max;
  end if;
  if p_non_refundable_enabled is null then
    raise exception 'Choose whether to offer a non-refundable rate';
  end if;
  if p_non_refundable_enabled then
    v_discount:=round(coalesce(p_non_refundable_discount_percent,0),2);
    if v_discount<1 or v_discount>30 then
      raise exception 'Non-refundable discount must be between 1 and 30 percent';
    end if;
  else
    v_discount:=null;
  end if;

  update public.listings set
    minimum_stay_nights=p_min_nights,
    maximum_stay_nights=p_max_nights,
    non_refundable_rate_enabled=p_non_refundable_enabled,
    non_refundable_discount_percent=v_discount,
    updated_at=now()
  where id=p_listing_id;

  insert into public.property_commercial_change_log(
    listing_id,actor_user_id,event_type,before_state,after_state
  ) values(
    p_listing_id,v_actor,'stay_rules_changed',
    jsonb_build_object(
      'minimum_stay_nights',v_listing.minimum_stay_nights,
      'maximum_stay_nights',v_listing.maximum_stay_nights,
      'non_refundable_rate_enabled',v_listing.non_refundable_rate_enabled,
      'non_refundable_discount_percent',v_listing.non_refundable_discount_percent
    ),
    jsonb_build_object(
      'minimum_stay_nights',p_min_nights,
      'maximum_stay_nights',p_max_nights,
      'non_refundable_rate_enabled',p_non_refundable_enabled,
      'non_refundable_discount_percent',v_discount
    )
  );

  return public.get_my_property_host_controls(p_listing_id);
end
$function$;
revoke all on function public.set_my_property_stay_rules(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) from public, anon, authenticated, service_role;

grant execute on function public.set_my_property_stay_rules(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) to service_role;
grant execute on function public.set_my_property_stay_rules(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_property_stay_rules_v2(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_terms jsonb; v_min numeric; v_max numeric; v_result jsonb;
begin
  select value into v_terms from public.creator_policy_versions
  where policy_key='accommodation_non_refundable_rate'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  v_min:=(v_terms->>'minimum_discount_percent')::numeric;
  v_max:=(v_terms->>'maximum_discount_percent')::numeric;
  if p_non_refundable_enabled and (
    p_non_refundable_discount_percent is null
    or p_non_refundable_discount_percent<v_min
    or p_non_refundable_discount_percent>v_max
  ) then raise exception 'Non-refundable discount must be between % and % percent',v_min,v_max;
  end if;
  v_result:=public.set_my_property_stay_rules(
    p_listing_id,p_min_nights,p_max_nights,p_non_refundable_enabled,
    p_non_refundable_discount_percent
  );
  return public.get_my_property_host_controls_v2(p_listing_id);
end
$function$;
revoke all on function public.set_my_property_stay_rules_v2(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) from public, anon, authenticated, service_role;

grant execute on function public.set_my_property_stay_rules_v2(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) to service_role;
grant execute on function public.set_my_property_stay_rules_v2(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_stay_party(p_kind text, p_booking_id text, p_adults integer, p_children integer, p_infants integer, p_pets integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_changed integer;
begin
 if v_actor is null or p_kind not in ('home','hotel') or p_adults<1 or p_children<0 or p_infants<0 or p_pets<0
   or p_infants>5 or p_pets>5 then raise exception 'Invalid stay party'; end if;
 if p_kind='hotel' then
   update public.hotel_bookings set adult_count=p_adults,child_count=p_children,infant_count=p_infants,pet_count=p_pets,party_details_set=true
    where booking_id::text=p_booking_id and user_id=v_actor and status='pending' and payment_status='unpaid'
      and guest_count=p_adults+p_children;
 else
   update public.reservations set adult_count=p_adults,child_count=p_children,infant_count=p_infants,pet_count=p_pets,party_details_set=true
    where id=p_booking_id and user_id=v_actor and stay_type='short_let' and status='payment_pending'
      and guest_count=p_adults+p_children and rent_payment_status not in ('paid','upfront_paid');
 end if;
 get diagnostics v_changed=row_count;
 if v_changed<>1 then raise exception 'Pending owned stay with matching party required'; end if;
 return true;
end $function$;
revoke all on function public.set_my_stay_party(p_kind text, p_booking_id text, p_adults integer, p_children integer, p_infants integer, p_pets integer) from public, anon, authenticated, service_role;

grant execute on function public.set_my_stay_party(p_kind text, p_booking_id text, p_adults integer, p_children integer, p_infants integer, p_pets integer) to service_role;
grant execute on function public.set_my_stay_party(p_kind text, p_booking_id text, p_adults integer, p_children integer, p_infants integer, p_pets integer) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_worker_customer_record_consent(p_worker_id text, p_consent boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null or not exists(select 1 from public.worker_bookings
      where user_id=v_actor and worker_id=p_worker_id and status='approved_released') then
    raise exception 'A completed job with this Worker is required'; end if;
  if coalesce(p_consent,false) then
    insert into public.worker_customer_record_consents(worker_id,customer_id) values(p_worker_id,v_actor)
    on conflict do nothing;
  else
    delete from public.worker_customer_record_consents where worker_id=p_worker_id and customer_id=v_actor;
    delete from public.worker_pro_customer_notes where worker_id=p_worker_id and customer_id=v_actor;
  end if;
  return coalesce(p_consent,false);
end $function$;
revoke all on function public.set_my_worker_customer_record_consent(p_worker_id text, p_consent boolean) from public, anon, authenticated, service_role;

grant execute on function public.set_my_worker_customer_record_consent(p_worker_id text, p_consent boolean) to service_role;
grant execute on function public.set_my_worker_customer_record_consent(p_worker_id text, p_consent boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_worker_services(p_services jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_item jsonb;
  v_name text;
  v_category text;
  v_price integer;
  v_price_type text;
  v_description text;
  v_count integer:=0;
  v_names text[]:='{}'::text[];
  v_search text[]:='{}'::text[];
begin
  select * into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active Worker account required'; end if;
  if p_services is null or jsonb_typeof(p_services)<>'array' then
    raise exception 'Services must be a list';
  end if;
  if jsonb_array_length(p_services)<1 then
    raise exception 'Add at least one service';
  end if;
  if jsonb_array_length(p_services)>10 then
    raise exception 'A Worker can list up to 10 services';
  end if;

  for v_item in select value from jsonb_array_elements(p_services) loop
    v_name:=nullif(btrim(coalesce(v_item->>'name','')),'');
    v_category:=nullif(btrim(coalesce(v_item->>'category','')),'');
    v_price:=greatest(0,coalesce(nullif(v_item->>'price','')::integer,0));
    v_price_type:=lower(coalesce(nullif(btrim(v_item->>'price_type'),''),'starting_from'));
    v_description:=nullif(btrim(coalesce(v_item->>'description','')),'');

    if v_name is null or v_category is null then
      raise exception 'Every service needs an approved category and service name';
    end if;
    if length(v_name)>120 then raise exception 'Service names must be 120 characters or less'; end if;
    if v_price_type not in ('starting_from','fixed','hourly','daily','negotiable') then
      raise exception 'Unsupported service price type';
    end if;
    if not exists(
      select 1
      from public.service_categories category
      join public.service_subcategories service on service.category_id=category.id
      where lower(btrim(category.name))=lower(v_category)
        and lower(btrim(service.name))=lower(v_name)
        and coalesce(category.is_active,true)
        and coalesce(service.is_active,true)
    ) then
      raise exception 'Choose an active WeHouse service from the approved catalog';
    end if;
    if exists(select 1 from unnest(v_names) existing where lower(existing)=lower(v_name)) then
      raise exception 'Each service can only be added once';
    end if;

    v_names:=array_append(v_names,v_name);
    v_search:=array_append(v_search,v_category);
    v_search:=array_append(v_search,v_name);
  end loop;

  delete from public.worker_services where worker_id=v_actor.user_id;
  for v_item in select value from jsonb_array_elements(p_services) loop
    v_name:=btrim(v_item->>'name');
    v_price:=greatest(0,coalesce(nullif(v_item->>'price','')::integer,0));
    v_price_type:=lower(coalesce(nullif(btrim(v_item->>'price_type'),''),'starting_from'));
    v_description:=nullif(btrim(coalesce(v_item->>'description','')),'');
    insert into public.worker_services(worker_id,service_name,price,price_type,description,created_at,updated_at)
    values(v_actor.user_id,v_name,v_price,v_price_type,v_description,now(),now());
    v_count:=v_count+1;
  end loop;

  update public.profiles
  set worker_skills=(
        select coalesce(jsonb_agg(value order by ord),'[]'::jsonb)
        from (
          select min(ord) ord, value
          from unnest(v_search) with ordinality item(value,ord)
          where nullif(btrim(value),'') is not null
          group by lower(btrim(value)),value
        ) deduped
      ),
      updated_at=now()
  where user_id=v_actor.user_id;

  return jsonb_build_object('success',true,'count',v_count,'services',to_jsonb(v_names));
end;
$function$;
revoke all on function public.set_my_worker_services(p_services jsonb) from public, anon, authenticated, service_role;

grant execute on function public.set_my_worker_services(p_services jsonb) to service_role;
grant execute on function public.set_my_worker_services(p_services jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_apartment_commission_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_policy record;
begin
  if tg_op='UPDATE' and old.commission_policy_version_id is not null then
    new.commission_policy_version_id:=old.commission_policy_version_id;
    new.commission_rate:=old.commission_rate;
    return new;
  end if;

  select * into v_policy
  from private.resolve_apartment_commission_policy(
    coalesce(new.stay_type,'long_stay'),
    coalesce(new.management_mode_snapshot,'wehouse'),
    null
  );
  if v_policy.policy_version_id is null or v_policy.percent not between 0 and 50 then
    raise exception 'Active Creator apartment commission policy is missing or invalid';
  end if;
  new.commission_policy_version_id:=v_policy.policy_version_id;
  new.commission_rate:=v_policy.percent;
  return new;
end
$function$;
revoke all on function public.snapshot_apartment_commission_policy() from public, anon, authenticated, service_role;

grant execute on function public.snapshot_apartment_commission_policy() to service_role;

CREATE OR REPLACE FUNCTION public.snapshot_hotel_cancellation_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_plan public.hotel_rate_plans; v_policy public.creator_policy_versions;
begin
  if tg_op='UPDATE' and old.cancellation_policy_version_id is not null then
    new.cancellation_policy_version_id:=old.cancellation_policy_version_id;
    new.rate_plan_snapshot:=old.rate_plan_snapshot;
    return new;
  end if;
  select * into v_plan from public.hotel_rate_plans
  where rate_plan_id=new.rate_plan_id and room_id=new.room_id;
  if v_plan.rate_plan_id is null then return new; end if;
  if v_plan.cancellation_policy_version_id is not null then
    select * into v_policy from public.creator_policy_versions
    where policy_version_id=v_plan.cancellation_policy_version_id;
    if v_policy.policy_version_id is null then
      raise exception 'Hotel cancellation policy version is unavailable';
    end if;
    new.cancellation_policy_version_id:=v_policy.policy_version_id;
  end if;
  new.rate_plan_snapshot:=coalesce(new.rate_plan_snapshot,'{}'::jsonb)||jsonb_build_object(
    'cancellation_template',v_plan.cancellation_template,
    'cancellation_policy_version_id',v_plan.cancellation_policy_version_id,
    'cancellation_policy_value',case when v_policy.policy_version_id is null
      then null else v_policy.value end
  );
  return new;
end
$function$;
revoke all on function public.snapshot_hotel_cancellation_policy() from public, anon, authenticated, service_role;

grant execute on function public.snapshot_hotel_cancellation_policy() to service_role;

CREATE OR REPLACE FUNCTION public.snapshot_short_let_rate_terms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_standard public.creator_policy_versions;
  v_nonref public.creator_policy_versions;
begin
  if new.stay_type is distinct from 'short_let' then return new; end if;
  if tg_op='UPDATE' and old.short_stay_cancellation_policy_version_id is not null then
    new.short_stay_cancellation_policy_version_id:=old.short_stay_cancellation_policy_version_id;
    new.short_stay_rate_terms_policy_version_id:=old.short_stay_rate_terms_policy_version_id;
    new.short_stay_cancellation_policy_snapshot:=old.short_stay_cancellation_policy_snapshot;
    return new;
  end if;
  select * into v_standard from public.creator_policy_versions
  where policy_key='short_let_cancellation' and scope_type='global' and scope_key='*'
    and status='active' and effective_from<=now()
    and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  select * into v_nonref from public.creator_policy_versions
  where policy_key='accommodation_non_refundable_rate'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  if v_standard.policy_version_id is null or v_nonref.policy_version_id is null then
    raise exception 'Creator-approved Short Let rate terms are unavailable';
  end if;
  new.short_stay_cancellation_policy_version_id:=v_standard.policy_version_id;
  new.short_stay_rate_terms_policy_version_id:=v_nonref.policy_version_id;
  new.short_stay_cancellation_policy_snapshot:=
    coalesce(new.short_stay_cancellation_policy_snapshot,'{}'::jsonb)||jsonb_build_object(
      'standard_policy_version_id',v_standard.policy_version_id,
      'rate_terms_policy_version_id',v_nonref.policy_version_id,
      'non_refundable_terms',v_nonref.value
    );
  return new;
end
$function$;
revoke all on function public.snapshot_short_let_rate_terms() from public, anon, authenticated, service_role;

grant execute on function public.snapshot_short_let_rate_terms() to service_role;

CREATE OR REPLACE FUNCTION public.submit_my_property_change_request(p_listing_id uuid, p_change_type text, p_proposed_changes jsonb, p_reason text)
 RETURNS property_change_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_existing public.property_change_requests;
  v_result public.property_change_requests;
  v_count integer;
begin
  if v_actor is null or not exists(
    select 1 from public.property_host_assignments a
    where a.listing_id=p_listing_id and a.user_id=v_actor
      and a.assignment_role='owner' and a.status='active'
  ) then raise exception 'Only the active property owner can request this change'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Explain why the live property should change';
  end if;
  if p_change_type not in ('price','photos','renovation')
     or jsonb_typeof(p_proposed_changes)<>'object' then
    raise exception 'Choose a supported change and provide its details';
  end if;

  select * into v_listing from public.listings
  where id=p_listing_id and deleted_at is null for update;
  if v_listing.id is null or v_listing.approved_at is null
     or v_listing.status not in ('available','reserved','occupied','maintenance','closed') then
    raise exception 'Only a published property can be revised here';
  end if;

  if p_change_type='price' then
    if v_listing.management_mode<>'wehouse' then
      raise exception 'Host-managed price is changed through Host commercial controls';
    end if;
    if coalesce((p_proposed_changes->>'price')::numeric,0)<=0 then
      raise exception 'The proposed price must be greater than zero';
    end if;
  elsif p_change_type='photos' then
    if jsonb_typeof(p_proposed_changes->'images')<>'array' then
      raise exception 'Choose the replacement property photos';
    end if;
    v_count:=jsonb_array_length(p_proposed_changes->'images');
    if v_count<1 or v_count>12 or exists(
      select 1 from jsonb_array_elements_text(p_proposed_changes->'images') image
      where image !~ '^https://'
    ) then raise exception 'Provide 1 to 12 uploaded property photos'; end if;
  else
    if char_length(btrim(coalesce(p_proposed_changes->>'summary',''))) not between 10 and 2000
       or char_length(coalesce(p_proposed_changes->>'description',''))>5000 then
      raise exception 'Describe the completed renovation';
    end if;
    if p_proposed_changes ? 'images' then
      if jsonb_typeof(p_proposed_changes->'images')<>'array' then
        raise exception 'Renovation photos are invalid';
      end if;
      v_count:=jsonb_array_length(p_proposed_changes->'images');
      if v_count<1 or v_count>12 or exists(
        select 1 from jsonb_array_elements_text(p_proposed_changes->'images') image
        where image !~ '^https://'
      ) then raise exception 'Provide up to 12 uploaded renovation photos'; end if;
    end if;
  end if;

  select * into v_existing from public.property_change_requests
  where listing_id=v_listing.id and requested_by=v_actor
    and change_type=p_change_type and status='changes_requested'
  for update;
  if v_existing.change_request_id is not null then
    update public.property_change_requests set
      proposed_changes=p_proposed_changes,reason=btrim(p_reason),status='submitted',
      reviewed_by=null,reviewed_at=null,decision_reason=null,updated_at=now()
    where change_request_id=v_existing.change_request_id
    returning * into v_result;
    return v_result;
  end if;

  insert into public.property_change_requests(
    listing_id,requested_by,change_type,proposed_changes,reason,materiality,
    requires_reinspection,before_snapshot
  ) values(
    v_listing.id,v_actor,p_change_type,p_proposed_changes,btrim(p_reason),
    case p_change_type when 'price' then 'commercial' when 'photos' then 'media' else 'material' end,
    p_change_type='renovation',
    jsonb_build_object(
      'price',v_listing.price,'description',v_listing.description,
      'images',to_jsonb(v_listing.images),'bedrooms',v_listing.bedrooms,
      'bathrooms',v_listing.bathrooms,'amenities',to_jsonb(v_listing.amenities),
      'management_mode',v_listing.management_mode
    )
  ) returning * into v_result;
  return v_result;
exception when unique_violation then
  raise exception 'This property already has an open % change request',p_change_type;
end
$function$;
revoke all on function public.submit_my_property_change_request(p_listing_id uuid, p_change_type text, p_proposed_changes jsonb, p_reason text) from public, anon, authenticated, service_role;

grant execute on function public.submit_my_property_change_request(p_listing_id uuid, p_change_type text, p_proposed_changes jsonb, p_reason text) to service_role;
grant execute on function public.submit_my_property_change_request(p_listing_id uuid, p_change_type text, p_proposed_changes jsonb, p_reason text) to authenticated;

CREATE OR REPLACE FUNCTION public.validate_stay_party()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_pets boolean; v_capacity integer;
begin
 if tg_op='UPDATE' then
   if old.party_details_set and not new.party_details_set then raise exception 'Stay party cannot be cleared'; end if;
   -- A property can change its future pet policy without invalidating an
   -- already accepted and paid party during payment or check-in updates.
   if old.party_details_set and new.party_details_set and old.adult_count=new.adult_count
     and old.child_count=new.child_count and old.infant_count=new.infant_count and old.pet_count=new.pet_count
     and old.guest_count=new.guest_count then return new; end if;
 end if;
 if not new.party_details_set then return new; end if;
 if new.adult_count<1 or new.child_count<0 or new.infant_count<0 or new.pet_count<0
   or new.infant_count>5 or new.pet_count>5 or new.guest_count<>new.adult_count+new.child_count then
   raise exception 'Invalid stay party'; end if;
 if tg_table_name='hotel_bookings' then
   select max_guests,pets_allowed into v_capacity,v_pets from public.hotel_rooms where room_id=new.room_id and hotel_id=new.hotel_id;
 else
   select max_guests,pets_allowed into v_capacity,v_pets from public.listings where id::text=new.listing_id or listing_id=new.listing_id limit 1;
 end if;
 if v_capacity is null or new.guest_count>v_capacity then raise exception 'Party exceeds property capacity'; end if;
 if new.pet_count>0 and not coalesce(v_pets,false) then raise exception 'Pets are not allowed at this property'; end if;
 return new;
end $function$;
revoke all on function public.validate_stay_party() from public, anon, authenticated, service_role;

grant execute on function public.validate_stay_party() to service_role;

CREATE OR REPLACE FUNCTION public.worker_pro_is_active(p_worker_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists(
    select 1 from public.worker_pro_subscriptions subscription
    where subscription.worker_id=p_worker_id
      and subscription.status in ('active','grace_period')
      and subscription.current_period_end>now()
  );
$function$;
revoke all on function public.worker_pro_is_active(p_worker_id text) from public, anon, authenticated, service_role;

grant execute on function public.worker_pro_is_active(p_worker_id text) to service_role;
grant execute on function public.worker_pro_is_active(p_worker_id text) to authenticated;
 then
    select * into v_listing
    from public.listings l
    where l.id=p_listing_id::uuid
      and l.deleted_at is null
    limit 1;
  end if;
  if v_listing.id is null then return null; end if;

  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''))
  into v_partner_name
  from public.profiles p
  where p.user_id=coalesce(v_listing.partner_id,v_listing.owner_id);

  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor.user_id is not null then
    v_internal:=public.current_actor_can_manage_property(v_listing.id)
      or public.current_actor_has_workspace('creator',null)
      or (
        public.current_actor_has_workspace('admin',v_listing.state)
        and public.current_actor_in_scope(v_listing.state,v_listing.city)
      )
      or (
        public.current_staff_has_permission('operations')
        and public.current_actor_in_scope(v_listing.state,v_listing.city)
      );
  end if;

  if not v_internal and not (
    v_listing.status='available'
    and v_listing.availability_status='available'
    and v_listing.inspection_request_id is not null
    and v_listing.approved_at is not null
  ) then return null; end if;

  if v_listing.sub_type='short_let' then
    select coalesce(nullif(value,'')::integer,1) into v_platform_min
    from public.platform_settings
    where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
    select coalesce(nullif(value,'')::integer,90) into v_platform_max
    from public.platform_settings
    where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
    select p.value into v_cancellation
    from public.creator_policy_versions p
    where p.policy_key='short_let_cancellation'
      and p.scope_type='global' and p.scope_key='*' and p.status='active'
      and p.effective_from<=now()
      and (p.effective_until is null or p.effective_until>now())
    order by p.effective_from desc,p.version desc limit 1;
    v_platform_min:=greatest(coalesce(v_platform_min,1),1);
    v_platform_max:=greatest(coalesce(v_platform_max,90),v_platform_min);
  end if;

  if v_internal then
    return to_jsonb(v_listing)||jsonb_build_object(
      'location_exact',true,
      'partner_display_name',v_partner_name,
      'minimum_stay_nights',case when v_listing.sub_type='short_let' then
        greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min) else null end,
      'maximum_stay_nights',case when v_listing.sub_type='short_let' then
        greatest(
          least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max),
          greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min)
        ) else null end,
      'standard_cancellation',v_cancellation
    );
  end if;

  return jsonb_build_object(
    'id',v_listing.id,
    'listing_id',v_listing.listing_id,
    'title',v_listing.title,
    'description',v_listing.description,
    'price',v_listing.price,
    'currency',v_listing.currency,
    'state',v_listing.state,
    'city',v_listing.city,
    'address',v_listing.address,
    'images',coalesce(v_listing.images,array[]::text[]),
    'videos',coalesce(v_listing.videos,array[]::text[]),
    'bedrooms',v_listing.bedrooms,
    'bathrooms',v_listing.bathrooms,
    'availability_status',v_listing.availability_status,
    'status',v_listing.status,
    'property_type',v_listing.property_type,
    'sub_type',v_listing.sub_type,
    'security_deposit_amount',v_listing.security_deposit_amount,
    'max_guests',v_listing.max_guests,
    'pets_allowed',v_listing.pets_allowed,
    'max_occupants',v_listing.max_occupants,
    'future_installments_allowed',v_listing.future_installments_allowed,
    'minimum_stay_nights',case when v_listing.sub_type='short_let' then
      greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min) else null end,
    'maximum_stay_nights',case when v_listing.sub_type='short_let' then
      greatest(
        least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max),
        greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min)
      ) else null end,
    'non_refundable_rate_enabled',v_listing.non_refundable_rate_enabled,
    'non_refundable_discount_percent',v_listing.non_refundable_discount_percent,
    'standard_cancellation',v_cancellation,
    'rating',v_listing.rating,
    'review_count',v_listing.review_count,
    'amenities',coalesce(v_listing.amenities,array[]::text[]),
    'created_at',v_listing.created_at,
    'updated_at',v_listing.updated_at,
    'gps_latitude',null,
    'gps_longitude',null,
    'location_accuracy_m',null,
    'location_exact',false,
    'partner_display_name',v_partner_name
  );
end
$function$;
revoke all on function public.get_public_listing_detail(p_listing_id text) from public, anon, authenticated, service_role;

grant execute on function public.get_public_listing_detail(p_listing_id text) to service_role;
grant execute on function public.get_public_listing_detail(p_listing_id text) to anon;
grant execute on function public.get_public_listing_detail(p_listing_id text) to authenticated;

CREATE OR REPLACE FUNCTION public.get_short_let_date_availability(p_listing_id text, p_check_in date, p_check_out date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_listing public.listings;
  v_platform_min integer:=1;
  v_platform_max integer:=90;
  v_min_nights integer;
  v_max_nights integer;
  v_advance_days integer:=365;
  v_nights integer;
  v_available boolean:=false;
  v_reason text;
begin
  select * into v_listing
  from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.sub_type='short_let'
    and l.deleted_at is null
    and l.inspection_request_id is not null
    and l.approved_at is not null
  limit 1;

  if v_listing.id is null then
    return jsonb_build_object('available',false,'reason','not_found');
  end if;
  if v_listing.status<>'available' or v_listing.availability_status<>'available'
     or v_listing.host_booking_paused then
    return jsonb_build_object('available',false,'reason','not_published');
  end if;

  select coalesce(nullif(value,'')::integer,1) into v_platform_min
  from public.platform_settings
  where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
  select coalesce(nullif(value,'')::integer,90) into v_platform_max
  from public.platform_settings
  where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
  select coalesce(nullif(value,'')::integer,365) into v_advance_days
  from public.platform_settings
  where key='short_stay_booking_advance_days' and coalesce(is_active,true) limit 1;

  v_platform_min:=greatest(coalesce(v_platform_min,1),1);
  v_platform_max:=greatest(coalesce(v_platform_max,90),v_platform_min);
  v_min_nights:=greatest(coalesce(v_listing.minimum_stay_nights,v_platform_min),v_platform_min);
  v_max_nights:=least(coalesce(v_listing.maximum_stay_nights,v_platform_max),v_platform_max);
  v_max_nights:=greatest(v_max_nights,v_min_nights);
  v_advance_days:=greatest(coalesce(v_advance_days,365),v_max_nights);

  if p_check_in is null or p_check_out is null
     or p_check_in<timezone('Africa/Lagos',now())::date
     or p_check_out<=p_check_in then
    v_reason:='invalid_dates';
  elsif p_check_in>timezone('Africa/Lagos',now())::date+v_advance_days
     or p_check_out>timezone('Africa/Lagos',now())::date+v_advance_days then
    v_reason:='outside_booking_window';
  else
    v_nights:=p_check_out-p_check_in;
    if v_nights<v_min_nights or v_nights>v_max_nights then
      v_reason:='invalid_length';
    elsif exists(
      select 1 from public.property_host_date_blocks b
      where b.listing_id=v_listing.id and b.reopened_at is null
        and daterange(b.start_date,b.reopen_date,'[)')
          && daterange(p_check_in,p_check_out,'[)')
    ) then
      v_reason:='dates_unavailable';
    elsif exists(
      select 1 from public.reservations r
      where r.listing_id=v_listing.id::text
        and r.stay_type='short_let'
        and r.status=any(array['reserved','ready_for_move_in','occupied']::text[])
        and daterange(r.stay_check_in,r.stay_check_out,'[)')
          && daterange(p_check_in,p_check_out,'[)')
    ) then
      v_reason:='dates_unavailable';
    else
      v_available:=true;
      v_reason:='available';
    end if;
  end if;

  return jsonb_build_object(
    'available',v_available,
    'reason',v_reason,
    'nights',case when p_check_in is not null and p_check_out is not null
      then p_check_out-p_check_in else null end,
    'min_nights',v_min_nights,
    'max_nights',v_max_nights
  );
end
$function$;
revoke all on function public.get_short_let_date_availability(p_listing_id text, p_check_in date, p_check_out date) from public, anon, authenticated, service_role;

grant execute on function public.get_short_let_date_availability(p_listing_id text, p_check_in date, p_check_out date) to service_role;
grant execute on function public.get_short_let_date_availability(p_listing_id text, p_check_in date, p_check_out date) to anon;
grant execute on function public.get_short_let_date_availability(p_listing_id text, p_check_in date, p_check_out date) to authenticated;

CREATE OR REPLACE FUNCTION public.guard_accommodation_release_outbox()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_deadline timestamptz; v_open_issue boolean; v_state text;
  v_approved_no_show boolean:=false;
begin
  if new.action_type not in('release_short_let_stay','release_hotel_stay') then return new; end if;
  if new.status<>'pending' then return new; end if;
  select exists(
    select 1 from public.accommodation_no_show_reviews review
    where review.subject_type=new.subject_type and review.subject_id=new.subject_id
      and review.status='approved'
      and new.idempotency_key='approved-no-show-release:'||review.no_show_review_id
  ) into v_approved_no_show;
  if new.action_type='release_short_let_stay' then
    select reservation.arrival_issue_deadline_at,
      exists(select 1 from public.operational_cases case_row
        where case_row.subject_type='short_let' and case_row.subject_id=reservation.id
          and case_row.status not in('resolved','closed'))
    into v_deadline,v_open_issue from public.reservations reservation
    where reservation.id=new.subject_id;
  else
    select booking.arrival_issue_deadline_at,
      exists(select 1 from public.operational_cases case_row
        where case_row.subject_type='hotel' and case_row.subject_id=booking.booking_id::text
          and case_row.status not in('resolved','closed'))
    into v_deadline,v_open_issue from public.hotel_bookings booking
    where booking.booking_id::text=new.subject_id;
  end if;
  select protection_state into v_state from public.payment_protection_transactions
  where id=new.payment_protection_id;
  if coalesce(v_open_issue,false) or v_state not in('protected','release_eligible') then
    return null;
  end if;
  if not v_approved_no_show and (v_deadline is null or now()<v_deadline) then return null; end if;
  return new;
end
$function$;
revoke all on function public.guard_accommodation_release_outbox() from public, anon, authenticated, service_role;

grant execute on function public.guard_accommodation_release_outbox() to service_role;

CREATE OR REPLACE FUNCTION public.invite_property_host_manager(p_listing_id uuid, p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_target public.profiles;
  v_listing public.listings;
  v_assignment public.property_host_assignments;
begin
  select l.* into v_listing
  from public.listings l
  where l.id=p_listing_id
    and l.deleted_at is null
    and exists(
      select 1 from public.property_host_assignments a
      where a.listing_id=l.id
        and a.user_id=v_actor
        and a.assignment_role='owner'
        and a.status='active'
    )
  for update;

  if v_listing.id is null then
    raise exception 'Only the property owner can invite a co-host';
  end if;

  if v_listing.approved_at is null
     or v_listing.status not in ('available','unavailable','reserved','occupied','maintenance','closed') then
    raise exception 'Co-hosts can be added after this home is published';
  end if;

  if v_listing.management_updated_at is null or v_listing.management_mode<>'host' then
    raise exception 'Choose Host manages before inviting a co-host';
  end if;

  select * into v_target
  from public.profiles
  where lower(username)=lower(btrim(p_username))
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_target.user_id is null or v_target.user_id=v_actor then
    raise exception 'Choose another existing WeHouse user';
  end if;

  if not public.user_has_active_workspace(v_target.user_id,'property_partner') then
    raise exception 'That user must activate a Property Partner workspace first';
  end if;

  insert into public.property_host_assignments(
    listing_id,user_id,assignment_role,status,invited_by,invited_at,accepted_at,revoked_at,updated_at
  ) values(
    p_listing_id,v_target.user_id,'manager','invited',v_actor,now(),null,null,now()
  )
  on conflict(listing_id,user_id) do update set
    assignment_role='manager',
    status='invited',
    invited_by=v_actor,
    invited_at=now(),
    accepted_at=null,
    revoked_at=null,
    updated_at=now()
  returning * into v_assignment;

  return jsonb_build_object(
    'success',true,
    'assignment_id',v_assignment.assignment_id,
    'user_id',v_target.user_id,
    'username',v_target.username,
    'status',v_assignment.status
  );
end
$function$;
revoke all on function public.invite_property_host_manager(p_listing_id uuid, p_username text) from public, anon, authenticated, service_role;

grant execute on function public.invite_property_host_manager(p_listing_id uuid, p_username text) to service_role;
grant execute on function public.invite_property_host_manager(p_listing_id uuid, p_username text) to authenticated;

CREATE OR REPLACE FUNCTION public.partner_save_hotel_rate_plan(p_rate_plan_id integer, p_room_id integer, p_name text, p_description text, p_meal_plan text, p_payment_timing text, p_refundable boolean, p_cancellation_hours integer, p_price_per_night integer, p_included_features text[], p_active boolean DEFAULT true)
 RETURNS hotel_rate_plans
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_room public.hotel_rooms; v_plan public.hotel_rate_plans;
  v_before jsonb:='{}'::jsonb; v_actor text:=public.current_profile_user_id();
  v_policy public.creator_policy_versions; v_template text;
  v_hours integer;
begin
  select * into v_room from public.hotel_rooms where room_id=p_room_id;
  if v_room.room_id is null then raise exception 'Room type not found'; end if;
  if not public.hotel_actor_has_capability(v_room.hotel_id,'hotel.rate.manage') then
    raise exception 'Hotel rate capability required';
  end if;
  if nullif(btrim(p_name),'') is null or coalesce(p_price_per_night,0)<=0 then
    raise exception 'Package name and nightly price are required';
  end if;
  if p_meal_plan not in('room_only','breakfast','half_board','full_board','all_inclusive') then
    raise exception 'Choose a valid meal plan';
  end if;
  if p_payment_timing<>'pay_now' then
    raise exception 'Current hotel packages require WeHouse secure payment';
  end if;
  v_template:=case when coalesce(p_refundable,false) then 'standard'
    else 'non_refundable' end;
  select * into v_policy from public.creator_policy_versions
  where policy_key=case when v_template='standard'
      then 'hotel_standard_cancellation' else 'accommodation_non_refundable_rate' end
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  if v_policy.policy_version_id is null then
    raise exception 'Creator-approved cancellation terms are unavailable';
  end if;
  v_hours:=case when v_template='standard'
    then (v_policy.value->>'full_refund_hours_before_check_in')::integer else null end;
  if p_rate_plan_id is not null and not coalesce(p_active,true) and not exists(
    select 1 from public.hotel_rate_plans plan
    where plan.room_id=v_room.room_id and plan.active
      and plan.rate_plan_id<>p_rate_plan_id
  ) then raise exception 'A room must keep at least one visible package'; end if;
  if p_rate_plan_id is null then
    insert into public.hotel_rate_plans(
      hotel_id,room_id,name,description,meal_plan,payment_timing,refundable,
      cancellation_hours,cancellation_template,cancellation_policy_version_id,
      price_per_night,included_features,active
    ) values(
      v_room.hotel_id,v_room.room_id,btrim(p_name),
      nullif(btrim(coalesce(p_description,'')),''),p_meal_plan,'pay_now',
      v_template='standard',v_hours,v_template,v_policy.policy_version_id,
      p_price_per_night,coalesce(p_included_features,array[]::text[]),
      coalesce(p_active,true)
    ) returning * into v_plan;
  else
    select to_jsonb(plan) into v_before from public.hotel_rate_plans plan
    where plan.rate_plan_id=p_rate_plan_id and plan.room_id=v_room.room_id;
    update public.hotel_rate_plans set
      name=btrim(p_name),description=nullif(btrim(coalesce(p_description,'')),''),
      meal_plan=p_meal_plan,payment_timing='pay_now',refundable=v_template='standard',
      cancellation_hours=v_hours,cancellation_template=v_template,
      cancellation_policy_version_id=v_policy.policy_version_id,
      price_per_night=p_price_per_night,
      included_features=coalesce(p_included_features,array[]::text[]),
      active=coalesce(p_active,true),updated_at=now()
    where rate_plan_id=p_rate_plan_id and room_id=v_room.room_id
    returning * into v_plan;
    if v_plan.rate_plan_id is null then raise exception 'Package not found for this room'; end if;
  end if;
  insert into public.hotel_commercial_change_audit(
    hotel_id,actor_user_id,action,target_type,target_id,before_values,after_values
  ) values(
    v_room.hotel_id,v_actor,
    case when p_rate_plan_id is null then 'future_rate_plan_created'
      else 'future_rate_plan_updated' end,
    'hotel_rate_plan',v_plan.rate_plan_id::text,coalesce(v_before,'{}'::jsonb),to_jsonb(v_plan)
  );
  return v_plan;
end
$function$;
revoke all on function public.partner_save_hotel_rate_plan(p_rate_plan_id integer, p_room_id integer, p_name text, p_description text, p_meal_plan text, p_payment_timing text, p_refundable boolean, p_cancellation_hours integer, p_price_per_night integer, p_included_features text[], p_active boolean) from public, anon, authenticated, service_role;

grant execute on function public.partner_save_hotel_rate_plan(p_rate_plan_id integer, p_room_id integer, p_name text, p_description text, p_meal_plan text, p_payment_timing text, p_refundable boolean, p_cancellation_hours integer, p_price_per_night integer, p_included_features text[], p_active boolean) to service_role;
grant execute on function public.partner_save_hotel_rate_plan(p_rate_plan_id integer, p_room_id integer, p_name text, p_description text, p_meal_plan text, p_payment_timing text, p_refundable boolean, p_cancellation_hours integer, p_price_per_night integer, p_included_features text[], p_active boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.process_verified_paystack_charge(p_provider_event_key text, p_event_type text, p_provider_reference text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text, p_transaction_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_event public.verified_provider_events;
  v_payment public.booking_payments;
  v_result jsonb;
  v_amount numeric(18,2);
  v_payer text;
  v_payee text;
  v_subject_type text;
  v_subject_id text;
  v_component text;
  v_rate numeric:=0;
  v_policy_id uuid;
  v_protection public.payment_protection_transactions;
  v_stay_protection public.payment_protection_transactions;
  v_caution_protection public.payment_protection_transactions;
  v_reservation public.reservations;
  v_listing public.listings;
  v_hotel_booking public.hotel_bookings;
  v_group public.shared_housing_groups;
  v_stay_amount numeric(18,2):=0;
  v_caution_amount numeric(18,2):=0;
  v_entries jsonb;
  v_liability_total numeric(18,2):=0;
  v_ledger_transaction_id uuid;
  v_error text;
begin
  if (select auth.role())<>'service_role' then
    raise exception 'service role required';
  end if;
  if p_event_type<>'charge.success'
    or nullif(btrim(p_provider_event_key),'') is null
    or nullif(btrim(p_provider_reference),'') is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_signature_verified_at is null
    or p_amount_minor<=0
    or upper(p_currency)<>'NGN'
  then raise exception 'Invalid verified Paystack charge'; end if;
  v_amount:=round((p_amount_minor::numeric/100)::numeric,2);

  insert into public.verified_provider_events(
    provider,provider_event_key,event_type,provider_reference,payload_sha256,
    signature_verified_at,processing_status
  ) values(
    'paystack',p_provider_event_key,p_event_type,p_provider_reference,
    lower(p_payload_sha256),p_signature_verified_at,'received'
  ) on conflict do nothing;

  select * into v_event
  from public.verified_provider_events
  where provider='paystack'
    and event_type=p_event_type
    and provider_reference=p_provider_reference
  for update;
  if v_event.provider_event_id is null then
    raise exception 'Provider event could not be registered';
  end if;
  if v_event.provider_event_key<>p_provider_event_key
    or v_event.payload_sha256<>lower(p_payload_sha256) then
    raise exception 'Provider event replay does not match the verified receipt';
  end if;
  if v_event.processing_status='processed' then
    return jsonb_build_object(
      'success',true,'already_processed',true,
      'provider_event_id',v_event.provider_event_id
    );
  end if;

  select * into v_payment from public.booking_payments
  where paystack_reference=p_provider_reference for update;
  if v_payment.id is null then
    update public.verified_provider_events
    set processing_status='ignored',processed_at=now(),
        processing_error='No matching WeHouse payment reference'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',true,'ignored',true);
  end if;
  if round(coalesce(v_payment.amount_total,v_payment.amount,0)::numeric*100)
      <>p_amount_minor then
    update public.verified_provider_events
    set processing_status='failed',processed_at=now(),
        processing_error='Verified amount does not match the payment request'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Amount mismatch');
  end if;
  if upper(coalesce(v_payment.currency,'NGN'))<>'NGN' then
    update public.verified_provider_events
    set processing_status='failed',processed_at=now(),
        processing_error='Verified currency does not match the payment request'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Currency mismatch');
  end if;

  if v_payment.purpose='worker_booking' then
    select (p.value->>'percent')::numeric,p.policy_version_id
    into v_rate,v_policy_id from public.creator_policy_versions p
    where p.policy_key='commission_worker' and p.scope_type='global'
      and p.scope_key='*' and p.status='active'
      and p.effective_from<=now()
      and (p.effective_until is null or p.effective_until>now())
    order by p.effective_from desc limit 1;
    if v_rate is null or v_rate<0 or v_rate>50 then
      raise exception 'Active Creator Worker commission is required';
    end if;
    update public.platform_settings
    set value=v_rate::text,editable=false,is_active=true,updated_at=now()
    where key='worker_commission_rate';
  end if;

  begin
    if v_payment.purpose='worker_booking' then
      if v_payment.worker_booking_id is null then
        raise exception 'Worker booking link is missing';
      end if;
      v_result:=public.confirm_worker_booking_payment(
        v_payment.worker_booking_id,p_provider_reference,v_amount,'NGN',p_transaction_id
      );
    elsif v_payment.purpose='shared_housing_share' then
      v_result:=public.confirm_shared_housing_payment(
        p_provider_reference,p_transaction_id,v_amount
      );
    elsif v_payment.purpose in(
      'apartment_reservation','apartment_rent','rent_plan_contribution',
      'hotel_booking','worker_verification'
    ) then
      v_result:=public.confirm_booking_payment(
        p_provider_reference,p_transaction_id,v_amount,'webhook',v_payment.purpose
      );
    else
      raise exception 'Unsupported payment purpose: %',coalesce(v_payment.purpose,'missing');
    end if;
    if not coalesce((v_result->>'success')::boolean,false) then
      raise exception '%',coalesce(v_result->>'error','Lifecycle payment confirmation failed');
    end if;

    v_payer:=coalesce(v_payment.payer_user_id,v_payment.user_id);
    v_payee:=v_payment.payee_user_id;
    v_component:=coalesce(v_payment.metadata->>'payment_component','');

    if v_payment.listing_id is not null then
      select * into v_listing from public.listings
      where id::text=v_payment.listing_id limit 1;
      v_payee:=coalesce(v_payee,v_listing.partner_id,v_listing.owner_id);
    end if;

    if v_payment.purpose='worker_booking' then
      select * into v_protection
      from public.payment_protection_transactions
      where booking_type='worker_booking'
        and booking_id=v_payment.worker_booking_id
      for update;
      if v_protection.id is null then
        raise exception 'Worker payment did not create Payment Protection';
      end if;
      update public.payment_protection_transactions
      set subject_type='worker_booking',subject_id=v_payment.worker_booking_id::text,
          amount_commission=round(v_amount*v_rate/100,2),
          amount_payee=v_amount-round(v_amount*v_rate/100,2),
          commission_rate=v_rate,updated_at=now()
      where id=v_protection.id returning * into v_protection;
      update public.worker_bookings
      set payment_protection_id=v_protection.id,policy_version_id=v_policy_id,
          wehouse_fee=v_protection.amount_commission,
          worker_commission=v_protection.amount_commission,
          worker_receives=v_protection.amount_payee,updated_at=now()
      where id=v_payment.worker_booking_id;

    elsif v_payment.purpose='apartment_rent' then
      select * into v_reservation from public.reservations
      where id=v_payment.metadata->>'reservation_id' for update;
      if v_reservation.id is null then raise exception 'Reservation link is missing'; end if;
      if v_listing.id is null then
        select * into v_listing from public.listings
        where id::text=v_reservation.listing_id limit 1;
        v_payee:=coalesce(v_payee,v_listing.partner_id,v_listing.owner_id);
      end if;
      if v_payee is null then raise exception 'Property payee is missing'; end if;

      if v_component='short_stay_rent' or v_reservation.stay_type='short_let' then
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_short_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Short Let commission is required';
        end if;
        v_stay_amount:=round(coalesce(v_reservation.stay_rent_total,
          (v_payment.metadata->>'stay_rent_total')::numeric,0),2);
        v_caution_amount:=round(coalesce(v_reservation.security_deposit_snapshot,
          (v_payment.metadata->>'security_deposit_amount')::numeric,0),2);
        if v_stay_amount<=0 or v_stay_amount+v_caution_amount<>v_amount then
          raise exception 'Short Let stay and Caution split does not match verified money';
        end if;
        insert into public.payment_protection_transactions(
          booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
          amount_commission,amount_payee,commission_rate,status,
          paystack_reference,protection_state,subject_type,subject_id
        ) values(
          null,'short_let_stay',v_payer,v_payee,v_stay_amount,
          round(v_stay_amount*v_rate/100,2),
          v_stay_amount-round(v_stay_amount*v_rate/100,2),v_rate,
          'protected',p_provider_reference,'awaiting_funds',
          'short_let_stay',v_reservation.id
        ) on conflict(subject_type,subject_id) do update
          set paystack_reference=excluded.paystack_reference,updated_at=now()
        returning * into v_stay_protection;
        if v_caution_amount>0 then
          insert into public.payment_protection_transactions(
            booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
            amount_commission,amount_payee,commission_rate,status,
            paystack_reference,protection_state,subject_type,subject_id
          ) values(
            null,'short_let_caution',v_payer,v_payee,v_caution_amount,
            0,v_caution_amount,0,'protected',p_provider_reference,
            'awaiting_funds','short_let_caution',v_reservation.id
          ) on conflict(subject_type,subject_id) do update
            set paystack_reference=excluded.paystack_reference,updated_at=now()
          returning * into v_caution_protection;
        end if;
        update public.reservations
        set stay_payment_protection_id=v_stay_protection.id,
            caution_payment_protection_id=v_caution_protection.id,
            commission_policy_version_id=v_policy_id,updated_at=now()
        where id=v_reservation.id;
      else
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_long_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Long Let commission is required';
        end if;
        insert into public.payment_protection_transactions(
          booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
          amount_commission,amount_payee,commission_rate,status,
          paystack_reference,protection_state,subject_type,subject_id
        ) values(
          null,'long_let_year_one',v_payer,v_payee,v_amount,
          round(v_amount*v_rate/100,2),v_amount-round(v_amount*v_rate/100,2),
          v_rate,'protected',p_provider_reference,'awaiting_funds',
          'long_let_year_one',v_reservation.id
        ) on conflict(subject_type,subject_id) do update
          set paystack_reference=excluded.paystack_reference,updated_at=now()
        returning * into v_protection;
        update public.reservations
        set year_one_rent_protection_id=v_protection.id,
            commission_policy_version_id=v_policy_id,updated_at=now()
        where id=v_reservation.id;
      end if;

    elsif v_payment.purpose='hotel_booking' then
      select * into v_hotel_booking from public.hotel_bookings
      where booking_id=v_payment.hotel_booking_id for update;
      if v_hotel_booking.booking_id is null then raise exception 'Hotel booking is missing'; end if;
      select h.owner_id into v_payee from public.hotels h
      where h.hotel_id=v_hotel_booking.hotel_id;
      if v_payee is null then raise exception 'Hotel payee is missing'; end if;
      select (p.value->>'percent')::numeric,p.policy_version_id
      into v_rate,v_policy_id from public.creator_policy_versions p
      where p.policy_key='commission_hotel' and p.scope_type='global'
        and p.scope_key='*' and p.status='active'
        and p.effective_from<=now()
        and (p.effective_until is null or p.effective_until>now())
      order by p.effective_from desc limit 1;
      if v_rate is null or v_rate<0 or v_rate>50 then
        raise exception 'Active Creator Hotel commission is required';
      end if;
      insert into public.payment_protection_transactions(
        booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
        amount_commission,amount_payee,commission_rate,status,
        paystack_reference,protection_state,subject_type,subject_id
      ) values(
        null,'hotel_stay',v_payer,v_payee,v_amount,
        round(v_amount*v_rate/100,2),v_amount-round(v_amount*v_rate/100,2),
        v_rate,'protected',p_provider_reference,'awaiting_funds',
        'hotel_stay',v_hotel_booking.booking_id::text
      ) on conflict(subject_type,subject_id) do update
        set paystack_reference=excluded.paystack_reference,updated_at=now()
      returning * into v_protection;
      update public.hotel_bookings
      set payment_protection_id=v_protection.id,policy_version_id=v_policy_id,
          updated_at=now()
      where booking_id=v_hotel_booking.booking_id;

    elsif v_payment.purpose='shared_housing_share'
      and coalesce(v_payment.metadata->>'payment_phase','')<>'reservation_fee' then
      select g.* into v_group from public.shared_housing_groups g
      where g.id=(v_payment.metadata->>'shared_group_id')::uuid;
      if v_group.id is null then raise exception 'Shared payment group is missing'; end if;
      select * into v_listing from public.listings where id=v_group.listing_id;
      v_payee:=coalesce(v_listing.partner_id,v_listing.owner_id);
      if v_payee is null then raise exception 'Shared payment payee is missing'; end if;
      if v_listing.sub_type='short_let' then
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_short_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Short Let commission is required';
        end if;
      else
        select (p.value->>'percent')::numeric,p.policy_version_id
        into v_rate,v_policy_id from public.creator_policy_versions p
        where p.policy_key='commission_long_let' and p.scope_type='global'
          and p.scope_key='*' and p.status='active'
          and p.effective_from<=now()
          and (p.effective_until is null or p.effective_until>now())
        order by p.effective_from desc limit 1;
        if v_rate is null or v_rate<0 or v_rate>50 then
          raise exception 'Active Creator Long Let commission is required';
        end if;
      end if;
      insert into public.payment_protection_transactions(
        booking_id,booking_type,payer_user_id,payee_user_id,amount_total,
        amount_commission,amount_payee,commission_rate,status,
        paystack_reference,protection_state,subject_type,subject_id
      ) values(
        null,'shared_housing_share',v_payer,v_payee,v_amount,
        round(v_amount*v_rate/100,2),v_amount-round(v_amount*v_rate/100,2),
        v_rate,'protected',p_provider_reference,'awaiting_funds',
        'shared_housing_share',v_payment.metadata->>'shared_member_id'
      ) on conflict(subject_type,subject_id) do update
        set paystack_reference=excluded.paystack_reference,updated_at=now()
      returning * into v_protection;
    end if;

    v_entries:=jsonb_build_array(jsonb_build_object(
      'account_key','asset:paystack_clearing:NGN','account_class','asset',
      'amount',v_amount,'memo','Paystack verified charge'
    ));
    for v_protection in
      select p.* from public.payment_protection_transactions p
      where p.paystack_reference=p_provider_reference
        and p.subject_type in(
          'worker_booking','long_let_year_one','short_let_stay',
          'short_let_caution','hotel_stay','shared_housing_share'
        )
      order by p.subject_type,p.id
    loop
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'account_key','liability:payment_protection:'||v_protection.id::text,
        'account_class','liability','owner_type',v_protection.subject_type,
        'owner_id',v_protection.subject_id,'amount',-v_protection.amount_total,
        'memo','Protected customer funds'
      ));
      v_liability_total:=v_liability_total+v_protection.amount_total;
    end loop;
    if v_liability_total>v_amount then
      raise exception 'Payment Protection allocation exceeds verified money';
    end if;
    if v_liability_total<v_amount then
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'account_key',case
          when v_payment.purpose='apartment_reservation'
            or (v_payment.purpose='shared_housing_share'
              and v_payment.metadata->>'payment_phase'='reservation_fee')
            then 'liability:unearned_reservation_fee:'||v_payment.id::text
          when v_payment.purpose='rent_plan_contribution'
            then 'liability:partner_payable:'||coalesce(v_payee,'unresolved')
          else 'liability:customer_funds:'||v_payment.id::text end,
        'account_class','liability','owner_type','booking_payment',
        'owner_id',v_payment.id::text,'amount',-(v_amount-v_liability_total),
        'memo','Unreleased customer funds'
      ));
    end if;

    v_ledger_transaction_id:=public.post_ledger_transaction(
      'paystack-charge:'||p_provider_reference,'provider_charge','NGN',
      'booking_payment',v_payment.id::text,v_event.provider_event_id,
      jsonb_build_object(
        'provider','paystack','provider_reference',p_provider_reference,
        'purpose',v_payment.purpose,'payer_user_id',v_payer
      ),v_entries
    );

    for v_protection in
      select p.* from public.payment_protection_transactions p
      where p.paystack_reference=p_provider_reference
        and p.subject_type in(
          'worker_booking','long_let_year_one','short_let_stay',
          'short_let_caution','hotel_stay','shared_housing_share'
        )
      order by p.subject_type,p.id
    loop
      update public.payment_protection_transactions
      set protected_ledger_transaction_id=v_ledger_transaction_id,updated_at=now()
      where id=v_protection.id;
      if v_protection.protection_state='awaiting_funds' then
        perform public.transition_payment_protection(
          v_protection.id,'protected','provider_charge_verified',
          'paystack-protected:'||p_provider_reference||':'||v_protection.id::text,
          null,'paystack',null,v_ledger_transaction_id,
          jsonb_build_object('provider_event_id',v_event.provider_event_id)
        );
      elsif v_protection.protection_state<>'protected' then
        raise exception 'Existing Payment Protection is not awaiting funds';
      end if;
    end loop;

    update public.verified_provider_events
    set processing_status='processed',processed_at=now(),processing_error=null
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object(
      'success',true,'provider_event_id',v_event.provider_event_id,
      'ledger_transaction_id',v_ledger_transaction_id,
      'lifecycle_result',v_result
    );
  exception when others then
    get stacked diagnostics v_error=message_text;
    update public.verified_provider_events
    set processing_status='failed',processed_at=now(),
        processing_error=left(v_error,500)
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Verified payment requires retry or Finance review');
  end;
end
$function$;
revoke all on function public.process_verified_paystack_charge(p_provider_event_key text, p_event_type text, p_provider_reference text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text, p_transaction_id text) from public, anon, authenticated, service_role;

grant execute on function public.process_verified_paystack_charge(p_provider_event_key text, p_event_type text, p_provider_reference text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text, p_transaction_id text) to service_role;

CREATE OR REPLACE FUNCTION public.process_verified_paystack_refund_event(p_provider_event_key text, p_event_type text, p_original_reference text, p_refund_reference text, p_provider_refund_id text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_event public.verified_provider_events;
  v_action public.financial_action_outbox;
  v_protection public.payment_protection_transactions;
  v_amount numeric(12,2);
  v_match_count integer;
  v_ledger uuid;
  v_new_released numeric(12,2);
  v_new_refunded numeric(12,2);
  v_to_state text;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  if p_event_type not in(
    'refund.pending','refund.processing','refund.needs-attention',
    'refund.failed','refund.processed'
  ) or nullif(btrim(p_provider_event_key),'') is null
    or nullif(btrim(p_original_reference),'') is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_amount_minor<=0 or upper(p_currency)<>'NGN' then
    raise exception 'Invalid verified Paystack refund event'; end if;
  v_amount:=round(p_amount_minor::numeric/100,2);
  insert into public.verified_provider_events(
    provider,provider_event_key,event_type,provider_reference,payload_sha256,
    signature_verified_at,processing_status
  ) values(
    'paystack',p_provider_event_key,p_event_type,
    coalesce(nullif(btrim(p_refund_reference),''),p_provider_event_key),
    lower(p_payload_sha256),p_signature_verified_at,'received'
  ) on conflict do nothing;
  select * into v_event from public.verified_provider_events
  where provider='paystack' and provider_event_key=p_provider_event_key for update;
  if v_event.provider_event_id is null then raise exception 'Refund event was not registered'; end if;
  if v_event.payload_sha256<>lower(p_payload_sha256) then
    raise exception 'Refund event replay checksum mismatch'; end if;
  if v_event.processing_status='processed' then
    return jsonb_build_object('success',true,'already_processed',true); end if;

  select count(*) into v_match_count
  from public.financial_action_outbox a
  join public.payment_protection_transactions p on p.id=a.payment_protection_id
  where a.action_type like 'refund_%'
    and a.status in('provider_pending','provider_attention')
    and p.paystack_reference=p_original_reference
    and a.amount=v_amount
    and (nullif(btrim(p_provider_refund_id),'') is null
      or a.provider_action_id is null
      or a.provider_action_id=p_provider_refund_id);
  if v_match_count=0 then
    update public.verified_provider_events set processing_status='ignored',
      processed_at=now(),processing_error='No matching pending refund action'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',true,'ignored',true);
  end if;
  if v_match_count<>1 then
    update public.verified_provider_events set processing_status='failed',
      processed_at=now(),processing_error='Refund event matched multiple actions'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Refund matching requires Finance review');
  end if;
  select a.* into v_action
  from public.financial_action_outbox a
  join public.payment_protection_transactions p on p.id=a.payment_protection_id
  where a.action_type like 'refund_%'
    and a.status in('provider_pending','provider_attention')
    and p.paystack_reference=p_original_reference and a.amount=v_amount
    and (nullif(btrim(p_provider_refund_id),'') is null
      or a.provider_action_id is null or a.provider_action_id=p_provider_refund_id)
  for update of a;
  update public.financial_action_outbox set
    provider_action_id=coalesce(provider_action_id,nullif(btrim(p_provider_refund_id),'')),
    provider_status=replace(p_event_type,'refund.',''),updated_at=now()
  where financial_action_id=v_action.financial_action_id;

  if p_event_type='refund.needs-attention' then
    update public.financial_action_outbox set status='provider_attention'
    where financial_action_id=v_action.financial_action_id;
  elsif p_event_type='refund.failed' then
    update public.financial_action_outbox set status='manual_review',
      last_error='Paystack reported that the refund failed',updated_at=now()
    where financial_action_id=v_action.financial_action_id;
  elsif p_event_type='refund.processed' then
    select * into v_protection from public.payment_protection_transactions
    where id=v_action.payment_protection_id for update;
    if v_action.amount>
        v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount then
      raise exception 'Refund exceeds the protected balance'; end if;
    v_ledger:=public.post_ledger_transaction(
      'paystack-refund:'||p_provider_event_key,'provider_refund','NGN',
      v_action.subject_type,v_action.subject_id,v_event.provider_event_id,
      jsonb_build_object(
        'financial_action_id',v_action.financial_action_id,
        'original_reference',p_original_reference,
        'refund_reference',p_refund_reference
      ),jsonb_build_array(
        jsonb_build_object(
          'account_key','liability:payment_protection:'||v_protection.id::text,
          'account_class','liability','owner_type',v_protection.subject_type,
          'owner_id',v_protection.subject_id,'amount',v_action.amount,
          'memo','Original-payment refund'
        ),
        jsonb_build_object(
          'account_key','asset:paystack_clearing:NGN','account_class','asset',
          'amount',-v_action.amount,'memo','Paystack processed refund'
        )
      )
    );
    update public.payment_protection_transactions set
      refunded_amount=refunded_amount+v_action.amount,
      refund_ledger_transaction_id=v_ledger,updated_at=now()
    where id=v_protection.id
    returning released_amount,refunded_amount into v_new_released,v_new_refunded;
    v_to_state:=case
      when v_new_refunded=v_protection.amount_total then 'refunded'
      else 'partially_released' end;
    perform public.transition_payment_protection(
      v_protection.id,v_to_state,'provider_refund_processed',
      'provider-refund-processed:'||p_provider_event_key,
      null,'paystack',null,v_ledger,
      jsonb_build_object('financial_action_id',v_action.financial_action_id)
    );
    update public.financial_action_outbox set status='completed',processed_at=now(),
      last_error=null,updated_at=now()
    where financial_action_id=v_action.financial_action_id;
  end if;
  update public.verified_provider_events set processing_status='processed',
    processed_at=now(),processing_error=null
  where provider_event_id=v_event.provider_event_id;
  return jsonb_build_object('success',true,'financial_action_id',v_action.financial_action_id);
end
$function$;
revoke all on function public.process_verified_paystack_refund_event(p_provider_event_key text, p_event_type text, p_original_reference text, p_refund_reference text, p_provider_refund_id text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text) from public, anon, authenticated, service_role;

grant execute on function public.process_verified_paystack_refund_event(p_provider_event_key text, p_event_type text, p_original_reference text, p_refund_reference text, p_provider_refund_id text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text) to service_role;

CREATE OR REPLACE FUNCTION public.property_host_conversation_access(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists(
    select 1
    from public.property_host_conversations c
    join public.reservations r on r.id=c.reservation_id
    left join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
    where c.conversation_id=p_conversation_id
      and (
        c.guest_user_id=public.current_profile_user_id()
        or (
          c.host_user_id=public.current_profile_user_id()
          and r.management_mode_snapshot='host'
          and r.responsible_host_user_id=c.host_user_id
          and exists(
            select 1
            from public.property_host_assignments a
            join public.profiles p on p.user_id=a.user_id
            where a.listing_id=l.id
              and a.user_id=c.host_user_id
              and a.status='active'
              and not coalesce(p.deleted,false)
              and not coalesce(p.suspended,false)
              and not coalesce(p.banned,false)
          )
        )
      )
  )
$function$;
revoke all on function public.property_host_conversation_access(p_conversation_id uuid) from public, anon, authenticated, service_role;

grant execute on function public.property_host_conversation_access(p_conversation_id uuid) to service_role;
grant execute on function public.property_host_conversation_access(p_conversation_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if p_check_in is null or p_check_out is null or p_check_in <= current_date or p_check_out <= p_check_in then
    raise exception 'Choose valid future check-in and check-out dates';
  end if;
  if not exists (
    select 1 from public.hotels h
    join public.hotel_rooms r on r.hotel_id=h.hotel_id
    join public.hotel_rate_plans rp on rp.room_id=r.room_id and rp.hotel_id=h.hotel_id
    where h.hotel_id=p_hotel_id and r.room_id=p_room_id and rp.rate_plan_id=p_rate_plan_id
      and rp.active and h.status='active' and h.approved_at is not null and h.published_at is not null
  ) then raise exception 'Hotel room package is not available'; end if;
  return private.hotel_booking_quote_v2(p_room_id,p_rate_plan_id,p_check_in,p_check_out,null,true);
end;
$function$;
revoke all on function public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date) from public, anon, authenticated, service_role;

grant execute on function public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date) to service_role;
grant execute on function public.quote_hotel_room_rate(p_hotel_id integer, p_room_id integer, p_rate_plan_id integer, p_check_in date, p_check_out date) to authenticated;

CREATE OR REPLACE FUNCTION public.record_partner_pro_renewal(p_reference text, p_transaction_id text, p_amount_minor bigint, p_environment text, p_subscription_code text, p_customer_code text, p_plan_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_subscription public.partner_pro_subscriptions; v_payment public.booking_payments; v_end timestamptz; v_review timestamptz;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
 if p_environment not in ('test','live') or length(coalesce(p_reference,''))<5 or length(coalesce(p_transaction_id,''))<1 then raise exception 'Invalid renewal receipt'; end if;
 select * into v_subscription from public.partner_pro_subscriptions where subscription_code=p_subscription_code for update;
 if v_subscription.partner_id is null then return jsonb_build_object('handled',false); end if;
 if v_subscription.environment<>p_environment or v_subscription.plan_code<>p_plan_code or v_subscription.customer_code is distinct from p_customer_code
   or round(v_subscription.price_ngn*100)<>p_amount_minor then raise exception 'Subscription renewal mismatch'; end if;
 select * into v_payment from public.booking_payments where paystack_reference=p_reference or paystack_transaction_id=p_transaction_id for update;
 if v_payment.id is not null then
   if v_payment.purpose<>'partner_pro_access' or v_payment.paystack_reference<>p_reference or v_payment.paystack_transaction_id is distinct from p_transaction_id then raise exception 'Renewal replay conflict'; end if;
   return jsonb_build_object('handled',true,'already_processed',true);
 end if;
 insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,type,booking_type,amount,amount_total,net_amount,
   amount_commission,currency,status,purpose,payment_method,paystack_transaction_id,verified_amount,verified_at,verification_source,paid_at,webhook_processed,metadata)
 values(p_reference,p_reference,v_subscription.partner_id,v_subscription.partner_id,'partner_pro_access','partner_pro_access',
   v_subscription.price_ngn,v_subscription.price_ngn,v_subscription.price_ngn,0,'NGN',
   case when v_subscription.auto_renews then 'paid' else 'review_required' end,'partner_pro_access','paystack',p_transaction_id,
   v_subscription.price_ngn,now(),'webhook',now(),true,
   jsonb_build_object('billing_period',v_subscription.billing_period,'auto_renew',true,'plan_code',p_plan_code,
     'paystack_environment',p_environment,'paystack_subscription_code',p_subscription_code,'paystack_customer_code',p_customer_code)) returning * into v_payment;
 select current_period_end,review_started_at into v_end,v_review from public.partner_pro_entitlements where partner_id=v_subscription.partner_id for update;
 if not v_subscription.auto_renews or v_review is not null then
   update public.booking_payments set status='review_required' where id=v_payment.id;
   return jsonb_build_object('handled',true,'requires_review',true);
 end if;
 v_end:=greatest(coalesce(v_end,now()),now())+case when v_subscription.billing_period='yearly' then interval '1 year' else interval '1 month' end;
 update public.partner_pro_entitlements set current_period_end=v_end,last_payment_id=v_payment.id,updated_at=now() where partner_id=v_subscription.partner_id;
 return jsonb_build_object('handled',true,'success',true,'current_period_end',v_end);
end $function$;
revoke all on function public.record_partner_pro_renewal(p_reference text, p_transaction_id text, p_amount_minor bigint, p_environment text, p_subscription_code text, p_customer_code text, p_plan_code text) from public, anon, authenticated, service_role;

grant execute on function public.record_partner_pro_renewal(p_reference text, p_transaction_id text, p_amount_minor bigint, p_environment text, p_subscription_code text, p_customer_code text, p_plan_code text) to service_role;

CREATE OR REPLACE FUNCTION public.record_partner_pro_subscription_event(p_subscription_code text, p_customer_code text, p_plan_code text, p_environment text, p_event_type text, p_event_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_subscription public.partner_pro_subscriptions;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
 if p_event_type not in ('subscription.create','subscription.not_renew','subscription.disable') or p_environment not in ('test','live')
   or p_subscription_code !~ '^SUB_[A-Za-z0-9]+$' or p_event_time is null or p_event_time>now()+interval '1 day' then
   raise exception 'Invalid subscription event'; end if;
 select * into v_subscription from public.partner_pro_subscriptions where subscription_code=p_subscription_code for update;
 if v_subscription.partner_id is null and p_event_type='subscription.create' then
   select * into v_subscription from public.partner_pro_subscriptions
   where customer_code=p_customer_code and plan_code=p_plan_code and environment=p_environment and auto_renews for update;
 end if;
 if v_subscription.partner_id is null then return false; end if;
 if v_subscription.environment<>p_environment or (p_plan_code<>'' and v_subscription.plan_code<>p_plan_code)
   or (p_customer_code<>'' and v_subscription.customer_code is distinct from p_customer_code) then raise exception 'Subscription identity mismatch'; end if;
 if v_subscription.provider_event_at is not null and p_event_time<=v_subscription.provider_event_at then return true; end if;
 update public.partner_pro_subscriptions set subscription_code=p_subscription_code,
   auto_renews=p_event_type='subscription.create',provider_event_at=p_event_time,updated_at=now()
   where partner_id=v_subscription.partner_id;
 return true;
end $function$;
revoke all on function public.record_partner_pro_subscription_event(p_subscription_code text, p_customer_code text, p_plan_code text, p_environment text, p_event_type text, p_event_time timestamp with time zone) from public, anon, authenticated, service_role;

grant execute on function public.record_partner_pro_subscription_event(p_subscription_code text, p_customer_code text, p_plan_code text, p_environment text, p_event_type text, p_event_time timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_my_roommate_search()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor public.profiles;
 prefs public.roommate_preferences;
 total integer;
begin
 select * into actor
 from public.profiles
 where auth_id=(select auth.uid())::text
 limit 1;

 if actor.user_id is null
    or not public.current_actor_has_personal_workspace()
    or coalesce(actor.deleted,false)
    or coalesce(actor.suspended,false)
    or coalesce(actor.banned,false)
 then raise exception 'Active Personal account required'; end if;

 select * into prefs
 from public.roommate_preferences
 where user_id=actor.user_id
 for update;

 if coalesce(prefs.practical_preferences_version,0)<>2
 then raise exception 'Confirm your moving plans before finding new matches'; end if;

 if not coalesce(prefs.active,false)
    or prefs.search_status<>'active'
    or not coalesce(actor.privacy_search_visible,true)
    or not coalesce(actor.privacy_profile_visible,true)
 then raise exception 'Roommate matching is paused'; end if;

 delete from public.roommate_search_results
 where searcher_id=actor.user_id
   and status in('new','viewed');

 /*
  * Hard-filter first. The expensive compatibility function is deliberately
  * isolated behind a bounded candidate window. The final 120 rows therefore
  * no longer sit on top of an unbounded candidate scan.
  */
 with hard_candidates as materialized (
   select
     peer.user_id
   from public.profiles peer
   join public.roommate_preferences pp
     on pp.user_id=peer.user_id
   where peer.user_id<>actor.user_id
     and peer.account_kind='consumer'
     and not coalesce(peer.deleted,false)
     and not coalesce(peer.suspended,false)
     and not coalesce(peer.banned,false)
     and coalesce(peer.profile_complete,false)
     and coalesce(peer.privacy_search_visible,true)
     and coalesce(peer.privacy_profile_visible,true)
     and pp.active
     and pp.search_status='active'
     and pp.practical_preferences_version=2

     and public._roommate_normalize(pp.preferred_state)
         = public._roommate_normalize(prefs.preferred_state)
     and public._roommate_normalize(pp.preferred_lga)
         = public._roommate_normalize(prefs.preferred_lga)

     and pp.budget_max >= prefs.budget_min
     and prefs.budget_max >= pp.budget_min

     and (prefs.gender_preference='no_preference' or prefs.gender_preference=lower(peer.gender))
     and (pp.gender_preference='no_preference' or pp.gender_preference=lower(actor.gender))

     and (
       not coalesce(prefs.school_match,false)
       and not coalesce(pp.school_match,false)
       or (
         public._roommate_normalize(coalesce(prefs.school_name,actor.school))
           = public._roommate_normalize(coalesce(pp.school_name,peer.school))
         and public._roommate_normalize(coalesce(prefs.school_name,actor.school)) is not null
       )
     )

     and (
       prefs.room_arrangement='either'
       or pp.room_arrangement='either'
       or prefs.room_arrangement=pp.room_arrangement
     )

     and (
       public._roommate_normalize(prefs.preferred_area) is null
       or public._roommate_normalize(pp.preferred_area) is null
       or public._roommate_normalize(prefs.preferred_area)
          = public._roommate_normalize(pp.preferred_area)
     )

     and (
       prefs.move_in_mode='flexible'
       or pp.move_in_mode='flexible'
       or greatest(
            case when prefs.move_in_mode='asap'
                 then (now() at time zone 'Africa/Lagos')::date
                 else prefs.move_in_from end,
            case when pp.move_in_mode='asap'
                 then (now() at time zone 'Africa/Lagos')::date
                 else pp.move_in_from end,
            (now() at time zone 'Africa/Lagos')::date
          )
          <= least(
            case when prefs.move_in_mode='asap'
                 then (now() at time zone 'Africa/Lagos')::date + 30
                 when prefs.move_in_mode='date' then prefs.move_in_from
                 else prefs.move_in_to end,
            case when pp.move_in_mode='asap'
                 then (now() at time zone 'Africa/Lagos')::date + 30
                 when pp.move_in_mode='date' then pp.move_in_from
                 else pp.move_in_to end
          )
     )

     and not (
       prefs.smoking_preference='no' and pp.smoking_habit<>'never'
       or pp.smoking_preference='no' and prefs.smoking_habit<>'never'
       or prefs.smoking_preference='outdoors' and pp.smoking_habit='smokes'
       or pp.smoking_preference='outdoors' and prefs.smoking_habit='smokes'
     )

     and not exists (
       select 1
       from public.roommate_user_blocks b
       where (b.blocker_user_id=actor.user_id and b.blocked_user_id=peer.user_id)
          or (b.blocker_user_id=peer.user_id and b.blocked_user_id=actor.user_id)
     )

     and not exists (
       select 1
       from public.roommate_search_results r
       where r.searcher_id=actor.user_id
         and r.matched_user_id=peer.user_id
         and r.status in('accepted','declined')
     )

     and not exists (
       select 1
       from public.conversations c
       where c.conversation_type='roommate'
         and c.status in('active','accepted')
         and (
           (c.participant_a=actor.user_id and c.participant_b=peer.user_id)
           or
           (c.participant_b=actor.user_id and c.participant_a=peer.user_id)
         )
     )
   order by peer.user_id
   limit 1000
 ),
 scored as materialized (
   select
     hc.user_id,
     coalesce(
       (public._roommate_practical_pair(actor.user_id,hc.user_id)->>'score')::integer,
       0
     ) as score
   from hard_candidates hc
 )
 insert into public.roommate_search_results(searcher_id,matched_user_id,match_score,status)
 select actor.user_id,user_id,score,'new'
 from scored
 order by score desc,user_id
 limit 120
 on conflict(searcher_id,matched_user_id) do nothing;

 get diagnostics total=row_count;

 update public.roommate_preferences
 set search_match_count=total,
     search_expires_at=null,
     updated_at=now()
 where user_id=actor.user_id;

 return total;
end $function$;
revoke all on function public.refresh_my_roommate_search() from public, anon, authenticated, service_role;

grant execute on function public.refresh_my_roommate_search() to service_role;
grant execute on function public.refresh_my_roommate_search() to authenticated;

CREATE OR REPLACE FUNCTION public.request_accommodation_no_show_review(p_subject_type text, p_subject_id text, p_property_ready_evidence text[], p_explanation text)
 RETURNS accommodation_no_show_reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_profile public.profiles;
  v_res public.reservations; v_listing public.listings;
  v_booking public.hotel_bookings; v_hotel public.hotels;
  v_deadline timestamptz; v_policy public.creator_policy_versions;
  v_result public.accommodation_no_show_reviews;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_subject_type not in('short_let','hotel') then raise exception 'Unsupported stay type'; end if;
  if cardinality(coalesce(p_property_ready_evidence,array[]::text[])) not between 1 and 8
     or char_length(btrim(coalesce(p_explanation,''))) not between 10 and 2000 then
    raise exception 'Property-ready evidence and an explanation are required';
  end if;
  select * into v_profile from public.profiles where user_id=v_actor;
  if p_subject_type='short_let' then
    select * into v_res from public.reservations
    where id=p_subject_id and stay_type='short_let' for update;
    if v_res.id is null or v_res.short_stay_rate_type<>'non_refundable'
       or v_res.status<>'ready_for_move_in' or v_res.rent_payment_status<>'paid'
       or v_res.checked_in_at is not null then
      raise exception 'This Short Let is not eligible for non-refundable no-show review';
    end if;
    select * into v_listing from public.listings
    where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
    if v_res.requested_move_in_at is null then
      raise exception 'The agreed arrival time must be recorded first';
    end if;
    v_deadline:=v_res.requested_move_in_at
      +make_interval(hours=>greatest(coalesce(v_res.arrival_issue_window_hours,2),1));
    if not(
      (v_res.management_mode_snapshot='host'
        and v_res.responsible_host_user_id=v_actor
        and public.current_actor_can_manage_property(v_listing.id))
      or (v_profile.role in('creator','admin','staff')
        and (v_profile.role<>'staff' or public.current_staff_has_permission('operations'))
        and (v_profile.role='creator' or public.current_actor_in_scope(v_listing.state,v_listing.city)))
    ) then raise exception 'Responsible stay operator access required'; end if;
    select * into v_policy from public.creator_policy_versions
    where policy_version_id=v_res.short_stay_rate_terms_policy_version_id
      and policy_key='accommodation_non_refundable_rate';
  else
    select * into v_booking from public.hotel_bookings
    where booking_id::text=p_subject_id for update;
    if v_booking.booking_id is null or v_booking.payment_status<>'paid'
       or v_booking.status<>'confirmed' or v_booking.checked_in_at is not null
       or coalesce(v_booking.rate_plan_snapshot->>'cancellation_template',
         case when coalesce((v_booking.rate_plan_snapshot->>'refundable')::boolean,false)
           then 'standard_legacy' else 'non_refundable' end)<>'non_refundable' then
      raise exception 'This hotel stay is not eligible for non-refundable no-show review';
    end if;
    select * into v_hotel from public.hotels where hotel_id=v_booking.hotel_id;
    v_deadline:=((v_booking.check_in::text||' '||v_hotel.check_in_time::text)::timestamp
      at time zone v_hotel.timezone)
      +make_interval(hours=>greatest(coalesce(v_booking.arrival_issue_window_hours,2),1));
    if not public.hotel_actor_has_capability(v_booking.hotel_id,'stay.check_in')
       and not(v_profile.role in('creator','admin','staff')
         and (v_profile.role<>'staff' or public.current_staff_has_permission('operations'))
         and (v_profile.role='creator' or public.current_actor_in_scope(v_hotel.state,v_hotel.city))) then
      raise exception 'Hotel arrival access required';
    end if;
    select * into v_policy from public.creator_policy_versions
    where policy_version_id=v_booking.cancellation_policy_version_id
      and policy_key='accommodation_non_refundable_rate';
  end if;
  if v_policy.policy_version_id is null then raise exception 'Booked no-show terms are unavailable'; end if;
  if now()<v_deadline then raise exception 'The arrival window is still open'; end if;
  insert into public.accommodation_no_show_reviews(
    subject_type,subject_id,requested_by,property_ready_evidence,explanation,
    arrival_deadline_at,rate_terms_policy_version_id
  ) values(
    p_subject_type,p_subject_id,v_actor,p_property_ready_evidence,btrim(p_explanation),
    v_deadline,v_policy.policy_version_id
  ) returning * into v_result;
  return v_result;
end
$function$;
revoke all on function public.request_accommodation_no_show_review(p_subject_type text, p_subject_id text, p_property_ready_evidence text[], p_explanation text) from public, anon, authenticated, service_role;

grant execute on function public.request_accommodation_no_show_review(p_subject_type text, p_subject_id text, p_property_ready_evidence text[], p_explanation text) to service_role;
grant execute on function public.request_accommodation_no_show_review(p_subject_type text, p_subject_id text, p_property_ready_evidence text[], p_explanation text) to authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_property_host_invite(p_assignment_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_assignment public.property_host_assignments;
  v_invitation_id uuid;
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;

  select invitation_id into v_invitation_id
  from public.resource_invitations
  where resource_type='property'
    and subject_assignment_id=p_assignment_id
    and intended_user_id=v_actor
    and status='pending'
  order by created_at desc
  limit 1;

  if v_invitation_id is not null then
    return public.respond_to_resource_invitation(v_invitation_id,p_accept,null);
  end if;

  update public.property_host_assignments
  set status=case when p_accept then 'active' else 'declined' end,
      accepted_at=case when p_accept then now() else null end,
      revoked_at=case when p_accept then null else now() end,
      updated_at=now()
  where assignment_id=p_assignment_id and user_id=v_actor and status='invited'
  returning * into v_assignment;

  if v_assignment.assignment_id is null then raise exception 'Active invitation not found'; end if;
  return jsonb_build_object('success',true,'status',v_assignment.status,'listing_id',v_assignment.listing_id);
end
$function$;
revoke all on function public.respond_to_property_host_invite(p_assignment_id uuid, p_accept boolean) from public, anon, authenticated, service_role;

grant execute on function public.respond_to_property_host_invite(p_assignment_id uuid, p_accept boolean) to service_role;
grant execute on function public.respond_to_property_host_invite(p_assignment_id uuid, p_accept boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.review_property_change_request(p_change_request_id uuid, p_decision text, p_reason text, p_reinspection_reference text DEFAULT NULL::text)
 RETURNS property_change_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_request public.property_change_requests;
  v_listing public.listings;
  v_images text[];
begin
  if p_decision not in ('approve','changes_requested','reject')
     or char_length(btrim(coalesce(p_reason,'')))<5 then
    raise exception 'Choose a valid decision and record the reason';
  end if;
  select * into v_request from public.property_change_requests
  where change_request_id=p_change_request_id for update;
  if v_request.change_request_id is null
     or v_request.status not in ('submitted','changes_requested','awaiting_reinspection') then
    raise exception 'Open property change request not found';
  end if;
  select * into v_listing from public.listings
  where id=v_request.listing_id and deleted_at is null for update;
  if not (
    public.current_actor_has_workspace('creator',null)
    or (public.current_actor_has_workspace('admin',v_listing.state)
      and public.current_actor_in_scope(v_listing.state,v_listing.city))
    or (public.current_actor_has_workspace('staff',null)
      and public.current_staff_has_permission('operations')
      and public.current_actor_in_scope(v_listing.state,v_listing.city))
  ) then raise exception 'Property Operations authority required'; end if;

  if p_decision='changes_requested' then
    update public.property_change_requests set status='changes_requested',
      reviewed_by=v_actor,reviewed_at=now(),decision_reason=btrim(p_reason),updated_at=now()
    where change_request_id=p_change_request_id returning * into v_request;
  elsif p_decision='reject' then
    update public.property_change_requests set status='rejected',
      reviewed_by=v_actor,reviewed_at=now(),decision_reason=btrim(p_reason),updated_at=now()
    where change_request_id=p_change_request_id returning * into v_request;
  elsif v_request.requires_reinspection
        and char_length(btrim(coalesce(p_reinspection_reference,'')))<3 then
    update public.property_change_requests set status='awaiting_reinspection',
      reviewed_by=v_actor,reviewed_at=now(),decision_reason=btrim(p_reason),updated_at=now()
    where change_request_id=p_change_request_id returning * into v_request;
  else
    if v_request.change_type='price' then
      update public.listings set price=(v_request.proposed_changes->>'price')::numeric,updated_at=now()
      where id=v_listing.id;
    elsif v_request.change_type='photos' then
      select array_agg(value order by ordinality) into v_images
      from jsonb_array_elements_text(v_request.proposed_changes->'images') with ordinality;
      update public.listings set images=v_images,updated_at=now() where id=v_listing.id;
    else
      if v_request.proposed_changes ? 'images' then
        select array_agg(value order by ordinality) into v_images
        from jsonb_array_elements_text(v_request.proposed_changes->'images') with ordinality;
      end if;
      update public.listings set
        description=coalesce(nullif(btrim(v_request.proposed_changes->>'description'),''),description),
        images=coalesce(v_images,images),updated_at=now()
      where id=v_listing.id;
    end if;
    select * into v_listing from public.listings where id=v_listing.id;
    update public.property_change_requests set status='published',
      reviewed_by=v_actor,reviewed_at=now(),decision_reason=btrim(p_reason),
      reinspection_reference=nullif(btrim(coalesce(p_reinspection_reference,'')),''),
      after_snapshot=jsonb_build_object(
        'price',v_listing.price,'description',v_listing.description,
        'images',to_jsonb(v_listing.images),'bedrooms',v_listing.bedrooms,
        'bathrooms',v_listing.bathrooms,'amenities',to_jsonb(v_listing.amenities)
      ),published_at=now(),updated_at=now()
    where change_request_id=p_change_request_id returning * into v_request;
  end if;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'review_property_change_request','property_change_request',
    p_change_request_id::text,jsonb_build_object(
      'decision',p_decision,'resulting_status',v_request.status,
      'listing_id',v_request.listing_id,'reason',btrim(p_reason),
      'reinspection_reference',nullif(btrim(coalesce(p_reinspection_reference,'')),'')
    )::text,now());
  return v_request;
end
$function$;
revoke all on function public.review_property_change_request(p_change_request_id uuid, p_decision text, p_reason text, p_reinspection_reference text) from public, anon, authenticated, service_role;

grant execute on function public.review_property_change_request(p_change_request_id uuid, p_decision text, p_reason text, p_reinspection_reference text) to service_role;
grant execute on function public.review_property_change_request(p_change_request_id uuid, p_decision text, p_reason text, p_reinspection_reference text) to authenticated;

CREATE OR REPLACE FUNCTION public.review_wehouse_property_management(p_listing_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if not (
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null)
    or (public.current_actor_has_workspace('staff',null) and public.current_staff_has_permission('operations'))
  ) then
    raise exception 'Property Operations authority required';
  end if;

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null
  for update;

  if v_listing.id is null
     or v_listing.management_updated_at is null
     or v_listing.management_mode<>'wehouse'
     or v_listing.wehouse_management_status<>'requested' then
    raise exception 'WeHouse management was not requested for this property';
  end if;

  if v_listing.approved_at is null
     or v_listing.status not in ('available','unavailable','reserved','occupied','maintenance','closed') then
    raise exception 'Property management starts after publication';
  end if;

  if not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Property is outside your authority';
  end if;

  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set wehouse_management_status=case when p_approve then 'approved' else 'declined' end,
      management_updated_at=now(),
      updated_at=now()
  where id=p_listing_id
  returning * into v_listing;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'wehouse_property_management_review','listing',p_listing_id::text,
    jsonb_build_object(
      'approved',p_approve,
      'reason',nullif(btrim(coalesce(p_reason,'')),'')
    )::text,now());

  return jsonb_build_object(
    'success',true,
    'management_mode',v_listing.management_mode,
    'wehouse_management_status',v_listing.wehouse_management_status
  );
end
$function$;
revoke all on function public.review_wehouse_property_management(p_listing_id uuid, p_approve boolean, p_reason text) from public, anon, authenticated, service_role;

grant execute on function public.review_wehouse_property_management(p_listing_id uuid, p_approve boolean, p_reason text) to service_role;
grant execute on function public.review_wehouse_property_management(p_listing_id uuid, p_approve boolean, p_reason text) to authenticated;

CREATE OR REPLACE FUNCTION public.revoke_property_host_manager(p_assignment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_assignment public.property_host_assignments;
  v_listing public.listings;
  v_transfer_count integer:=0;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_assignment
  from public.property_host_assignments
  where assignment_id=p_assignment_id
  for update;

  if v_assignment.assignment_id is null
     or v_assignment.assignment_role<>'manager'
     or v_assignment.status not in ('active','invited') then
    raise exception 'Active manager assignment not found';
  end if;

  if not exists(
    select 1
    from public.property_host_assignments owner_assignment
    where owner_assignment.listing_id=v_assignment.listing_id
      and owner_assignment.user_id=v_actor
      and owner_assignment.assignment_role='owner'
      and owner_assignment.status='active'
  ) or not public.user_has_active_workspace(v_actor,'property_partner') then
    raise exception 'Only the active property owner can remove a manager';
  end if;

  select * into v_listing
  from public.listings
  where id=v_assignment.listing_id and deleted_at is null
  for update;
  if v_listing.id is null then raise exception 'Property not found'; end if;

  update public.reservations r
  set responsible_host_user_id=v_actor,
      updated_at=now()
  where (r.listing_id=v_listing.id::text or r.listing_id=v_listing.listing_id)
    and r.management_mode_snapshot='host'
    and r.responsible_host_user_id=v_assignment.user_id
    and r.status not in ('completed','cancelled','refunded','expired');
  get diagnostics v_transfer_count = row_count;

  update public.property_host_conversations c
  set host_user_id=v_actor,
      updated_at=now()
  where c.host_user_id=v_assignment.user_id
    and exists(
      select 1
      from public.reservations r
      where r.id=c.reservation_id
        and (r.listing_id=v_listing.id::text or r.listing_id=v_listing.listing_id)
        and r.management_mode_snapshot='host'
        and r.responsible_host_user_id=v_actor
        and r.status not in ('completed','cancelled','refunded','expired')
    );

  if v_listing.management_mode='host'
     and v_listing.management_host_user_id=v_assignment.user_id then
    perform set_config('wehouse.management_rpc','allowed',true);
    update public.listings
    set management_host_user_id=v_actor,
        management_updated_at=now(),
        updated_at=now()
    where id=v_listing.id;
  end if;

  update public.property_host_assignments
  set status='revoked',
      revoked_at=now(),
      updated_at=now()
  where assignment_id=v_assignment.assignment_id
    and assignment_role='manager';

  if not found then return false; end if;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor,'property_host_manager_revoked','listing',v_listing.id::text,
    jsonb_build_object(
      'removed_user_id',v_assignment.user_id,
      'active_reservations_transferred_to_owner',v_transfer_count,
      'new_responsible_host_user_id',v_actor
    )::text,now()
  );

  return true;
end
$function$;
revoke all on function public.revoke_property_host_manager(p_assignment_id uuid) from public, anon, authenticated, service_role;

grant execute on function public.revoke_property_host_manager(p_assignment_id uuid) to service_role;
grant execute on function public.revoke_property_host_manager(p_assignment_id uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.save_my_worker_pro_customer_note(p_customer_id text, p_note text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.worker_pro_current_actor();
begin
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
end $function$;
revoke all on function public.save_my_worker_pro_customer_note(p_customer_id text, p_note text) from public, anon, authenticated, service_role;

grant execute on function public.save_my_worker_pro_customer_note(p_customer_id text, p_note text) to service_role;
grant execute on function public.save_my_worker_pro_customer_note(p_customer_id text, p_note text) to authenticated;

CREATE OR REPLACE FUNCTION public.search_discoverable_hotels(p_query text DEFAULT NULL::text, p_state text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_amenities text[] DEFAULT NULL::text[], p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_radius_km numeric DEFAULT NULL::numeric, p_cursor_featured boolean DEFAULT NULL::boolean, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id integer DEFAULT NULL::integer, p_limit integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with picked as materialized (
    select h.* from public.hotels h
    where h.status = 'active' and h.approved_at is not null and h.published_at is not null
      and (nullif(btrim(p_state),'') is null or lower(h.state) = lower(btrim(p_state)))
      and (nullif(btrim(p_city),'') is null or lower(h.city) = lower(btrim(p_city)))
      and (nullif(btrim(p_query),'') is null or
        strpos(lower(h.name),lower(left(btrim(p_query),80))) > 0)
      and (coalesce(cardinality(p_amenities),0) = 0 or h.amenities @> p_amenities)
      and (p_radius_km is null or (p_radius_km between 0 and 20
        and p_lat between -90 and 90 and p_lng between -180 and 180
        and h.gps_latitude between p_lat - p_radius_km/111.2 and p_lat + p_radius_km/111.2
        and h.gps_longitude between p_lng - p_radius_km/111.2/greatest(0.01,abs(cos(radians(p_lat))))
          and p_lng + p_radius_km/111.2/greatest(0.01,abs(cos(radians(p_lat))))
        and 6371.0*2*asin(least(1.0,sqrt(
          power(sin(radians(h.gps_latitude::double precision-p_lat)/2),2)
          +cos(radians(p_lat))*cos(radians(h.gps_latitude::double precision))
           *power(sin(radians(h.gps_longitude::double precision-p_lng)/2),2)
        ))) <= p_radius_km))
      and ((p_min_price is null and p_max_price is null) or exists (
        select 1 from public.hotel_rooms r where r.hotel_id = h.hotel_id
          and (p_min_price is null or coalesce((
            select min(plan.price_per_night) from public.hotel_rate_plans plan
            where plan.room_id = r.room_id and plan.active
          ),r.price_per_night) >= p_min_price)
          and (p_max_price is null or coalesce((
            select min(plan.price_per_night) from public.hotel_rate_plans plan
            where plan.room_id = r.room_id and plan.active
          ),r.price_per_night) <= p_max_price)
      ))
      and (p_cursor_featured is null or p_cursor_created_at is null or p_cursor_id is null
        or (h.featured,h.created_at,h.hotel_id) < (p_cursor_featured,p_cursor_created_at,p_cursor_id))
    order by h.featured desc,h.created_at desc,h.hotel_id desc
    limit least(greatest(coalesce(p_limit,24),1),48)+1
  ), page as materialized (
    select * from picked order by featured desc,created_at desc,hotel_id desc
    limit least(greatest(coalesce(p_limit,24),1),48)
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'hotel_id',h.hotel_id,'name',h.name,'description',h.description,
      'state',h.state,'city',h.city,'area',h.area,'address',h.address,
      'images',coalesce(h.images,array[]::text[]),
      'amenities',coalesce(h.amenities,array[]::text[]),
      'status',h.status,'rating',h.rating,'review_count',h.review_count,
      'featured',h.featured,'created_at',h.created_at,
      'gps_latitude',null,'gps_longitude',null,'location_exact',false,
      'check_in_time',h.check_in_time,'check_out_time',h.check_out_time,'timezone',h.timezone,
      'hotel_rooms',coalesce((select jsonb_agg(jsonb_build_object(
        'room_id',room.room_id,'room_type',room.room_type,
        'price_per_night',coalesce((select min(plan.price_per_night)
          from public.hotel_rate_plans plan where plan.room_id=room.room_id and plan.active),room.price_per_night)
      ) order by room.price_per_night,room.room_id)
        from public.hotel_rooms room where room.hotel_id=h.hotel_id),'[]'::jsonb)
    ) order by h.featured desc,h.created_at desc,h.hotel_id desc) from page h),'[]'::jsonb),
    'has_more',(select count(*) from picked) > (select count(*) from page),
    'next_cursor_featured',(select featured from page order by featured,created_at,hotel_id limit 1),
    'next_cursor_created_at',(select created_at from page order by featured,created_at,hotel_id limit 1),
    'next_cursor_id',(select hotel_id from page order by featured,created_at,hotel_id limit 1)
  );
$function$;
revoke all on function public.search_discoverable_hotels(p_query text, p_state text, p_city text, p_amenities text[], p_min_price numeric, p_max_price numeric, p_lat double precision, p_lng double precision, p_radius_km numeric, p_cursor_featured boolean, p_cursor_created_at timestamp with time zone, p_cursor_id integer, p_limit integer) from public, anon, authenticated, service_role;

grant execute on function public.search_discoverable_hotels(p_query text, p_state text, p_city text, p_amenities text[], p_min_price numeric, p_max_price numeric, p_lat double precision, p_lng double precision, p_radius_km numeric, p_cursor_featured boolean, p_cursor_created_at timestamp with time zone, p_cursor_id integer, p_limit integer) to service_role;
grant execute on function public.search_discoverable_hotels(p_query text, p_state text, p_city text, p_amenities text[], p_min_price numeric, p_max_price numeric, p_lat double precision, p_lng double precision, p_radius_km numeric, p_cursor_featured boolean, p_cursor_created_at timestamp with time zone, p_cursor_id integer, p_limit integer) to anon;
grant execute on function public.search_discoverable_hotels(p_query text, p_state text, p_city text, p_amenities text[], p_min_price numeric, p_max_price numeric, p_lat double precision, p_lng double precision, p_radius_km numeric, p_cursor_featured boolean, p_cursor_created_at timestamp with time zone, p_cursor_id integer, p_limit integer) to authenticated;

CREATE OR REPLACE FUNCTION public.set_apartment_commission_on_reservation(p_reservation_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_res public.reservations;
  v_policy record;
begin
  select * into v_res from public.reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Reservation not found'; end if;
  select * into v_policy from private.resolve_apartment_commission_policy(
    coalesce(v_res.stay_type,'long_stay'),v_res.management_mode_snapshot,
    v_res.commission_policy_version_id
  );
  if v_policy.policy_version_id is null then
    select * into v_policy from private.resolve_apartment_commission_policy(
      coalesce(v_res.stay_type,'long_stay'),v_res.management_mode_snapshot,null
    );
  end if;
  if v_policy.policy_version_id is null or v_policy.percent not between 0 and 50 then
    raise exception 'Active Creator apartment commission policy is missing';
  end if;
  update public.reservations set
    commission_policy_version_id=v_policy.policy_version_id,
    commission_rate=v_policy.percent,updated_at=now()
  where id=p_reservation_id;
  return true;
end
$function$;
revoke all on function public.set_apartment_commission_on_reservation(p_reservation_id text) from public, anon, authenticated, service_role;

grant execute on function public.set_apartment_commission_on_reservation(p_reservation_id text) to service_role;

CREATE OR REPLACE FUNCTION public.set_my_home_pet_policy(p_listing_id uuid, p_allowed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_changed integer;
begin
 if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then raise exception 'Property Partner access required'; end if;
 update public.listings set pets_allowed=coalesce(p_allowed,false),updated_at=now() where id=p_listing_id and deleted_at is null
   and exists(select 1 from public.property_host_assignments a where a.listing_id=p_listing_id
     and a.user_id=v_actor and a.assignment_role='owner' and a.status='active');
 get diagnostics v_changed=row_count;
 if v_changed<>1 then raise exception 'Owned home required'; end if;
 return true;
end $function$;
revoke all on function public.set_my_home_pet_policy(p_listing_id uuid, p_allowed boolean) from public, anon, authenticated, service_role;

grant execute on function public.set_my_home_pet_policy(p_listing_id uuid, p_allowed boolean) to service_role;
grant execute on function public.set_my_home_pet_policy(p_listing_id uuid, p_allowed boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_hotel_room_pet_policy(p_room_id integer, p_allowed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_changed integer;
begin
 if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then raise exception 'Property Partner access required'; end if;
 update public.hotel_rooms room set pets_allowed=coalesce(p_allowed,false),updated_at=now()
   where room.room_id=p_room_id and exists(select 1 from public.hotels hotel
     where hotel.hotel_id=room.hotel_id and hotel.owner_id=v_actor);
 get diagnostics v_changed=row_count;
 if v_changed<>1 then raise exception 'Owned hotel room required'; end if;
 return true;
end $function$;
revoke all on function public.set_my_hotel_room_pet_policy(p_room_id integer, p_allowed boolean) from public, anon, authenticated, service_role;

grant execute on function public.set_my_hotel_room_pet_policy(p_room_id integer, p_allowed boolean) to service_role;
grant execute on function public.set_my_hotel_room_pet_policy(p_room_id integer, p_allowed boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_property_management_mode(p_listing_id uuid, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if p_mode not in ('host','wehouse') then
    raise exception 'Choose Host manages or WeHouse manages';
  end if;

  if not exists(
    select 1
    from public.property_host_assignments a
    where a.listing_id=p_listing_id
      and a.user_id=v_actor
      and a.assignment_role='owner'
      and a.status='active'
  ) then
    raise exception 'Only the property owner can change who manages this home';
  end if;

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null
  for update;

  if v_listing.id is null then
    raise exception 'Property not found';
  end if;

  if v_listing.approved_at is null
     or v_listing.status not in ('available','unavailable','reserved','occupied','maintenance','closed') then
    raise exception 'Choose property management after this home is published';
  end if;

  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set management_mode=p_mode,
      management_host_user_id=case when p_mode='host' then v_actor else null end,
      wehouse_management_status=case
        when p_mode='host' then 'not_required'
        when management_mode='wehouse' and wehouse_management_status='approved' and management_updated_at is not null then 'approved'
        else 'requested'
      end,
      management_updated_at=now(),
      updated_at=now()
  where id=p_listing_id
  returning * into v_listing;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'property_management_mode_changed','listing',p_listing_id::text,
    jsonb_build_object(
      'management_mode',v_listing.management_mode,
      'wehouse_management_status',v_listing.wehouse_management_status,
      'management_host_user_id',v_listing.management_host_user_id
    )::text,now());

  return public.get_my_property_management(p_listing_id);
end
$function$;
revoke all on function public.set_my_property_management_mode(p_listing_id uuid, p_mode text) from public, anon, authenticated, service_role;

grant execute on function public.set_my_property_management_mode(p_listing_id uuid, p_mode text) to service_role;
grant execute on function public.set_my_property_management_mode(p_listing_id uuid, p_mode text) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_property_stay_rules(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_platform_min integer:=1;
  v_platform_max integer:=90;
  v_discount numeric(5,2);
begin
  if not public.current_actor_can_change_property_commercials(p_listing_id) then
    raise exception 'Full hosting access is required to change future stay rules';
  end if;
  select * into v_listing from public.listings
  where id=p_listing_id and deleted_at is null for update;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  if v_listing.sub_type<>'short_let' then
    raise exception 'Stay-length and non-refundable rates are only for Short Lets';
  end if;

  select coalesce(nullif(value,'')::integer,1) into v_platform_min
  from public.platform_settings
  where key='short_stay_min_nights' and coalesce(is_active,true) limit 1;
  select coalesce(nullif(value,'')::integer,90) into v_platform_max
  from public.platform_settings
  where key='short_stay_max_nights' and coalesce(is_active,true) limit 1;
  v_platform_min:=greatest(coalesce(v_platform_min,1),1);
  v_platform_max:=greatest(coalesce(v_platform_max,90),v_platform_min);
  if p_min_nights is null or p_max_nights is null
     or p_min_nights<v_platform_min or p_max_nights>v_platform_max
     or p_max_nights<p_min_nights then
    raise exception 'Stay length must be between % and % nights',v_platform_min,v_platform_max;
  end if;
  if p_non_refundable_enabled is null then
    raise exception 'Choose whether to offer a non-refundable rate';
  end if;
  if p_non_refundable_enabled then
    v_discount:=round(coalesce(p_non_refundable_discount_percent,0),2);
    if v_discount<1 or v_discount>30 then
      raise exception 'Non-refundable discount must be between 1 and 30 percent';
    end if;
  else
    v_discount:=null;
  end if;

  update public.listings set
    minimum_stay_nights=p_min_nights,
    maximum_stay_nights=p_max_nights,
    non_refundable_rate_enabled=p_non_refundable_enabled,
    non_refundable_discount_percent=v_discount,
    updated_at=now()
  where id=p_listing_id;

  insert into public.property_commercial_change_log(
    listing_id,actor_user_id,event_type,before_state,after_state
  ) values(
    p_listing_id,v_actor,'stay_rules_changed',
    jsonb_build_object(
      'minimum_stay_nights',v_listing.minimum_stay_nights,
      'maximum_stay_nights',v_listing.maximum_stay_nights,
      'non_refundable_rate_enabled',v_listing.non_refundable_rate_enabled,
      'non_refundable_discount_percent',v_listing.non_refundable_discount_percent
    ),
    jsonb_build_object(
      'minimum_stay_nights',p_min_nights,
      'maximum_stay_nights',p_max_nights,
      'non_refundable_rate_enabled',p_non_refundable_enabled,
      'non_refundable_discount_percent',v_discount
    )
  );

  return public.get_my_property_host_controls(p_listing_id);
end
$function$;
revoke all on function public.set_my_property_stay_rules(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) from public, anon, authenticated, service_role;

grant execute on function public.set_my_property_stay_rules(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) to service_role;
grant execute on function public.set_my_property_stay_rules(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_property_stay_rules_v2(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_terms jsonb; v_min numeric; v_max numeric; v_result jsonb;
begin
  select value into v_terms from public.creator_policy_versions
  where policy_key='accommodation_non_refundable_rate'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  v_min:=(v_terms->>'minimum_discount_percent')::numeric;
  v_max:=(v_terms->>'maximum_discount_percent')::numeric;
  if p_non_refundable_enabled and (
    p_non_refundable_discount_percent is null
    or p_non_refundable_discount_percent<v_min
    or p_non_refundable_discount_percent>v_max
  ) then raise exception 'Non-refundable discount must be between % and % percent',v_min,v_max;
  end if;
  v_result:=public.set_my_property_stay_rules(
    p_listing_id,p_min_nights,p_max_nights,p_non_refundable_enabled,
    p_non_refundable_discount_percent
  );
  return public.get_my_property_host_controls_v2(p_listing_id);
end
$function$;
revoke all on function public.set_my_property_stay_rules_v2(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) from public, anon, authenticated, service_role;

grant execute on function public.set_my_property_stay_rules_v2(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) to service_role;
grant execute on function public.set_my_property_stay_rules_v2(p_listing_id uuid, p_min_nights integer, p_max_nights integer, p_non_refundable_enabled boolean, p_non_refundable_discount_percent numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_stay_party(p_kind text, p_booking_id text, p_adults integer, p_children integer, p_infants integer, p_pets integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id(); v_changed integer;
begin
 if v_actor is null or p_kind not in ('home','hotel') or p_adults<1 or p_children<0 or p_infants<0 or p_pets<0
   or p_infants>5 or p_pets>5 then raise exception 'Invalid stay party'; end if;
 if p_kind='hotel' then
   update public.hotel_bookings set adult_count=p_adults,child_count=p_children,infant_count=p_infants,pet_count=p_pets,party_details_set=true
    where booking_id::text=p_booking_id and user_id=v_actor and status='pending' and payment_status='unpaid'
      and guest_count=p_adults+p_children;
 else
   update public.reservations set adult_count=p_adults,child_count=p_children,infant_count=p_infants,pet_count=p_pets,party_details_set=true
    where id=p_booking_id and user_id=v_actor and stay_type='short_let' and status='payment_pending'
      and guest_count=p_adults+p_children and rent_payment_status not in ('paid','upfront_paid');
 end if;
 get diagnostics v_changed=row_count;
 if v_changed<>1 then raise exception 'Pending owned stay with matching party required'; end if;
 return true;
end $function$;
revoke all on function public.set_my_stay_party(p_kind text, p_booking_id text, p_adults integer, p_children integer, p_infants integer, p_pets integer) from public, anon, authenticated, service_role;

grant execute on function public.set_my_stay_party(p_kind text, p_booking_id text, p_adults integer, p_children integer, p_infants integer, p_pets integer) to service_role;
grant execute on function public.set_my_stay_party(p_kind text, p_booking_id text, p_adults integer, p_children integer, p_infants integer, p_pets integer) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_worker_customer_record_consent(p_worker_id text, p_consent boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null or not exists(select 1 from public.worker_bookings
      where user_id=v_actor and worker_id=p_worker_id and status='approved_released') then
    raise exception 'A completed job with this Worker is required'; end if;
  if coalesce(p_consent,false) then
    insert into public.worker_customer_record_consents(worker_id,customer_id) values(p_worker_id,v_actor)
    on conflict do nothing;
  else
    delete from public.worker_customer_record_consents where worker_id=p_worker_id and customer_id=v_actor;
    delete from public.worker_pro_customer_notes where worker_id=p_worker_id and customer_id=v_actor;
  end if;
  return coalesce(p_consent,false);
end $function$;
revoke all on function public.set_my_worker_customer_record_consent(p_worker_id text, p_consent boolean) from public, anon, authenticated, service_role;

grant execute on function public.set_my_worker_customer_record_consent(p_worker_id text, p_consent boolean) to service_role;
grant execute on function public.set_my_worker_customer_record_consent(p_worker_id text, p_consent boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.set_my_worker_services(p_services jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_item jsonb;
  v_name text;
  v_category text;
  v_price integer;
  v_price_type text;
  v_description text;
  v_count integer:=0;
  v_names text[]:='{}'::text[];
  v_search text[]:='{}'::text[];
begin
  select * into v_actor
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active Worker account required'; end if;
  if p_services is null or jsonb_typeof(p_services)<>'array' then
    raise exception 'Services must be a list';
  end if;
  if jsonb_array_length(p_services)<1 then
    raise exception 'Add at least one service';
  end if;
  if jsonb_array_length(p_services)>10 then
    raise exception 'A Worker can list up to 10 services';
  end if;

  for v_item in select value from jsonb_array_elements(p_services) loop
    v_name:=nullif(btrim(coalesce(v_item->>'name','')),'');
    v_category:=nullif(btrim(coalesce(v_item->>'category','')),'');
    v_price:=greatest(0,coalesce(nullif(v_item->>'price','')::integer,0));
    v_price_type:=lower(coalesce(nullif(btrim(v_item->>'price_type'),''),'starting_from'));
    v_description:=nullif(btrim(coalesce(v_item->>'description','')),'');

    if v_name is null or v_category is null then
      raise exception 'Every service needs an approved category and service name';
    end if;
    if length(v_name)>120 then raise exception 'Service names must be 120 characters or less'; end if;
    if v_price_type not in ('starting_from','fixed','hourly','daily','negotiable') then
      raise exception 'Unsupported service price type';
    end if;
    if not exists(
      select 1
      from public.service_categories category
      join public.service_subcategories service on service.category_id=category.id
      where lower(btrim(category.name))=lower(v_category)
        and lower(btrim(service.name))=lower(v_name)
        and coalesce(category.is_active,true)
        and coalesce(service.is_active,true)
    ) then
      raise exception 'Choose an active WeHouse service from the approved catalog';
    end if;
    if exists(select 1 from unnest(v_names) existing where lower(existing)=lower(v_name)) then
      raise exception 'Each service can only be added once';
    end if;

    v_names:=array_append(v_names,v_name);
    v_search:=array_append(v_search,v_category);
    v_search:=array_append(v_search,v_name);
  end loop;

  delete from public.worker_services where worker_id=v_actor.user_id;
  for v_item in select value from jsonb_array_elements(p_services) loop
    v_name:=btrim(v_item->>'name');
    v_price:=greatest(0,coalesce(nullif(v_item->>'price','')::integer,0));
    v_price_type:=lower(coalesce(nullif(btrim(v_item->>'price_type'),''),'starting_from'));
    v_description:=nullif(btrim(coalesce(v_item->>'description','')),'');
    insert into public.worker_services(worker_id,service_name,price,price_type,description,created_at,updated_at)
    values(v_actor.user_id,v_name,v_price,v_price_type,v_description,now(),now());
    v_count:=v_count+1;
  end loop;

  update public.profiles
  set worker_skills=(
        select coalesce(jsonb_agg(value order by ord),'[]'::jsonb)
        from (
          select min(ord) ord, value
          from unnest(v_search) with ordinality item(value,ord)
          where nullif(btrim(value),'') is not null
          group by lower(btrim(value)),value
        ) deduped
      ),
      updated_at=now()
  where user_id=v_actor.user_id;

  return jsonb_build_object('success',true,'count',v_count,'services',to_jsonb(v_names));
end;
$function$;
revoke all on function public.set_my_worker_services(p_services jsonb) from public, anon, authenticated, service_role;

grant execute on function public.set_my_worker_services(p_services jsonb) to service_role;
grant execute on function public.set_my_worker_services(p_services jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_apartment_commission_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_policy record;
begin
  if tg_op='UPDATE' and old.commission_policy_version_id is not null then
    new.commission_policy_version_id:=old.commission_policy_version_id;
    new.commission_rate:=old.commission_rate;
    return new;
  end if;

  select * into v_policy
  from private.resolve_apartment_commission_policy(
    coalesce(new.stay_type,'long_stay'),
    coalesce(new.management_mode_snapshot,'wehouse'),
    null
  );
  if v_policy.policy_version_id is null or v_policy.percent not between 0 and 50 then
    raise exception 'Active Creator apartment commission policy is missing or invalid';
  end if;
  new.commission_policy_version_id:=v_policy.policy_version_id;
  new.commission_rate:=v_policy.percent;
  return new;
end
$function$;
revoke all on function public.snapshot_apartment_commission_policy() from public, anon, authenticated, service_role;

grant execute on function public.snapshot_apartment_commission_policy() to service_role;

CREATE OR REPLACE FUNCTION public.snapshot_hotel_cancellation_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_plan public.hotel_rate_plans; v_policy public.creator_policy_versions;
begin
  if tg_op='UPDATE' and old.cancellation_policy_version_id is not null then
    new.cancellation_policy_version_id:=old.cancellation_policy_version_id;
    new.rate_plan_snapshot:=old.rate_plan_snapshot;
    return new;
  end if;
  select * into v_plan from public.hotel_rate_plans
  where rate_plan_id=new.rate_plan_id and room_id=new.room_id;
  if v_plan.rate_plan_id is null then return new; end if;
  if v_plan.cancellation_policy_version_id is not null then
    select * into v_policy from public.creator_policy_versions
    where policy_version_id=v_plan.cancellation_policy_version_id;
    if v_policy.policy_version_id is null then
      raise exception 'Hotel cancellation policy version is unavailable';
    end if;
    new.cancellation_policy_version_id:=v_policy.policy_version_id;
  end if;
  new.rate_plan_snapshot:=coalesce(new.rate_plan_snapshot,'{}'::jsonb)||jsonb_build_object(
    'cancellation_template',v_plan.cancellation_template,
    'cancellation_policy_version_id',v_plan.cancellation_policy_version_id,
    'cancellation_policy_value',case when v_policy.policy_version_id is null
      then null else v_policy.value end
  );
  return new;
end
$function$;
revoke all on function public.snapshot_hotel_cancellation_policy() from public, anon, authenticated, service_role;

grant execute on function public.snapshot_hotel_cancellation_policy() to service_role;

CREATE OR REPLACE FUNCTION public.snapshot_short_let_rate_terms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_standard public.creator_policy_versions;
  v_nonref public.creator_policy_versions;
begin
  if new.stay_type is distinct from 'short_let' then return new; end if;
  if tg_op='UPDATE' and old.short_stay_cancellation_policy_version_id is not null then
    new.short_stay_cancellation_policy_version_id:=old.short_stay_cancellation_policy_version_id;
    new.short_stay_rate_terms_policy_version_id:=old.short_stay_rate_terms_policy_version_id;
    new.short_stay_cancellation_policy_snapshot:=old.short_stay_cancellation_policy_snapshot;
    return new;
  end if;
  select * into v_standard from public.creator_policy_versions
  where policy_key='short_let_cancellation' and scope_type='global' and scope_key='*'
    and status='active' and effective_from<=now()
    and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  select * into v_nonref from public.creator_policy_versions
  where policy_key='accommodation_non_refundable_rate'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc,version desc limit 1;
  if v_standard.policy_version_id is null or v_nonref.policy_version_id is null then
    raise exception 'Creator-approved Short Let rate terms are unavailable';
  end if;
  new.short_stay_cancellation_policy_version_id:=v_standard.policy_version_id;
  new.short_stay_rate_terms_policy_version_id:=v_nonref.policy_version_id;
  new.short_stay_cancellation_policy_snapshot:=
    coalesce(new.short_stay_cancellation_policy_snapshot,'{}'::jsonb)||jsonb_build_object(
      'standard_policy_version_id',v_standard.policy_version_id,
      'rate_terms_policy_version_id',v_nonref.policy_version_id,
      'non_refundable_terms',v_nonref.value
    );
  return new;
end
$function$;
revoke all on function public.snapshot_short_let_rate_terms() from public, anon, authenticated, service_role;

grant execute on function public.snapshot_short_let_rate_terms() to service_role;

CREATE OR REPLACE FUNCTION public.submit_my_property_change_request(p_listing_id uuid, p_change_type text, p_proposed_changes jsonb, p_reason text)
 RETURNS property_change_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_existing public.property_change_requests;
  v_result public.property_change_requests;
  v_count integer;
begin
  if v_actor is null or not exists(
    select 1 from public.property_host_assignments a
    where a.listing_id=p_listing_id and a.user_id=v_actor
      and a.assignment_role='owner' and a.status='active'
  ) then raise exception 'Only the active property owner can request this change'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Explain why the live property should change';
  end if;
  if p_change_type not in ('price','photos','renovation')
     or jsonb_typeof(p_proposed_changes)<>'object' then
    raise exception 'Choose a supported change and provide its details';
  end if;

  select * into v_listing from public.listings
  where id=p_listing_id and deleted_at is null for update;
  if v_listing.id is null or v_listing.approved_at is null
     or v_listing.status not in ('available','reserved','occupied','maintenance','closed') then
    raise exception 'Only a published property can be revised here';
  end if;

  if p_change_type='price' then
    if v_listing.management_mode<>'wehouse' then
      raise exception 'Host-managed price is changed through Host commercial controls';
    end if;
    if coalesce((p_proposed_changes->>'price')::numeric,0)<=0 then
      raise exception 'The proposed price must be greater than zero';
    end if;
  elsif p_change_type='photos' then
    if jsonb_typeof(p_proposed_changes->'images')<>'array' then
      raise exception 'Choose the replacement property photos';
    end if;
    v_count:=jsonb_array_length(p_proposed_changes->'images');
    if v_count<1 or v_count>12 or exists(
      select 1 from jsonb_array_elements_text(p_proposed_changes->'images') image
      where image !~ '^https://'
    ) then raise exception 'Provide 1 to 12 uploaded property photos'; end if;
  else
    if char_length(btrim(coalesce(p_proposed_changes->>'summary',''))) not between 10 and 2000
       or char_length(coalesce(p_proposed_changes->>'description',''))>5000 then
      raise exception 'Describe the completed renovation';
    end if;
    if p_proposed_changes ? 'images' then
      if jsonb_typeof(p_proposed_changes->'images')<>'array' then
        raise exception 'Renovation photos are invalid';
      end if;
      v_count:=jsonb_array_length(p_proposed_changes->'images');
      if v_count<1 or v_count>12 or exists(
        select 1 from jsonb_array_elements_text(p_proposed_changes->'images') image
        where image !~ '^https://'
      ) then raise exception 'Provide up to 12 uploaded renovation photos'; end if;
    end if;
  end if;

  select * into v_existing from public.property_change_requests
  where listing_id=v_listing.id and requested_by=v_actor
    and change_type=p_change_type and status='changes_requested'
  for update;
  if v_existing.change_request_id is not null then
    update public.property_change_requests set
      proposed_changes=p_proposed_changes,reason=btrim(p_reason),status='submitted',
      reviewed_by=null,reviewed_at=null,decision_reason=null,updated_at=now()
    where change_request_id=v_existing.change_request_id
    returning * into v_result;
    return v_result;
  end if;

  insert into public.property_change_requests(
    listing_id,requested_by,change_type,proposed_changes,reason,materiality,
    requires_reinspection,before_snapshot
  ) values(
    v_listing.id,v_actor,p_change_type,p_proposed_changes,btrim(p_reason),
    case p_change_type when 'price' then 'commercial' when 'photos' then 'media' else 'material' end,
    p_change_type='renovation',
    jsonb_build_object(
      'price',v_listing.price,'description',v_listing.description,
      'images',to_jsonb(v_listing.images),'bedrooms',v_listing.bedrooms,
      'bathrooms',v_listing.bathrooms,'amenities',to_jsonb(v_listing.amenities),
      'management_mode',v_listing.management_mode
    )
  ) returning * into v_result;
  return v_result;
exception when unique_violation then
  raise exception 'This property already has an open % change request',p_change_type;
end
$function$;
revoke all on function public.submit_my_property_change_request(p_listing_id uuid, p_change_type text, p_proposed_changes jsonb, p_reason text) from public, anon, authenticated, service_role;

grant execute on function public.submit_my_property_change_request(p_listing_id uuid, p_change_type text, p_proposed_changes jsonb, p_reason text) to service_role;
grant execute on function public.submit_my_property_change_request(p_listing_id uuid, p_change_type text, p_proposed_changes jsonb, p_reason text) to authenticated;

CREATE OR REPLACE FUNCTION public.validate_stay_party()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_pets boolean; v_capacity integer;
begin
 if tg_op='UPDATE' then
   if old.party_details_set and not new.party_details_set then raise exception 'Stay party cannot be cleared'; end if;
   -- A property can change its future pet policy without invalidating an
   -- already accepted and paid party during payment or check-in updates.
   if old.party_details_set and new.party_details_set and old.adult_count=new.adult_count
     and old.child_count=new.child_count and old.infant_count=new.infant_count and old.pet_count=new.pet_count
     and old.guest_count=new.guest_count then return new; end if;
 end if;
 if not new.party_details_set then return new; end if;
 if new.adult_count<1 or new.child_count<0 or new.infant_count<0 or new.pet_count<0
   or new.infant_count>5 or new.pet_count>5 or new.guest_count<>new.adult_count+new.child_count then
   raise exception 'Invalid stay party'; end if;
 if tg_table_name='hotel_bookings' then
   select max_guests,pets_allowed into v_capacity,v_pets from public.hotel_rooms where room_id=new.room_id and hotel_id=new.hotel_id;
 else
   select max_guests,pets_allowed into v_capacity,v_pets from public.listings where id::text=new.listing_id or listing_id=new.listing_id limit 1;
 end if;
 if v_capacity is null or new.guest_count>v_capacity then raise exception 'Party exceeds property capacity'; end if;
 if new.pet_count>0 and not coalesce(v_pets,false) then raise exception 'Pets are not allowed at this property'; end if;
 return new;
end $function$;
revoke all on function public.validate_stay_party() from public, anon, authenticated, service_role;

grant execute on function public.validate_stay_party() to service_role;

CREATE OR REPLACE FUNCTION public.worker_pro_is_active(p_worker_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists(
    select 1 from public.worker_pro_subscriptions subscription
    where subscription.worker_id=p_worker_id
      and subscription.status in ('active','grace_period')
      and subscription.current_period_end>now()
  );
$function$;
revoke all on function public.worker_pro_is_active(p_worker_id text) from public, anon, authenticated, service_role;

grant execute on function public.worker_pro_is_active(p_worker_id text) to service_role;
grant execute on function public.worker_pro_is_active(p_worker_id text) to authenticated;
