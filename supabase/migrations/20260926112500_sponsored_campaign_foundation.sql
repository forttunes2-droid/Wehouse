-- Generic Sponsored marketplace foundation.
-- Sponsored is paid visibility only. It never grants trust, verification,
-- organic ranking, workspace authority, ownership or payout authority.

create table if not exists public.sponsored_market_rules(
  rule_id uuid primary key default gen_random_uuid(),
  resource_type text not null
    check(resource_type in ('worker','property','hotel')),
  scope_type text not null default 'global'
    check(scope_type in ('global','lga')),
  scope_key text not null,
  state_name text,
  state_key text,
  lga_name text,
  lga_key text,
  enabled boolean not null default false,
  slot_count integer not null default 0
    check(slot_count between 0 and 12),
  daily_price_ngn numeric(12,2) not null default 0
    check(daily_price_ngn>=0),
  allowed_durations integer[] not null default array[7,14,30]::integer[],
  updated_by text not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(
    (scope_type='global' and scope_key='global' and state_key is null and lga_key is null)
    or
    (scope_type='lga' and nullif(state_key,'') is not null and nullif(lga_key,'') is not null)
  ),
  unique(resource_type,scope_key)
);

create table if not exists public.sponsored_campaigns(
  campaign_id uuid primary key default gen_random_uuid(),
  resource_type text not null
    check(resource_type in ('worker','property','hotel')),
  resource_id text not null,
  owner_user_id text not null references public.profiles(user_id),
  state_name text,
  state_key text,
  lga_name text,
  lga_key text,
  category_key text,
  duration_days integer not null check(duration_days between 1 and 90),
  amount_ngn numeric(12,2) not null check(amount_ngn>=0),
  status text not null default 'draft'
    check(status in ('draft','pending_payment','active','paused','expired','cancelled')),
  payment_reference text,
  starts_at timestamptz,
  ends_at timestamptz,
  pause_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(
    (status='active' and starts_at is not null and ends_at is not null and ends_at>starts_at)
    or status<>'active'
  )
);

create table if not exists public.sponsored_placements(
  placement_id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.sponsored_campaigns(campaign_id) on delete cascade,
  viewer_user_id text not null references public.profiles(user_id) on delete cascade,
  context_key text not null,
  impression_day date not null default current_date,
  presented_at timestamptz not null default now(),
  opened_at timestamptz,
  conversion_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,viewer_user_id,impression_day)
);

create index if not exists sponsored_campaigns_market_idx
  on public.sponsored_campaigns(resource_type,status,state_key,lga_key,ends_at);
create index if not exists sponsored_campaigns_owner_idx
  on public.sponsored_campaigns(owner_user_id,created_at desc);
create index if not exists sponsored_placements_campaign_time_idx
  on public.sponsored_placements(campaign_id,presented_at desc);

alter table public.sponsored_market_rules enable row level security;
alter table public.sponsored_campaigns enable row level security;
alter table public.sponsored_placements enable row level security;

revoke all on table public.sponsored_market_rules from public,anon,authenticated;
revoke all on table public.sponsored_campaigns from public,anon,authenticated;
revoke all on table public.sponsored_placements from public,anon,authenticated;
grant all on table public.sponsored_market_rules to service_role;
grant all on table public.sponsored_campaigns to service_role;
grant all on table public.sponsored_placements to service_role;

