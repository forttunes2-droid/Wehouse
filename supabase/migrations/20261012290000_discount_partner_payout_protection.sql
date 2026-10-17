-- The partner is paid on the price after the host's own discount. WeHouse's share of a discount
-- comes out of WeHouse's commission, never out of the partner's payout, and can never exceed
-- the commission WeHouse earns on that booking.
alter table public.reservations
  add column if not exists short_stay_wehouse_discount_percent_snapshot numeric(5,2) not null default 0,
  add column if not exists short_stay_partner_rent_snapshot numeric(12,2);

create or replace function public.short_let_discount_breakdown(p_listing_id uuid,p_on date,p_host_side_percent numeric default 0)
returns table(partner_percent numeric,wehouse_percent numeric)
language sql stable security definer set search_path to 'pg_catalog','public' as $$
  with raw as (
    select least(50,coalesce(p_host_side_percent,0)+coalesce(sum(d.percent) filter (where d.funded_by='host'),0)) as partner,
           coalesce(sum(d.percent) filter (where d.funded_by='wehouse'),0) as wehouse
    from public.listing_discounts d
    join public.listings l on l.id=p_listing_id
    where d.active and d.starts_on<=p_on and (d.ends_on is null or d.ends_on>=p_on)
      and (d.listing_id=l.id or d.state_key=public.wehouse_state_key(l.state))
  )
  select partner,
    greatest(0,least(wehouse,public.wehouse_discount_ceiling(),50-partner,
      floor((100-partner)*public.wehouse_discount_ceiling())/100))
  from raw $$;

create or replace function public.listing_discount_percent(p_listing_id uuid, p_on date default current_date)
returns numeric language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select b.partner_percent+b.wehouse_percent from public.short_let_discount_breakdown(p_listing_id,p_on,0) b $$;

-- Money split for one Short Let stay: the partner keeps partner_rent minus commission; WeHouse receives the rest.
create or replace function public.short_let_payout_split(p_total numeric,p_partner_rent numeric,p_rate numeric)
returns table(amount_commission numeric,amount_payee numeric)
language sql immutable set search_path to 'pg_catalog','public' as $$
  select p_total-(p_partner_rent-round(p_partner_rent*p_rate/100,2)),
         p_partner_rent-round(p_partner_rent*p_rate/100,2) $$;

create or replace function public.apply_short_let_partner_payout()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare r public.reservations; s record;
begin
  if new.subject_type is distinct from 'short_let_stay' then return new; end if;
  select * into r from public.reservations where id::text=new.subject_id;
  if r.id is null or coalesce(r.short_stay_wehouse_discount_percent_snapshot,0)<=0
     or r.short_stay_partner_rent_snapshot is null or r.short_stay_partner_rent_snapshot<=new.amount_total then
    return new;
  end if;
  select * into s from public.short_let_payout_split(new.amount_total,r.short_stay_partner_rent_snapshot,new.commission_rate);
  new.amount_commission:=s.amount_commission;
  new.amount_payee:=s.amount_payee;
  return new;
end $$;
drop trigger if exists payment_protection_short_let_partner_payout on public.payment_protection_transactions;
create trigger payment_protection_short_let_partner_payout before insert on public.payment_protection_transactions
  for each row execute function public.apply_short_let_partner_payout();

revoke all on function public.short_let_discount_breakdown(uuid,date,numeric),public.apply_short_let_partner_payout() from public,anon,authenticated;
grant execute on function public.short_let_discount_breakdown(uuid,date,numeric) to service_role;
revoke all on function public.short_let_payout_split(numeric,numeric,numeric) from public;
grant execute on function public.short_let_payout_split(numeric,numeric,numeric) to authenticated,service_role;
grant execute on function public.listing_discount_percent(uuid,date) to anon,authenticated,service_role;

-- One price pipeline: host and WeHouse listing discounts stack with the non-refundable rate (cap 50%).
-- The reservation trigger remains the only place the nightly rate and rent total are snapshotted; booked stays are never re-priced.
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
  v_partner numeric(5,2):=0;
  v_wehouse numeric(5,2):=0;
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
     and lower(btrim(coalesce(old.short_stay_rate_type,'standard'))) is distinct from new.short_stay_rate_type
     and not (old.status='payment_pending' and old.reservation_fee_status='payment_pending') then
    raise exception 'The booked Short Let rate cannot be changed';
  end if;

  -- Operational updates (for example, host handover) must never re-price a
  -- booked stay using today's listing price or today's policy. Only a pending
  -- checkout rate change or an explicitly changed stay date may be re-quoted.
  if tg_op='UPDATE'
     and old.nightly_rate_snapshot is not null
     and old.stay_rent_total is not null
     and new.stay_check_in is not distinct from old.stay_check_in
     and new.stay_check_out is not distinct from old.stay_check_out
     and lower(btrim(coalesce(old.short_stay_rate_type,'standard'))) is not distinct from new.short_stay_rate_type then
    new.stay_nights:=coalesce(old.stay_nights,v_nights);
    new.nightly_rate_snapshot:=old.nightly_rate_snapshot;
    new.stay_rent_total:=old.stay_rent_total;
    new.short_stay_discount_percent_snapshot:=old.short_stay_discount_percent_snapshot;
    new.short_stay_cancellation_policy_snapshot:=old.short_stay_cancellation_policy_snapshot;
    return new;
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
  select b.partner_percent,b.wehouse_percent into v_partner,v_wehouse
  from public.short_let_discount_breakdown(v_listing.id,new.stay_check_in,v_discount) b;
  v_discount:=v_partner+v_wehouse;
  new.short_stay_wehouse_discount_percent_snapshot:=v_wehouse;
  new.short_stay_partner_rent_snapshot:=round(round(v_listing.price*(1-v_partner/100),2)*v_nights,2);

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
  v_discount:=(select b.partner_percent+b.wehouse_percent from public.short_let_discount_breakdown(v_listing.id,p_check_in,v_discount) b);
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
