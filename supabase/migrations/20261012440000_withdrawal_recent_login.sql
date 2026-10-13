-- Withdrawals need a recent sign-in (default 10 minutes). The Creator can change or turn it off
-- with require_recent_login_minutes in the withdrawal_controls policy (0 = off).

create or replace function private.validate_withdrawal_controls_policy()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if new.policy_key<>'withdrawal_controls' then return new; end if;
  if coalesce((new.value->>'new_account_cooldown_hours')::numeric,-1) not between 0 and 720
     or coalesce((new.value->>'daily_max_count')::integer,-1) not between 0 and 50
     or coalesce((new.value->>'daily_max_amount')::numeric,-1) not between 0 and 1000000000
     or coalesce((new.value->>'require_recent_login_minutes')::numeric,10) not between 0 and 1440 then
    raise exception 'Withdrawal controls are outside the allowed range';
  end if;
  return new;
end
$$;

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
  v_minutes numeric:=10;
  v_session_id uuid;
  v_session_at timestamptz;
begin
  select policy.value into v_policy
  from public.creator_policy_versions policy
  where policy.policy_key='withdrawal_controls' and policy.scope_type='global'
    and policy.scope_key='*' and policy.status='active'
    and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc limit 1;
  v_minutes:=coalesce((v_policy->>'require_recent_login_minutes')::numeric,10);
  -- A signed-in browser session older than the limit must sign in again before money leaves.
  -- Server-side calls without a user session id are not affected.
  if v_minutes>0 and coalesce(auth.role(),'')='authenticated' then
    begin
      v_session_id:=nullif(auth.jwt()->>'session_id','')::uuid;
    exception when others then v_session_id:=null;
    end;
    if v_session_id is not null then
      select created_at into v_session_at from auth.sessions where id=v_session_id;
      if v_session_at is not null and v_session_at<now()-make_interval(mins=>v_minutes::integer) then
        raise exception 'Please confirm your password or sign in again before withdrawing' using errcode='28000';
      end if;
    end if;
  end if;
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