create or replace function public.creator_set_sponsored_market_rule(
  p_resource_type text,
  p_scope_type text,
  p_state text,
  p_lga text,
  p_enabled boolean,
  p_slot_count integer,
  p_daily_price_ngn numeric,
  p_allowed_durations integer[],
  p_creator_elevation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_scope_type text:=lower(btrim(coalesce(p_scope_type,'global')));
  v_state_key text;
  v_lga_key text;
  v_scope_key text;
  v_durations integer[];
  v_row public.sponsored_market_rules;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
    raise exception 'Recent Creator authentication required';
  end if;
  if p_resource_type not in ('worker','property','hotel') then
    raise exception 'Choose Worker, Property or Hotel';
  end if;
  if v_scope_type not in ('global','lga') then raise exception 'Choose Global or LGA scope'; end if;
  if coalesce(p_slot_count,-1)<0 or p_slot_count>12 then raise exception 'Sponsored slots must be between 0 and 12'; end if;
  if coalesce(p_daily_price_ngn,-1)<0 then raise exception 'Sponsored price cannot be negative'; end if;

  select array_agg(distinct duration order by duration)
  into v_durations
  from unnest(coalesce(p_allowed_durations,array[]::integer[])) duration
  where duration between 1 and 90;

  if coalesce(array_length(v_durations,1),0)=0 then
    raise exception 'Add at least one campaign duration between 1 and 90 days';
  end if;

  if v_scope_type='global' then
    v_scope_key:='global';
    v_state_key:=null;
    v_lga_key:=null;
  else
    v_state_key:=public.wehouse_state_key(p_state);
    v_lga_key:=public.worker_market_text_key(p_lga);
    if nullif(v_state_key,'') is null or nullif(v_lga_key,'') is null then
      raise exception 'State and LGA are required for an LGA Sponsored rule';
    end if;
    v_scope_key:=v_state_key||':'||v_lga_key;
  end if;

  insert into public.sponsored_market_rules(
    resource_type,scope_type,scope_key,state_name,state_key,lga_name,lga_key,
    enabled,slot_count,daily_price_ngn,allowed_durations,updated_by,created_at,updated_at
  ) values(
    p_resource_type,v_scope_type,v_scope_key,
    case when v_scope_type='lga' then btrim(p_state) end,v_state_key,
    case when v_scope_type='lga' then btrim(p_lga) end,v_lga_key,
    coalesce(p_enabled,false),p_slot_count,p_daily_price_ngn,v_durations,
    v_actor,now(),now()
  )
  on conflict(resource_type,scope_key) do update set
    scope_type=excluded.scope_type,
    state_name=excluded.state_name,
    state_key=excluded.state_key,
    lga_name=excluded.lga_name,
    lga_key=excluded.lga_key,
    enabled=excluded.enabled,
    slot_count=excluded.slot_count,
    daily_price_ngn=excluded.daily_price_ngn,
    allowed_durations=excluded.allowed_durations,
    updated_by=v_actor,
    updated_at=now()
  returning * into v_row;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(
    v_actor,'sponsored_market_rule_updated','sponsored_market_rule',v_row.rule_id::text,
    jsonb_build_object(
      'resource_type',v_row.resource_type,'scope_type',v_row.scope_type,
      'state',v_row.state_name,'lga',v_row.lga_name,'enabled',v_row.enabled,
      'slot_count',v_row.slot_count,'daily_price_ngn',v_row.daily_price_ngn,
      'allowed_durations',v_row.allowed_durations
    )::text,now()
  );

  return to_jsonb(v_row);
end
$$;

create or replace function public.creator_get_sponsored_market_rules()
returns setof public.sponsored_market_rules
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select rule.*
  from public.sponsored_market_rules rule
  where public.current_actor_has_workspace('creator',null)
  order by rule.resource_type,rule.scope_type,rule.state_name,rule.lga_name
$$;

create or replace function public._my_sponsored_resource_context(
  p_resource_type text,p_resource_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_profile public.profiles;
  v_listing public.listings;
  v_hotel public.hotels;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  if p_resource_type='worker' then
    if p_resource_id<>v_actor then raise exception 'You can promote only your own Worker profile'; end if;
    select * into v_profile
    from public.profiles
    where user_id=v_actor
      and public.user_has_active_workspace(user_id,'worker')
      and worker_status='verified' and worker_verified=true
      and not coalesce(deleted,false)
      and not coalesce(suspended,false)
      and not coalesce(banned,false);
    if v_profile.user_id is null then raise exception 'A live Service Worker profile is required'; end if;
    return jsonb_build_object(
      'state_name',v_profile.state,
      'state_key',public.wehouse_state_key(v_profile.state),
      'lga_name',coalesce(nullif(v_profile.local_government,''),v_profile.city),
      'lga_key',public.worker_market_text_key(coalesce(nullif(v_profile.local_government,''),v_profile.city)),
      'category_key',public.worker_market_text_key(v_profile.worker_occupation)
    );
  elsif p_resource_type='property' then
    select l.* into v_listing
    from public.listings l
    join public.property_host_assignments owner_assignment
      on owner_assignment.listing_id=l.id
     and owner_assignment.user_id=v_actor
     and owner_assignment.assignment_role='owner'
     and owner_assignment.status='active'
    where l.id=p_resource_id::uuid
      and l.deleted_at is null
      and l.approved_at is not null
      and l.status in ('available','unavailable','reserved','occupied','maintenance','closed');
    if v_listing.id is null then raise exception 'A live property you own is required'; end if;
    return jsonb_build_object(
      'state_name',v_listing.state,
      'state_key',public.wehouse_state_key(v_listing.state),
      'lga_name',coalesce(nullif(v_listing.city,''),v_listing.area),
      'lga_key',public.worker_market_text_key(coalesce(nullif(v_listing.city,''),v_listing.area)),
      'category_key',public.worker_market_text_key(v_listing.sub_type)
    );
  elsif p_resource_type='hotel' then
    select * into v_hotel
    from public.hotels
    where hotel_id=p_resource_id::integer
      and owner_id=v_actor
      and status='active';
    if v_hotel.hotel_id is null then raise exception 'An active hotel you own is required'; end if;
    return jsonb_build_object(
      'state_name',v_hotel.state,
      'state_key',public.wehouse_state_key(v_hotel.state),
      'lga_name',coalesce(nullif(v_hotel.city,''),v_hotel.area),
      'lga_key',public.worker_market_text_key(coalesce(nullif(v_hotel.city,''),v_hotel.area)),
      'category_key','hotel'
    );
  end if;

  raise exception 'Unsupported Sponsored resource';
end
$$;

create or replace function public.quote_my_sponsored_campaign(
  p_resource_type text,
  p_resource_id text,
  p_duration_days integer
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_context jsonb;
  v_rule public.sponsored_market_rules;
  v_amount numeric(12,2);
begin
  if p_resource_type not in ('worker','property','hotel') then raise exception 'Unsupported Sponsored resource'; end if;
  v_context:=public._my_sponsored_resource_context(p_resource_type,p_resource_id);

  select * into v_rule
  from public.sponsored_market_rules rule
  where rule.resource_type=p_resource_type
    and rule.scope_key in (
      coalesce(v_context->>'state_key','')||':'||coalesce(v_context->>'lga_key',''),
      'global'
    )
  order by case when rule.scope_type='lga' then 0 else 1 end
  limit 1;

  if v_rule.rule_id is null or not v_rule.enabled then
    raise exception 'Sponsored placement is not open for this market';
  end if;
  if not p_duration_days=any(v_rule.allowed_durations) then
    raise exception 'Choose an available Sponsored duration';
  end if;
  if v_rule.slot_count<=0 then raise exception 'No Sponsored slots are open in this market'; end if;

  v_amount:=round(v_rule.daily_price_ngn*p_duration_days,2);
  return jsonb_build_object(
    'resource_type',p_resource_type,
    'resource_id',p_resource_id,
    'state',v_context->>'state_name',
    'lga',v_context->>'lga_name',
    'category',v_context->>'category_key',
    'duration_days',p_duration_days,
    'amount_ngn',v_amount,
    'slot_count',v_rule.slot_count,
    'rule_id',v_rule.rule_id
  );
end
$$;

create or replace function public.prepare_my_sponsored_campaign(
  p_resource_type text,
  p_resource_id text,
  p_duration_days integer
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_quote jsonb;
  v_context jsonb;
  v_campaign public.sponsored_campaigns;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  v_quote:=public.quote_my_sponsored_campaign(p_resource_type,p_resource_id,p_duration_days);
  v_context:=public._my_sponsored_resource_context(p_resource_type,p_resource_id);

  insert into public.sponsored_campaigns(
    resource_type,resource_id,owner_user_id,state_name,state_key,lga_name,lga_key,
    category_key,duration_days,amount_ngn,status,created_at,updated_at
  ) values(
    p_resource_type,p_resource_id,v_actor,
    v_context->>'state_name',v_context->>'state_key',
    v_context->>'lga_name',v_context->>'lga_key',
    v_context->>'category_key',p_duration_days,
    (v_quote->>'amount_ngn')::numeric,'draft',now(),now()
  ) returning * into v_campaign;

  return jsonb_build_object(
    'campaign_id',v_campaign.campaign_id,
    'status',v_campaign.status,
    'amount_ngn',v_campaign.amount_ngn,
    'duration_days',v_campaign.duration_days,
    'resource_type',v_campaign.resource_type,
    'resource_id',v_campaign.resource_id
  );
end
$$;

create or replace function public.get_my_sponsored_campaigns()
returns setof public.sponsored_campaigns
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select campaign.*
  from public.sponsored_campaigns campaign
  where campaign.owner_user_id=public.current_profile_user_id()
  order by campaign.created_at desc
$$;

-- Retire the old Pro=>Sponsored coupling. Generic Sponsored campaigns will be
-- enabled only after checkout/activation is connected to sponsored_campaigns.
update public.platform_settings
set value='false',updated_at=now()
where key='worker_featured_sales_enabled';

revoke all on function public.creator_set_sponsored_market_rule(text,text,text,text,boolean,integer,numeric,integer[],uuid) from public,anon,authenticated;
revoke all on function public.creator_get_sponsored_market_rules() from public,anon;
revoke all on function public._my_sponsored_resource_context(text,text) from public,anon,authenticated;
revoke all on function public.quote_my_sponsored_campaign(text,text,integer) from public,anon;
revoke all on function public.prepare_my_sponsored_campaign(text,text,integer) from public,anon;
revoke all on function public.get_my_sponsored_campaigns() from public,anon;

grant execute on function public.creator_set_sponsored_market_rule(text,text,text,text,boolean,integer,numeric,integer[],uuid) to authenticated,service_role;
grant execute on function public.creator_get_sponsored_market_rules() to authenticated,service_role;
grant execute on function public.quote_my_sponsored_campaign(text,text,integer) to authenticated,service_role;
grant execute on function public.prepare_my_sponsored_campaign(text,text,integer) to authenticated,service_role;
grant execute on function public.get_my_sponsored_campaigns() to authenticated,service_role;

comment on table public.sponsored_market_rules is
  'Creator-owned Sponsored availability, slots and pricing for Worker, Property and Hotel markets.';
comment on table public.sponsored_campaigns is
  'Paid-visibility campaign record. Drafts have no discovery effect until verified payment activates them.';
