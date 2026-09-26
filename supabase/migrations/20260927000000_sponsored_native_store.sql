-- Native Sponsored purchases use store SKUs configured for each market and duration.
-- Store transactions are claimed once and only service-verified orders can deliver.
create table public.sponsored_store_products (
  rule_id uuid not null references public.sponsored_market_rules(rule_id) on delete cascade,
  duration_days integer not null check (duration_days between 1 and 90),
  platform text not null check (platform in ('apple','google')),
  product_id text not null check (product_id ~ '^[A-Za-z0-9_.-]{3,180}$'),
  price_ngn numeric(12,2) not null check (price_ngn > 0),
  enabled boolean not null default false,
  updated_by text not null references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  primary key (rule_id,duration_days,platform)
);
create index sponsored_store_products_product_idx on public.sponsored_store_products(platform,product_id);
alter table public.sponsored_store_products enable row level security;
revoke all on public.sponsored_store_products from public,anon,authenticated;
grant all on public.sponsored_store_products to service_role;

create table public.sponsored_store_transactions (
  platform text not null check (platform in ('apple','google')),
  provider_transaction_id text not null,
  payment_id uuid not null unique references public.booking_payments(id),
  campaign_id uuid not null references public.sponsored_campaigns(campaign_id),
  account_user_id uuid not null references auth.users(id),
  product_id text not null,
  purchase_token text,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  environment text not null check (environment in ('sandbox','production')),
  verified_at timestamptz not null default now(),
  primary key (platform,provider_transaction_id)
);
create index sponsored_store_transactions_campaign_idx on public.sponsored_store_transactions(campaign_id);
alter table public.sponsored_store_transactions enable row level security;
revoke all on public.sponsored_store_transactions from public,anon,authenticated;
grant all on public.sponsored_store_transactions to service_role;

