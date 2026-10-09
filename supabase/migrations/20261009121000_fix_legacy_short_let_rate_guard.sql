-- Treat legacy bookings without an explicit rate type as standard during operational updates.
-- Genuine changes to the booked rate remain forbidden once payment has begun.
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
