-- Creator-controlled withdrawal safety, enforced for Service Workers and Property
-- Partners alike: a cooldown after a payout account changes, plus daily count and
-- amount limits. A rejected insert rolls the whole request back, including the
-- wallet reservation made earlier in the same transaction. No policy means no extra limit.

create or replace function private.validate_withdrawal_controls_policy()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if new.policy_key<>'withdrawal_controls' then return new; end if;
  if coalesce((new.value->>'new_account_cooldown_hours')::numeric,-1) not between 0 and 720
     or coalesce((new.value->>'daily_max_count')::integer,-1) not between 0 and 50
     or coalesce((new.value->>'daily_max_amount')::numeric,-1) not between 0 and 1000000000 then
    raise exception 'Withdrawal controls are outside the allowed range';
  end if;
  return new;
end
$$;

drop trigger if exists validate_withdrawal_controls_policy on public.creator_policy_versions;
create trigger validate_withdrawal_controls_policy
before insert or update of value on public.creator_policy_versions
for each row execute function private.validate_withdrawal_controls_policy();

create or replace function private.enforce_withdrawal_controls()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_policy jsonb;
  v_hours numeric;
  v_max_count integer;
  v_max_amount numeric;
  v_changed timestamptz;
  v_count integer;
  v_sum numeric;
begin
  select policy.value into v_policy
  from public.creator_policy_versions policy
  where policy.policy_key='withdrawal_controls' and policy.scope_type='global'
    and policy.scope_key='*' and policy.status='active'
    and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc limit 1;
  if v_policy is null then return new; end if;

  v_hours:=coalesce((v_policy->>'new_account_cooldown_hours')::numeric,0);
  v_max_count:=coalesce((v_policy->>'daily_max_count')::integer,0);
  v_max_amount:=coalesce((v_policy->>'daily_max_amount')::numeric,0);

  if v_hours>0 and new.bank_account_id is not null then
    select greatest(created_at,coalesce(activated_at,created_at),updated_at)
    into v_changed from public.bank_accounts where id=new.bank_account_id;
    if v_changed is not null and v_changed>now()-make_interval(hours=>v_hours::integer) then
      raise exception 'For your security, withdrawals to a newly added payout account unlock % hours after it was added',v_hours::integer;
    end if;
  end if;

  if v_max_count>0 or v_max_amount>0 then
    select count(*),coalesce(sum(amount),0) into v_count,v_sum
    from public.withdrawals
    where wallet_id=new.wallet_id and created_at>now()-interval '24 hours'
      and status in('awaiting_review','processing','paid');
    if v_max_count>0 and v_count>=v_max_count then
      raise exception 'Daily withdrawal limit reached. Try again later.';
    end if;
    if v_max_amount>0 and v_sum+new.amount>v_max_amount then
      raise exception 'This would pass the daily withdrawal amount limit.';
    end if;
  end if;
  return new;
end
$$;
revoke all on function private.enforce_withdrawal_controls() from public,anon,authenticated;

drop trigger if exists enforce_withdrawal_controls on public.withdrawals;
create trigger enforce_withdrawal_controls
before insert on public.withdrawals
for each row execute function private.enforce_withdrawal_controls();

create or replace function public.creator_get_withdrawal_controls()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v jsonb;
begin
  if not exists(select 1 from public.profiles
    where user_id=public.current_profile_user_id() and role='creator'
      and not coalesce(deleted,false) and not coalesce(suspended,false)
      and not coalesce(banned,false)) then
    raise exception 'Creator access required';
  end if;
  select value into v from public.creator_policy_versions
  where policy_key='withdrawal_controls' and scope_type='global' and scope_key='*'
    and status='active' and effective_from<=now()
    and (effective_until is null or effective_until>now())
  order by effective_from desc limit 1;
  return coalesce(v,jsonb_build_object(
    'new_account_cooldown_hours',0,'daily_max_count',0,'daily_max_amount',0));
end
$$;
revoke all on function public.creator_get_withdrawal_controls() from public,anon;
grant execute on function public.creator_get_withdrawal_controls() to authenticated,service_role;
