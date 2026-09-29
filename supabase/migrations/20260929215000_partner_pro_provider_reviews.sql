-- A refunded or disputed prepaid purchase needs Finance review before its
-- remaining access can be used. Provider events are verified by the webhook.
begin;

alter table public.partner_pro_entitlements
  add column review_started_at timestamptz,
  add column review_payment_id uuid references public.booking_payments(id),
  add column review_reason text;

create table public.partner_pro_provider_events (
  event_key text primary key,
  payment_id uuid not null references public.booking_payments(id),
  event_type text not null,
  environment text not null,
  received_at timestamptz not null default now()
);
alter table public.partner_pro_provider_events enable row level security;
revoke all on public.partner_pro_provider_events from public,anon,authenticated;
grant all on public.partner_pro_provider_events to service_role;

create or replace function public.partner_pro_is_active(p_partner_id text)
returns boolean language sql stable security definer set search_path='pg_catalog','public' as $$
  select exists(select 1 from public.partner_pro_entitlements e
    where e.partner_id=p_partner_id and e.current_period_end>now()
      and e.review_started_at is null)
$$;
revoke all on function public.partner_pro_is_active(text) from public,anon,authenticated;
grant execute on function public.partner_pro_is_active(text) to service_role;

create or replace function public.pause_partner_pro_on_provider_event(
  p_reference text,p_event_type text,p_environment text,p_event_key text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_payment public.booking_payments; v_new integer;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'Service role required'; end if;
  if p_event_type not in ('refund.pending','refund.processing','refund.processed','charge.dispute.create')
    or p_environment not in ('test','live') or length(coalesce(p_event_key,''))<8 then
    raise exception 'Invalid provider event'; end if;
  select * into v_payment from public.booking_payments
    where paystack_reference=p_reference and purpose='partner_pro_access' for update;
  if v_payment.id is null then return false; end if;
  if v_payment.metadata->>'paystack_environment' is distinct from p_environment
    or v_payment.status not in ('paid','completed') then raise exception 'Provider payment mismatch'; end if;
  insert into public.partner_pro_provider_events(event_key,payment_id,event_type,environment)
  values(p_event_key,v_payment.id,p_event_type,p_environment)
  on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new=0 then return true; end if;
  update public.partner_pro_entitlements set review_started_at=now(),
    review_payment_id=v_payment.id,review_reason=p_event_type,updated_at=now()
    where partner_id=v_payment.user_id and review_started_at is null;
  update public.booking_payments set status='expired',updated_at=now()
    where user_id=v_payment.user_id and purpose='partner_pro_access' and status='pending';
  return true;
end $$;
revoke all on function public.pause_partner_pro_on_provider_event(text,text,text,text) from public,anon,authenticated;
grant execute on function public.pause_partner_pro_on_provider_event(text,text,text,text) to service_role;

-- Finance resolves only after reconciling the provider payment. A revocation
-- ends the remaining period; a cleared dispute restores the existing expiry.
create or replace function public.resolve_partner_pro_provider_review(
  p_partner_id text,p_restore boolean,p_reason text)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_payment uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'Service role required'; end if;
  if length(btrim(coalesce(p_reason,'')))<12 then raise exception 'Finance reason required'; end if;
  select review_payment_id into v_payment from public.partner_pro_entitlements
    where partner_id=p_partner_id and review_started_at is not null for update;
  if v_payment is null then raise exception 'No Partner Pro review is open'; end if;
  update public.partner_pro_entitlements set
    current_period_end=case when p_restore then current_period_end else least(current_period_end,now()) end,
    review_started_at=null,review_payment_id=null,review_reason=null,updated_at=now()
    where partner_id=p_partner_id;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values('service_role','partner_pro_provider_review','partner_pro_entitlement',p_partner_id,
    jsonb_build_object('payment_id',v_payment,'restored',p_restore,'reason',p_reason)::text,now());
  return true;
end $$;
revoke all on function public.resolve_partner_pro_provider_review(text,boolean,text) from public,anon,authenticated;
grant execute on function public.resolve_partner_pro_provider_review(text,boolean,text) to service_role;

-- Reject new checkout attempts while a previous charge is being reviewed.
create or replace function public.reject_partner_pro_checkout_under_review()
returns trigger language plpgsql set search_path='pg_catalog','public' as $$
begin
  if new.purpose='partner_pro_access' and new.status='pending'
    and exists(select 1 from public.partner_pro_entitlements e
      where e.partner_id=new.user_id and e.review_started_at is not null) then
    raise exception 'Partner Pro payment is under Finance review';
  end if;
  return new;
end $$;
create trigger partner_pro_checkout_review_guard before insert or update on public.booking_payments
  for each row execute function public.reject_partner_pro_checkout_under_review();
revoke all on function public.reject_partner_pro_checkout_under_review() from public,anon,authenticated;

-- Keep existing plan data visible while review pauses entitlement.
create or replace function public.get_my_partner_pro()
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id(); v_price_month numeric:=0;
  v_price_year numeric:=0; v_sales boolean:=false; v_terms text:='';
  v_version text:=''; v_sha text; v_end timestamptz; v_review timestamptz; v_accepted boolean:=false;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required'; end if;
  select coalesce(nullif(value,'')::numeric,0) into v_price_month from public.platform_settings where key='partner_pro_monthly_price_ngn' and is_active=true;
  select coalesce(nullif(value,'')::numeric,0) into v_price_year from public.platform_settings where key='partner_pro_yearly_price_ngn' and is_active=true;
  select lower(value) in ('true','1','yes','on') into v_sales from public.platform_settings where key='partner_pro_sales_enabled' and is_active=true;
  select coalesce(value,'') into v_version from public.platform_settings where key='partner_pro_terms_version' and is_active=true;
  select coalesce(value,'') into v_terms from public.platform_settings where key='partner_pro_terms_content' and is_active=true;
  select current_period_end,review_started_at into v_end,v_review from public.partner_pro_entitlements where partner_id=v_actor;
  v_sha:=encode(extensions.digest(convert_to(coalesce(v_terms,''),'UTF8'),'sha256'),'hex');
  select exists(select 1 from public.partner_pro_terms_acceptances where partner_id=v_actor
    and terms_version=v_version and terms_sha256=v_sha) into v_accepted;
  return jsonb_build_object('active',coalesce(v_end>now() and v_review is null,false),
    'under_review',v_review is not null,'current_period_end',v_end,
    'sales_enabled',coalesce(v_sales,false),'monthly_price_ngn',coalesce(v_price_month,0),
    'yearly_price_ngn',coalesce(v_price_year,0),'terms_version',coalesce(v_version,''),
    'terms_content',coalesce(v_terms,''),'terms_accepted',v_accepted,'auto_renews',false);
end $$;
revoke all on function public.get_my_partner_pro() from public,anon;
grant execute on function public.get_my_partner_pro() to authenticated;
commit;
