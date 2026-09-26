-- Paid Sponsored visibility for eligible Workers, homes and hotels.
-- Checkout is reserved briefly; only a server-verified Paystack charge can activate it.
alter table public.booking_payments drop constraint if exists booking_payments_purpose_check;
alter table public.booking_payments add constraint booking_payments_purpose_check
  check (purpose=any(array[
    'apartment_reservation','apartment_rent','worker_booking','hotel_reservation',
    'hotel_booking','rent_plan_contribution','worker_verification',
    'worker_pro_subscription','shared_housing_share','sponsored_campaign','other'
  ]::text[]));

alter table public.sponsored_campaigns
  add column if not exists rule_id uuid references public.sponsored_market_rules(rule_id);
create unique index if not exists sponsored_campaigns_payment_reference_unique
  on public.sponsored_campaigns(payment_reference) where payment_reference is not null;
create index if not exists sponsored_campaigns_capacity_idx
  on public.sponsored_campaigns(rule_id,status,updated_at,ends_at);

create or replace function public.begin_my_sponsored_checkout(p_campaign_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public' as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_campaign public.sponsored_campaigns;
  v_rule public.sponsored_market_rules;
  v_quote jsonb;
  v_context jsonb;
  v_reference text;
  v_count integer;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_campaign from public.sponsored_campaigns
    where campaign_id=p_campaign_id and owner_user_id=v_actor for update;
  if v_campaign.campaign_id is null then raise exception 'Campaign not found'; end if;
  if v_campaign.status='pending_payment' and v_campaign.updated_at>now()-interval '15 minutes' then
    return jsonb_build_object('reference',v_campaign.payment_reference,
      'amount_ngn',v_campaign.amount_ngn,'campaign_id',v_campaign.campaign_id);
  end if;
  if v_campaign.status not in ('draft','pending_payment') then
    raise exception 'This campaign cannot start a new checkout';
  end if;
  v_quote:=public.quote_my_sponsored_campaign(v_campaign.resource_type,v_campaign.resource_id,v_campaign.duration_days);
  v_context:=public._my_sponsored_resource_context(v_campaign.resource_type,v_campaign.resource_id);
  if v_campaign.resource_type='worker' and
    not coalesce((public._worker_publication_state(v_campaign.resource_id)->>'publicly_visible')::boolean,false) then
    raise exception 'Worker is not currently published in discovery';
  end if;
  if v_campaign.resource_type='property' and not exists(
    select 1 from public.listings l where l.id::text=v_campaign.resource_id
      and l.status='available' and l.availability_status='available'
      and l.inspection_request_id is not null) then
    raise exception 'This home is not currently discoverable';
  end if;
  if v_campaign.resource_type='hotel' and not exists(
    select 1 from public.hotels h where h.hotel_id::text=v_campaign.resource_id
      and h.approved_at is not null and h.published_at is not null) then
    raise exception 'This hotel is not currently discoverable';
  end if;
  if (v_quote->>'amount_ngn')::numeric<=0 then
    raise exception 'A positive Sponsored price must be configured before checkout';
  end if;
  if v_campaign.state_key is distinct from (v_context->>'state_key')
    or v_campaign.lga_key is distinct from (v_context->>'lga_key') then
    raise exception 'Resource location changed; create a new campaign';
  end if;
  select * into v_rule from public.sponsored_market_rules
    where rule_id=(v_quote->>'rule_id')::uuid for update;
  -- Locking the rule serializes checkouts for the same market and prevents overselling.
  select count(*) into v_count from public.sponsored_campaigns c
    where c.rule_id=v_rule.rule_id and c.campaign_id<>p_campaign_id
      and ((c.status='active' and c.ends_at>now())
        or (c.status='pending_payment' and c.updated_at>now()-interval '15 minutes'));
  if v_count>=v_rule.slot_count then raise exception 'Sponsored slots are full in this market'; end if;

  if v_campaign.payment_reference is not null then
    update public.booking_payments set status='expired',updated_at=now()
      where paystack_reference=v_campaign.payment_reference and status='pending';
  end if;
  v_reference:='WHS-'||gen_random_uuid()::text;
  update public.sponsored_campaigns set
    status='pending_payment',payment_reference=v_reference,rule_id=v_rule.rule_id,
    amount_ngn=(v_quote->>'amount_ngn')::numeric,updated_at=now()
    where campaign_id=p_campaign_id;
  insert into public.booking_payments(
    payment_reference,paystack_reference,user_id,payer_user_id,type,booking_type,
    amount,amount_total,net_amount,amount_commission,currency,status,purpose,
    payment_method,metadata,created_at,updated_at
  ) values (
    v_reference,v_reference,v_actor,v_actor,'sponsored_campaign','sponsored_campaign',
    (v_quote->>'amount_ngn')::numeric,(v_quote->>'amount_ngn')::numeric,
    (v_quote->>'amount_ngn')::numeric,0,'NGN','pending','sponsored_campaign',
    'paystack',jsonb_build_object('campaign_id',p_campaign_id,'rule_id',v_rule.rule_id,
      'resource_type',v_campaign.resource_type,'duration_days',v_campaign.duration_days),now(),now()
  );
  return jsonb_build_object('reference',v_reference,'amount_ngn',v_quote->>'amount_ngn',
    'campaign_id',p_campaign_id);
end $$;

-- Only the service role invokes this after a signed webhook or server-to-server verification.
-- Charged payments that miss their slot or become ineligible remain visible to Finance for review.
create or replace function public.confirm_sponsored_paystack_charge(
  p_reference text,p_transaction_id text,p_amount_minor bigint,
  p_environment text,p_source text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public' as $$
declare
  v_payment public.booking_payments;
  v_campaign public.sponsored_campaigns;
  v_rule public.sponsored_market_rules;
  v_count integer;
  v_reason text;
  v_eligible boolean:=false;
begin
  if auth.uid() is not null then raise exception 'Service role required'; end if;
  if nullif(p_reference,'') is null or nullif(p_transaction_id,'') is null
    or p_amount_minor<=0 or p_environment not in ('test','live')
    or p_source not in ('webhook','edge_function') then
    raise exception 'Invalid verified payment details';
  end if;
  select * into v_payment from public.booking_payments
    where paystack_reference=p_reference and purpose='sponsored_campaign' for update;
  if v_payment.id is null then raise exception 'Sponsored payment not found'; end if;
  if v_payment.currency<>'NGN' or v_payment.amount_total*100<>p_amount_minor then
    raise exception 'Sponsored payment amount or currency mismatch';
  end if;
  if v_payment.metadata->>'paystack_environment' is distinct from p_environment then
    raise exception 'Payment environment mismatch';
  end if;
  if exists(select 1 from public.booking_payments p where p.paystack_transaction_id=p_transaction_id
    and p.id<>v_payment.id) then raise exception 'Transaction already belongs to another payment'; end if;
  if v_payment.status in ('refunded','partially_refunded') then
    if v_payment.paystack_transaction_id is distinct from p_transaction_id then
      raise exception 'Payment transaction conflict'; end if;
    return jsonb_build_object('success',false,'already_processed',true,
      'requires_review',true,'status',v_payment.status);
  end if;
  if v_payment.status in ('paid','completed') then
    if v_payment.paystack_transaction_id is distinct from p_transaction_id then
      raise exception 'Payment transaction conflict';
    end if;
    select * into v_campaign from public.sponsored_campaigns
      where campaign_id=(v_payment.metadata->>'campaign_id')::uuid;
    return jsonb_build_object('success',v_campaign.status='active' and v_campaign.payment_reference=p_reference,
      'already_processed',true,'requires_review',v_campaign.status<>'active' or v_campaign.payment_reference is distinct from p_reference,
      'status',v_campaign.status);
  end if;
  select * into v_campaign from public.sponsored_campaigns
    where campaign_id=(v_payment.metadata->>'campaign_id')::uuid
      and owner_user_id=v_payment.payer_user_id for update;
  if v_campaign.campaign_id is null then raise exception 'Campaign/payment ownership mismatch'; end if;
  select * into v_rule from public.sponsored_market_rules
    where rule_id=v_campaign.rule_id for update;

  if v_campaign.payment_reference is distinct from p_reference
     or v_campaign.status<>'pending_payment' or v_payment.status<>'pending'
     or v_campaign.updated_at<=now()-interval '15 minutes' then
    v_reason:='Checkout expired or replaced before payment confirmation';
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
        and p.user_id=v_campaign.owner_user_id and p.worker_verified=true and p.worker_status='verified'
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

  update public.booking_payments set status='paid',paystack_transaction_id=p_transaction_id,
    verified_amount=p_amount_minor::numeric/100,verified_at=now(),paid_at=now(),
    verification_source=p_source,webhook_processed=true,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('paystack_domain',p_environment),
    updated_at=now() where id=v_payment.id;
  insert into public.verified_paystack_references(
    paystack_reference,booking_payment_id,verified_amount,verification_source,verified_by
  ) values(p_reference,v_payment.id,p_amount_minor::numeric/100,p_source,'sponsored-payment')
    on conflict(paystack_reference) do nothing;

  if v_reason is not null then
    update public.sponsored_campaigns set status='paused',pause_reason=v_reason,
      updated_at=now() where campaign_id=v_campaign.campaign_id
      and payment_reference=p_reference and status='pending_payment';
    return jsonb_build_object('success',false,'charged',true,'requires_review',true,
      'status','paused','error',v_reason);
  end if;
  update public.sponsored_campaigns set status='active',starts_at=now(),
    ends_at=now()+make_interval(days=>v_campaign.duration_days),pause_reason=null,
    updated_at=now() where campaign_id=v_campaign.campaign_id;
  return jsonb_build_object('success',true,'status','active',
    'campaign_id',v_campaign.campaign_id);
end $$;

create or replace function public.get_my_sponsored_resources()
returns table(resource_type text,resource_id text,label text)
language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select 'worker',p.user_id,coalesce(nullif(p.full_name,''),'My Worker profile')
  from public.profiles p where p.user_id=public.current_profile_user_id()
    and public.user_has_active_workspace(p.user_id,'worker')
    and p.worker_status='verified' and p.worker_verified=true
    and coalesce((public._worker_publication_state(p.user_id)->>'publicly_visible')::boolean,false)
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  union all
  select 'property',l.id::text,coalesce(nullif(l.title,''),'Home')
  from public.listings l join public.property_host_assignments a on a.listing_id=l.id
    and a.user_id=public.current_profile_user_id() and a.assignment_role='owner'
    and a.status='active'
  where public.current_actor_has_workspace('property_partner',null)
    and l.deleted_at is null and l.approved_at is not null and l.status='available'
    and l.availability_status='available' and l.inspection_request_id is not null
  union all
  select 'hotel',h.hotel_id::text,coalesce(nullif(h.name,''),'Hotel')
  from public.hotels h where h.owner_id=public.current_profile_user_id()
    and public.current_actor_has_workspace('property_partner',null) and h.status='active'
    and h.approved_at is not null and h.published_at is not null
$$;

create or replace function public.get_my_sponsored_offer(p_resource_type text,p_resource_id text)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public' as $$
declare v_context jsonb; v_rule public.sponsored_market_rules;
begin
  v_context:=public._my_sponsored_resource_context(p_resource_type,p_resource_id);
  if p_resource_type='worker' and
    not coalesce((public._worker_publication_state(p_resource_id)->>'publicly_visible')::boolean,false) then
    return jsonb_build_object('available',false); end if;
  if p_resource_type='property' and not exists(select 1 from public.listings l
    where l.id::text=p_resource_id and l.availability_status='available'
      and l.inspection_request_id is not null) then
    return jsonb_build_object('available',false); end if;
  if p_resource_type='hotel' and not exists(select 1 from public.hotels h
    where h.hotel_id::text=p_resource_id and h.approved_at is not null
      and h.published_at is not null) then
    return jsonb_build_object('available',false); end if;
  select * into v_rule from public.sponsored_market_rules r
    where r.resource_type=p_resource_type and r.scope_key in
      (coalesce(v_context->>'state_key','')||':'||coalesce(v_context->>'lga_key',''),'global')
    order by case when r.scope_type='lga' then 0 else 1 end limit 1;
  if v_rule.rule_id is null or not v_rule.enabled or v_rule.slot_count<1
    or v_rule.daily_price_ngn<=0 then return jsonb_build_object('available',false); end if;
  return jsonb_build_object('available',true,'daily_price_ngn',v_rule.daily_price_ngn,
    'durations',v_rule.allowed_durations,'slot_count',v_rule.slot_count,
    'market',coalesce(v_rule.lga_name,'Global'));
end $$;

create or replace function public.get_sponsored_discovery(
  p_resource_type text,p_state text default null,p_lga text default null,
  p_category text default null,p_limit integer default 6
) returns table(campaign_id uuid,resource_id text)
language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select c.campaign_id,c.resource_id from public.sponsored_campaigns c
  join public.sponsored_market_rules r on r.rule_id=c.rule_id
  where c.resource_type=p_resource_type and c.status='active'
    and (c.resource_type<>'worker' or (select auth.uid()) is not null)
    and c.starts_at<=now() and c.ends_at>now() and r.enabled and r.slot_count>0
    and (nullif(p_state,'') is null or c.state_key=public.wehouse_state_key(p_state))
    and (nullif(p_lga,'') is null or c.lga_key=public.worker_market_text_key(p_lga))
    and (nullif(p_category,'') is null or c.category_key=public.worker_market_text_key(p_category))
    and case c.resource_type
      when 'worker' then exists(select 1 from public.profiles p
        where p.user_id=c.resource_id and p.user_id=c.owner_user_id
          and p.worker_status='verified' and p.worker_verified=true
          and p.available=true
          and coalesce((public._worker_publication_state(p.user_id)->>'publicly_visible')::boolean,false)
          and public.user_has_active_workspace(p.user_id,'worker')
          and not coalesce(p.deleted,false) and not coalesce(p.suspended,false)
          and not coalesce(p.banned,false))
      when 'property' then exists(select 1 from public.listings l
        join public.property_host_assignments a on a.listing_id=l.id
          and a.user_id=c.owner_user_id and a.assignment_role='owner' and a.status='active'
        where l.id::text=c.resource_id and l.deleted_at is null
          and l.approved_at is not null and l.status='available'
          and l.availability_status='available' and l.inspection_request_id is not null
          and public.user_has_active_workspace(a.user_id,'property_partner'))
      when 'hotel' then exists(select 1 from public.hotels h
        where h.hotel_id::text=c.resource_id and h.owner_id=c.owner_user_id
          and h.status='active' and h.approved_at is not null and h.published_at is not null
          and public.user_has_active_workspace(h.owner_id,'property_partner'))
      else false end
  order by md5(c.campaign_id::text||current_date::text)
  limit least(greatest(coalesce(p_limit,6),1),12)
$$;

create or replace function public.record_my_sponsored_impression(p_campaign_id uuid,p_context text)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id(); v_id uuid;
begin
  if v_actor is null then return null; end if;
  if p_context not in ('worker_discovery','home_discovery','hotel_discovery') then
    raise exception 'Invalid placement context'; end if;
  if not exists(select 1 from public.get_sponsored_discovery(
    case p_context when 'worker_discovery' then 'worker'
      when 'home_discovery' then 'property' else 'hotel' end,null,null,null,12) d
      where d.campaign_id=p_campaign_id) then return null; end if;
  insert into public.sponsored_placements(campaign_id,viewer_user_id,context_key)
    values(p_campaign_id,v_actor,p_context)
    on conflict(campaign_id,viewer_user_id,impression_day) do update
      set presented_at=excluded.presented_at,updated_at=now()
    returning placement_id into v_id;
  return v_id;
end $$;

create or replace function public.record_my_sponsored_open(p_campaign_id uuid)
returns boolean language plpgsql security definer set search_path to 'pg_catalog','public' as $$
begin
  update public.sponsored_placements set opened_at=coalesce(opened_at,now()),updated_at=now()
    where campaign_id=p_campaign_id and viewer_user_id=public.current_profile_user_id()
      and impression_day=current_date;
  return found;
end $$;

create or replace function public.creator_get_sponsored_campaigns()
returns table(campaign_id uuid,resource_type text,resource_id text,owner_user_id text,
  status text,amount_ngn numeric,starts_at timestamptz,ends_at timestamptz,
  payment_reference text,impressions bigint,opens bigint)
language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
begin
  if not public.current_actor_has_workspace('creator',null) then
    raise exception 'Creator access required'; end if;
  return query
  select c.campaign_id,c.resource_type,c.resource_id,c.owner_user_id,c.status,
    c.amount_ngn,c.starts_at,c.ends_at,c.payment_reference,
    (select count(*) from public.sponsored_placements p where p.campaign_id=c.campaign_id),
    (select count(*) from public.sponsored_placements p where p.campaign_id=c.campaign_id
      and p.opened_at is not null)
  from public.sponsored_campaigns c order by c.created_at desc limit 100;
end $$;

create or replace function public.creator_pause_sponsored_campaign(
  p_campaign_id uuid,p_reason text,p_creator_elevation_id uuid
) returns boolean language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor text:=public.current_profile_user_id(); v_campaign public.sponsored_campaigns;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
    raise exception 'Recent Creator authentication required'; end if;
  if length(btrim(coalesce(p_reason,'')))<10 or length(p_reason)>500 then
    raise exception 'Enter a reason between 10 and 500 characters'; end if;
  select * into v_campaign from public.sponsored_campaigns
    where campaign_id=p_campaign_id and status='active' for update;
  if v_campaign.campaign_id is null then raise exception 'Active campaign not found'; end if;
  update public.sponsored_campaigns set status='paused',pause_reason=btrim(p_reason),
    updated_at=now() where campaign_id=p_campaign_id;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
    values(v_actor,'sponsored_campaign_paused','sponsored_campaign',p_campaign_id::text,
      jsonb_build_object('reason',btrim(p_reason),'payment_reference',v_campaign.payment_reference)::text,now());
  return true;
end $$;

create or replace function public.pause_sponsored_on_provider_event(
  p_reference text,p_event_type text,p_environment text,p_amount_minor bigint
) returns boolean language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_payment public.booking_payments; v_campaign public.sponsored_campaigns;
begin
  if auth.uid() is not null then raise exception 'Service role required'; end if;
  if p_event_type not in ('refund.pending','refund.processing','refund.processed','charge.dispute.create')
    or p_environment not in ('test','live') or nullif(p_reference,'') is null then
    raise exception 'Invalid provider event'; end if;
  select * into v_payment from public.booking_payments
    where paystack_reference=p_reference and purpose='sponsored_campaign' for update;
  if v_payment.id is null then return false; end if;
  if v_payment.metadata->>'paystack_environment' is distinct from p_environment then
    raise exception 'Payment environment mismatch'; end if;
  select * into v_campaign from public.sponsored_campaigns
    where campaign_id=(v_payment.metadata->>'campaign_id')::uuid for update;
  if v_campaign.campaign_id is null then raise exception 'Campaign record missing'; end if;
  update public.sponsored_campaigns set status='paused',
    pause_reason='Provider '||p_event_type||' requires Finance review',updated_at=now()
    where campaign_id=v_campaign.campaign_id and payment_reference=p_reference
      and status='active';
  if p_event_type='refund.processed' and p_amount_minor>0 then
    update public.booking_payments set
      status=case when p_amount_minor>=amount_total*100 then 'refunded'
        else 'partially_refunded' end,
      refund_processed_at=now(),updated_at=now()
      where id=v_payment.id and status in ('paid','partially_refunded');
  end if;
  return true;
end $$;

revoke all on function public.begin_my_sponsored_checkout(uuid) from public,anon;
revoke all on function public.confirm_sponsored_paystack_charge(text,text,bigint,text,text) from public,anon,authenticated;
revoke all on function public.get_my_sponsored_resources() from public,anon;
revoke all on function public.get_my_sponsored_offer(text,text) from public,anon;
revoke all on function public.get_sponsored_discovery(text,text,text,text,integer) from public,anon;
revoke all on function public.record_my_sponsored_impression(uuid,text) from public,anon;
revoke all on function public.record_my_sponsored_open(uuid) from public,anon;
revoke all on function public.creator_get_sponsored_campaigns() from public,anon;
revoke all on function public.creator_pause_sponsored_campaign(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.pause_sponsored_on_provider_event(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.begin_my_sponsored_checkout(uuid) to authenticated;
grant execute on function public.confirm_sponsored_paystack_charge(text,text,bigint,text,text) to service_role;
grant execute on function public.get_my_sponsored_resources() to authenticated;
grant execute on function public.get_my_sponsored_offer(text,text) to authenticated;
grant execute on function public.get_sponsored_discovery(text,text,text,text,integer) to authenticated;
grant execute on function public.record_my_sponsored_impression(uuid,text) to authenticated;
grant execute on function public.record_my_sponsored_open(uuid) to authenticated;
grant execute on function public.creator_get_sponsored_campaigns() to authenticated;
grant execute on function public.creator_pause_sponsored_campaign(uuid,text,uuid) to authenticated;
grant execute on function public.pause_sponsored_on_provider_event(text,text,text,bigint) to service_role;