create or replace function public.creator_set_sponsored_store_product(
  p_rule_id uuid,p_duration_days integer,p_platform text,p_product_id text,
  p_price_ngn numeric,p_enabled boolean,p_creator_elevation_id uuid
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id(); v_rule public.sponsored_market_rules;
  v_row public.sponsored_store_products;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
    raise exception 'Recent Creator authentication required'; end if;
  select * into v_rule from public.sponsored_market_rules where rule_id=p_rule_id for update;
  if v_rule.rule_id is null then raise exception 'Sponsored rule not found'; end if;
  if p_platform not in ('apple','google') or not coalesce(p_duration_days=any(v_rule.allowed_durations),false) then
    raise exception 'Choose a platform and an allowed duration'; end if;
  if coalesce(p_product_id,'') !~ '^[A-Za-z0-9_.-]{3,180}$'
    or coalesce(p_price_ngn,0)<=0 or p_price_ngn<>v_rule.daily_price_ngn*p_duration_days then
    raise exception 'Store product and price must match this market quote'; end if;
  insert into public.sponsored_store_products(rule_id,duration_days,platform,product_id,price_ngn,enabled,updated_by)
    values(p_rule_id,p_duration_days,p_platform,p_product_id,p_price_ngn,coalesce(p_enabled,false),v_actor)
    on conflict(rule_id,duration_days,platform) do update set
      product_id=excluded.product_id,price_ngn=excluded.price_ngn,
      enabled=excluded.enabled,updated_by=v_actor,updated_at=now()
    returning * into v_row;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
    values(v_actor,'sponsored_store_product_updated','sponsored_market_rule',p_rule_id::text,
      jsonb_build_object('platform',p_platform,'duration_days',p_duration_days,
        'product_id',p_product_id,'price_ngn',p_price_ngn,'enabled',p_enabled)::text,now());
  return to_jsonb(v_row);
end $$;

create or replace function public.get_my_sponsored_store_offers(p_resource_type text,p_resource_id text)
returns table(rule_id uuid,duration_days integer,platform text,product_id text)
language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
declare v_context jsonb; v_rule public.sponsored_market_rules;
begin
  v_context:=public._my_sponsored_resource_context(p_resource_type,p_resource_id);
  if not (public.get_my_sponsored_offer(p_resource_type,p_resource_id)->>'available')::boolean then return; end if;
  select * into v_rule from public.sponsored_market_rules r
    where r.resource_type=p_resource_type and r.scope_key in
      (coalesce(v_context->>'state_key','')||':'||coalesce(v_context->>'lga_key',''),'global')
    order by case when r.scope_type='lga' then 0 else 1 end limit 1;
  return query select p.rule_id,p.duration_days,p.platform,p.product_id
    from public.sponsored_store_products p where p.rule_id=v_rule.rule_id and p.enabled
      and p.price_ngn=v_rule.daily_price_ngn*p.duration_days
      and p.duration_days=any(v_rule.allowed_durations);
end $$;

create or replace function public.creator_get_sponsored_store_products()
returns setof public.sponsored_store_products language sql stable security definer
set search_path to 'pg_catalog','public' as $$
  select p.* from public.sponsored_store_products p
    where public.current_actor_has_workspace('creator',null)
    order by p.rule_id,p.duration_days,p.platform
$$;

create or replace function public.begin_my_sponsored_store_checkout(p_campaign_id uuid,p_platform text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_campaign public.sponsored_campaigns; v_product public.sponsored_store_products;
  v_payment public.booking_payments; v_checkout jsonb; v_actor text:=public.current_profile_user_id();
begin
  if p_platform not in ('apple','google') then raise exception 'Choose an app store'; end if;
  select * into v_campaign from public.sponsored_campaigns
    where campaign_id=p_campaign_id and owner_user_id=v_actor for update;
  if v_campaign.campaign_id is null then raise exception 'Campaign not found'; end if;
  if v_campaign.status='pending_payment' and v_campaign.updated_at>now()-interval '15 minutes' then
    select * into v_payment from public.booking_payments
      where payment_reference=v_campaign.payment_reference for update;
    if v_payment.payment_method<>p_platform then
      raise exception 'Another checkout is still open for this campaign'; end if;
    return jsonb_build_object('reference',v_payment.payment_reference,
      'product_id',v_payment.metadata->>'store_product_id');
  end if;
  if v_campaign.status not in ('draft','pending_payment') then
    raise exception 'This campaign cannot start a new checkout'; end if;
  -- The web reservation procedure rechecks ownership, eligibility and capacity.
  v_checkout:=public.begin_my_sponsored_checkout(p_campaign_id);
  select * into v_payment from public.booking_payments
    where payment_reference=v_checkout->>'reference' and purpose='sponsored_campaign' for update;
  select * into v_product from public.sponsored_store_products p
    where p.rule_id=(v_payment.metadata->>'rule_id')::uuid
      and p.duration_days=v_campaign.duration_days and p.platform=p_platform and p.enabled
      and p.price_ngn=v_payment.amount_total for update;
  if v_product.product_id is null then raise exception 'Store product is not open for this campaign'; end if;
  update public.booking_payments set payment_method=p_platform,paystack_reference=null,
    metadata=metadata||jsonb_build_object('store_product_id',v_product.product_id),updated_at=now()
    where id=v_payment.id;
  return jsonb_build_object('reference',v_payment.payment_reference,
    'product_id',v_product.product_id);
end $$;

create or replace function public.confirm_sponsored_store_purchase(
  p_reference text,p_platform text,p_product_id text,p_transaction_id text,
  p_account_user_id uuid,p_environment text,p_payload_sha256 text,p_purchase_token text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_payment public.booking_payments; v_campaign public.sponsored_campaigns;
  v_rule public.sponsored_market_rules; v_claim public.sponsored_store_transactions;
  v_reason text; v_count integer; v_eligible boolean:=false;
begin
  if auth.uid() is not null then raise exception 'Service role required'; end if;
  if p_platform not in ('apple','google') or nullif(p_reference,'') is null
    or nullif(p_product_id,'') is null or nullif(p_transaction_id,'') is null
    or p_environment not in ('sandbox','production')
    or p_payload_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid store verification'; end if;
  select * into v_claim from public.sponsored_store_transactions
    where platform=p_platform and provider_transaction_id=p_transaction_id for update;
  if v_claim.payment_id is not null then
    if v_claim.account_user_id<>p_account_user_id or v_claim.product_id<>p_product_id
      or v_claim.environment<>p_environment or v_claim.payment_id<>(
        select id from public.booking_payments where payment_reference=p_reference) then
      raise exception 'Store transaction already belongs to another order'; end if;
    select * into v_campaign from public.sponsored_campaigns where campaign_id=v_claim.campaign_id;
    return jsonb_build_object('success',v_campaign.status='active','charged',true,
      'already_processed',true,'status',v_campaign.status,'requires_review',v_campaign.status<>'active');
  end if;
  select * into v_payment from public.booking_payments
    where payment_reference=p_reference and purpose='sponsored_campaign' for update;
  if v_payment.id is null or v_payment.payment_method<>p_platform
    or v_payment.metadata->>'store_product_id' is distinct from p_product_id
    or v_payment.status not in ('pending','expired') then
    raise exception 'Store order does not match this purchase'; end if;
  if not exists(select 1 from public.profiles p where p.user_id=v_payment.payer_user_id
    and p.auth_id=p_account_user_id) then raise exception 'Store account mismatch'; end if;
  select * into v_campaign from public.sponsored_campaigns
    where campaign_id=(v_payment.metadata->>'campaign_id')::uuid
      and owner_user_id=v_payment.payer_user_id for update;
  if v_campaign.campaign_id is null then raise exception 'Campaign/payment mismatch'; end if;
  select * into v_rule from public.sponsored_market_rules where rule_id=v_campaign.rule_id for update;
  if v_campaign.payment_reference is distinct from p_reference
    or v_campaign.status<>'pending_payment' or v_payment.status<>'pending'
    or v_campaign.updated_at<=now()-interval '15 minutes' then
    v_reason:='Checkout expired or replaced before store confirmation';
  elsif v_rule.rule_id is null or not v_rule.enabled or v_rule.slot_count<1 then
    v_reason:='Sponsored market is closed';
  elsif v_campaign.amount_ngn<>v_payment.amount_total then
    v_reason:='Campaign price changed';
  else
    select count(*) into v_count from public.sponsored_campaigns c
      where c.rule_id=v_rule.rule_id and c.campaign_id<>v_campaign.campaign_id
        and c.status='active' and c.ends_at>now();
    if v_count>=v_rule.slot_count then v_reason:='Sponsored market capacity reached'; end if;
    if v_campaign.resource_type='worker' then
      select exists(select 1 from public.profiles p where p.user_id=v_campaign.resource_id
        and p.user_id=v_campaign.owner_user_id and p.worker_verified and p.worker_status='verified'
        and coalesce((public._worker_publication_state(p.user_id)->>'publicly_visible')::boolean,false)
        and public.user_has_active_workspace(p.user_id,'worker')
        and not coalesce(p.deleted,false) and not coalesce(p.suspended,false)
        and not coalesce(p.banned,false)
        and public.wehouse_state_key(p.state) is not distinct from v_campaign.state_key
        and public.worker_market_text_key(coalesce(nullif(p.local_government,''),p.city))
          is not distinct from v_campaign.lga_key) into v_eligible;
    elsif v_campaign.resource_type='property' then
      select exists(select 1 from public.listings l
        join public.property_host_assignments a on a.listing_id=l.id
          and a.user_id=v_campaign.owner_user_id and a.assignment_role='owner' and a.status='active'
        where l.id::text=v_campaign.resource_id and l.deleted_at is null
          and l.approved_at is not null and l.status='available'
          and l.availability_status='available' and l.inspection_request_id is not null
          and public.wehouse_state_key(l.state) is not distinct from v_campaign.state_key
          and public.worker_market_text_key(l.city) is not distinct from v_campaign.lga_key
          and public.user_has_active_workspace(a.user_id,'property_partner')) into v_eligible;
    elsif v_campaign.resource_type='hotel' then
      select exists(select 1 from public.hotels h where h.hotel_id::text=v_campaign.resource_id
        and h.owner_id=v_campaign.owner_user_id and h.status='active'
        and h.approved_at is not null and h.published_at is not null
        and public.wehouse_state_key(h.state) is not distinct from v_campaign.state_key
        and public.worker_market_text_key(coalesce(nullif(h.city,''),h.area))
          is not distinct from v_campaign.lga_key
          and public.user_has_active_workspace(h.owner_id,'property_partner')) into v_eligible;
    end if;
    if not v_eligible then v_reason:='Resource no longer eligible'; end if;
  end if;
  insert into public.sponsored_store_transactions(platform,provider_transaction_id,payment_id,
    campaign_id,account_user_id,product_id,purchase_token,payload_sha256,environment)
    values(p_platform,p_transaction_id,v_payment.id,v_campaign.campaign_id,
      p_account_user_id,p_product_id,p_purchase_token,p_payload_sha256,p_environment);
  update public.booking_payments set status='paid',verified_at=now(),paid_at=now(),
    verification_source='edge_function',webhook_processed=true,
    metadata=metadata||jsonb_build_object('store_transaction_id',p_transaction_id,
      'store_environment',p_environment,'store_needs_review',v_reason is not null),updated_at=now()
    where id=v_payment.id;
  if v_reason is not null then
    update public.sponsored_campaigns set status='paused',pause_reason=v_reason,updated_at=now()
      where campaign_id=v_campaign.campaign_id and payment_reference=p_reference;
    return jsonb_build_object('success',false,'charged',true,'requires_review',true,
      'status','paused','error',v_reason);
  end if;
  update public.sponsored_campaigns set status='active',starts_at=now(),
    ends_at=now()+make_interval(days=>v_campaign.duration_days),pause_reason=null,
    updated_at=now() where campaign_id=v_campaign.campaign_id;
  return jsonb_build_object('success',true,'status','active','campaign_id',v_campaign.campaign_id);
end $$;

create or replace function public.pause_sponsored_store_transaction(
  p_platform text,p_transaction_id text,p_reason text
) returns boolean language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_claim public.sponsored_store_transactions;
begin
  if auth.uid() is not null then raise exception 'Service role required'; end if;
  if p_reason not in ('store_refund','store_revocation','store_chargeback') then
    raise exception 'Invalid store event'; end if;
  select * into v_claim from public.sponsored_store_transactions
    where platform=p_platform and provider_transaction_id=p_transaction_id for update;
  if v_claim.payment_id is null then return false; end if;
  update public.sponsored_campaigns set status='paused',
    pause_reason='Store '||p_reason||' requires Finance review',updated_at=now()
    where campaign_id=v_claim.campaign_id and status='active';
  update public.booking_payments set status='refunded',refund_reason=p_reason,
    refund_processed_at=now(),updated_at=now()
    where id=v_claim.payment_id and status='paid';
  return true;
end $$;

revoke all on function public.creator_set_sponsored_store_product(uuid,integer,text,text,numeric,boolean,uuid) from public,anon,authenticated;
revoke all on function public.get_my_sponsored_store_offers(text,text) from public,anon;
revoke all on function public.creator_get_sponsored_store_products() from public,anon;
revoke all on function public.begin_my_sponsored_store_checkout(uuid,text) from public,anon;
revoke all on function public.confirm_sponsored_store_purchase(text,text,text,text,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.pause_sponsored_store_transaction(text,text,text) from public,anon,authenticated;
grant execute on function public.creator_set_sponsored_store_product(uuid,integer,text,text,numeric,boolean,uuid) to authenticated;
grant execute on function public.get_my_sponsored_store_offers(text,text) to authenticated;
grant execute on function public.creator_get_sponsored_store_products() to authenticated;
grant execute on function public.begin_my_sponsored_store_checkout(uuid,text) to authenticated;
grant execute on function public.confirm_sponsored_store_purchase(text,text,text,text,uuid,text,text,text) to service_role;
grant execute on function public.pause_sponsored_store_transaction(text,text,text) to service_role;
