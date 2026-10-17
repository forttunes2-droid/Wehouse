-- Optional fixed WeHouse fee per product. Creator-controlled, versioned, off unless a
-- Creator publishes an enabled policy. No amount is hard-coded anywhere.

create or replace function private.validate_fixed_fee_policy()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if new.policy_key not like 'fixed_fee\_%' then return new; end if;
  if new.policy_key not in('fixed_fee_worker','fixed_fee_hotel','fixed_fee_short_let','fixed_fee_long_let') then
    raise exception 'Unknown fixed fee policy';
  end if;
  if jsonb_typeof(new.value->'enabled')<>'boolean'
     or coalesce((new.value->>'amount')::numeric,-1) not between 0 and 100000 then
    raise exception 'Fixed fee needs enabled true/false and an amount from 0 to 100000';
  end if;
  return new;
end
$$;

drop trigger if exists validate_fixed_fee_policy on public.creator_policy_versions;
create trigger validate_fixed_fee_policy
before insert or update of value on public.creator_policy_versions
for each row execute function private.validate_fixed_fee_policy();

create or replace function public.fixed_fee_amount(p_type text)
returns numeric
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_key text:='fixed_fee_'||case lower(btrim(coalesce(p_type,'')))
    when 'service_worker' then 'worker' else lower(btrim(coalesce(p_type,''))) end;
  v_value jsonb;
begin
  select policy.value into v_value
  from public.creator_policy_versions policy
  where policy.policy_key=v_key and policy.scope_type='global' and policy.scope_key='*'
    and policy.status='active' and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc limit 1;
  if v_value is null or coalesce((v_value->>'enabled')::boolean,false) is not true then
    return 0;
  end if;
  return round(greatest((v_value->>'amount')::numeric,0),2);
end
$$;
revoke all on function public.fixed_fee_amount(text) from public,anon,authenticated;
grant execute on function public.fixed_fee_amount(text) to service_role;

-- Percentage commission plus the optional fixed fee, never more than the amount.
create or replace function public.calculate_commission(p_amount numeric,p_type text default 'worker')
returns numeric
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_key text;
  v_percent numeric;
begin
  v_key:=case lower(btrim(coalesce(p_type,'')))
    when 'worker' then 'commission_worker'
    when 'service_worker' then 'commission_worker'
    when 'hotel' then 'commission_hotel'
    when 'short_let' then 'commission_short_let'
    when 'long_let' then 'commission_long_let'
    else null
  end;
  if v_key is null then
    raise exception 'Commission type must be Service Worker, Hotel, Short Let or Long Let';
  end if;
  select (policy.value->>'percent')::numeric into v_percent
  from public.creator_policy_versions policy
  where policy.policy_key=v_key and policy.scope_type='global' and policy.scope_key='*'
    and policy.status='active' and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc limit 1;
  if v_percent is null or v_percent<0 or v_percent>50 then
    raise exception 'Active Creator commission policy is missing or invalid';
  end if;
  return least(round(p_amount*v_percent/100+public.fixed_fee_amount(p_type),2),greatest(p_amount,0));
end
$$;
revoke all on function public.calculate_commission(numeric,text) from public;
revoke execute on function public.calculate_commission(numeric,text) from anon, authenticated;
grant execute on function public.calculate_commission(numeric,text) to service_role;

create or replace function public.creator_get_fixed_fees()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if not exists(select 1 from public.profiles
    where user_id=public.current_profile_user_id() and role='creator'
      and not coalesce(deleted,false) and not coalesce(suspended,false)
      and not coalesce(banned,false)) then
    raise exception 'Creator access required';
  end if;
  return coalesce((
    select jsonb_object_agg(k,jsonb_build_object(
      'enabled',coalesce((p.value->>'enabled')::boolean,false),
      'amount',coalesce((p.value->>'amount')::numeric,0)))
    from unnest(array['worker','hotel','short_let','long_let']) k
    left join lateral (
      select value from public.creator_policy_versions
      where policy_key='fixed_fee_'||k and scope_type='global' and scope_key='*'
        and status='active' and effective_from<=now()
        and (effective_until is null or effective_until>now())
      order by effective_from desc limit 1
    ) p on true
  ),'{}'::jsonb);
end
$$;
revoke all on function public.creator_get_fixed_fees() from public,anon;
grant execute on function public.creator_get_fixed_fees() to authenticated,service_role;
