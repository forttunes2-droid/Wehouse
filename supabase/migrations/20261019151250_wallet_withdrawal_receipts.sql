-- Keep retries on the canonical withdrawal, including after Finance finalizes it.
-- Additive: existing requests and their financial history remain intact.

-- Reapply the canonical attribution contract from 20260927072525 on lagging
-- environments. Backfill uses existing provenance; ambiguous rows stop this
-- migration at NOT NULL rather than assigning them to a guessed wallet.
-- One wallet may have one payout awaiting Finance or Paystack at a time.
-- The wallet row is locked by the request RPCs. This index is the durable
-- backstop for concurrent devices, lost responses and legacy RPC callers.
-- Finalized payouts do not block a later request.
create unique index if not exists withdrawals_one_open_per_wallet
  on public.withdrawals (wallet_id)
  where status in ('awaiting_review', 'processing');

-- A profile can own both a Worker wallet and a Property Partner wallet.
-- Attribute each movement to its actual wallet so workspace history never
-- depends on the profile alone. Existing movements retain their provenance.
alter table public.wallet_transactions add column if not exists wallet_id uuid
  references public.wallets(id);

create or replace function public.attribute_wallet_transaction() returns trigger
language plpgsql set search_path = public as $$
declare
  v_owner text;
  v_type text;
  v_protection_id uuid;
begin
  if new.wallet_id is null and new.metadata->>'wallet_id' ~* '^[0-9a-f-]{36}$' then
    new.wallet_id := (new.metadata->>'wallet_id')::uuid;
  end if;

  if new.wallet_id is null and new.reference_type = 'withdrawal'
      and new.reference_id ~* '^[0-9a-f-]{36}$' then
    select wallet_id into new.wallet_id from public.withdrawals
    where id = new.reference_id::uuid;
  end if;

  if new.wallet_id is null then
    if new.transaction_type = 'canonical_protected_release' then
      v_protection_id := (new.metadata->>'payment_protection_id')::uuid;
      select case when subject_type = 'worker_booking' then 'worker'
        else 'property_partner' end into v_type
      from public.payment_protection_transactions where id = v_protection_id;
    elsif new.transaction_type in ('canonical_installment_settlement',
      'property_earning_pending', 'property_earning_released',
      'property_earning_reversed') then
      v_type := 'property_partner';
    end if;
    if v_type is not null then
      select id into new.wallet_id from public.wallets
      where owner_id = new.user_id and owner_type = v_type;
    end if;
  end if;

  if new.wallet_id is null then
    raise exception 'Wallet attribution is required for transaction %', new.transaction_type;
  end if;
  select owner_id into v_owner from public.wallets where id = new.wallet_id;
  if v_owner is distinct from new.user_id then
    raise exception 'Wallet transaction owner mismatch';
  end if;
  return new;
end $$;

drop trigger if exists attribute_wallet_transaction on public.wallet_transactions;
create trigger attribute_wallet_transaction before insert or update of wallet_id
  on public.wallet_transactions for each row
  execute function public.attribute_wallet_transaction();

-- Backfill from durable receipts and withdrawal references first. The type
-- fallback covers earlier property movements created before receipt tables.
with attributed as (
select t.id, coalesce(
  (select r.wallet_id from public.canonical_wallet_release_receipts r
    where r.wallet_transaction_id = t.id),
  (select r.wallet_id from public.canonical_unprotected_settlement_receipts r
    where r.wallet_transaction_id = t.id),
  (select w.wallet_id from public.withdrawals w
    where t.reference_type = 'withdrawal' and t.reference_id = w.id::text),
  (select w.id from public.wallets w
    where w.id::text = t.metadata->>'wallet_id' and w.owner_id = t.user_id),
  (select w.id from public.wallets w
    where w.owner_id = t.user_id and w.owner_type = 'property_partner'
      and t.transaction_type in ('canonical_installment_settlement',
        'property_earning_pending', 'property_earning_released',
        'property_earning_reversed'))
) as wallet_id from public.wallet_transactions t where t.wallet_id is null
)
update public.wallet_transactions t set wallet_id = a.wallet_id
from attributed a where t.id = a.id and a.wallet_id is not null;

alter table public.wallet_transactions alter column wallet_id set not null;

create index if not exists wallet_transactions_wallet_recent
  on public.wallet_transactions(wallet_id, created_at desc);

alter table public.withdrawals add column if not exists client_request_id uuid;
create unique index if not exists withdrawals_one_open_per_wallet
  on public.withdrawals(wallet_id) where status in ('awaiting_review','processing');
create unique index if not exists withdrawals_wallet_client_request
  on public.withdrawals(wallet_id, client_request_id)
  where client_request_id is not null;

-- Both existing entrypoints reject retired payout destinations, including old clients.
CREATE OR REPLACE FUNCTION public.request_my_property_partner_withdrawal(p_amount numeric, p_bank_account_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id text:=public.current_profile_user_id(); v_wallet public.wallets;
  v_bank public.bank_accounts; v_withdrawal_id uuid; v_min numeric:=5000;
  v_new_balance numeric;
begin
  if v_user_id is null or not public.current_actor_has_workspace('property_partner',null)
    then raise exception 'Property Partner workspace required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Amount must be greater than 0'; end if;
  select * into v_bank from public.bank_accounts
  where id=p_bank_account_id and user_id=v_user_id and verified_at is not null and is_active limit 1;
  if v_bank.id is null or nullif(btrim(coalesce(v_bank.paystack_recipient_code,'')),'') is null
    then raise exception 'Choose a Paystack-verified payout account'; end if;
  select nullif(trim(value),'')::numeric into v_min from public.platform_settings
  where key in('wallet_minimum_withdrawal','min_withdrawal') and coalesce(is_active,true)
  order by case key when 'wallet_minimum_withdrawal' then 0 else 1 end limit 1;
  v_min:=coalesce(v_min,5000);
  if p_amount<v_min then raise exception 'Minimum withdrawal is ₦%',v_min; end if;
  select * into v_wallet from public.wallets
  where owner_id=v_user_id and owner_type='property_partner' for update;
  if v_wallet.id is null then raise exception 'Wallet not found'; end if;
  if coalesce(v_wallet.is_frozen,false) then raise exception 'Wallet is frozen'; end if;
  if p_amount>coalesce(v_wallet.available_balance,0)
    then raise exception 'Insufficient available balance'; end if;
  v_new_balance:=v_wallet.available_balance-p_amount;
  update public.wallets set available_balance=v_new_balance,
    frozen_balance=coalesce(frozen_balance,0)+p_amount,updated_at=now()
  where id=v_wallet.id;
  insert into public.withdrawals(
    wallet_id,amount,status,bank_name,bank_account_number,bank_account_name,
    bank_account_id,payout_recipient_code,snapshot_bank_name,
    snapshot_bank_account_number,snapshot_bank_account_name,snapshot_bank_code,
    created_at,updated_at
  ) values(
    v_wallet.id,p_amount,'awaiting_review',v_bank.bank_name,v_bank.account_number,
    v_bank.account_name,v_bank.id,v_bank.paystack_recipient_code,v_bank.bank_name,
    v_bank.account_number,v_bank.account_name,v_bank.bank_code,now(),now()
  ) returning id into v_withdrawal_id;
  insert into public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,
    description,metadata
  ) values(v_user_id,'withdrawal',-p_amount,v_new_balance,v_withdrawal_id::text,
    'withdrawal','Withdrawal awaiting Finance Operations review',
    jsonb_build_object('status','awaiting_review','bank_account_id',v_bank.id));
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,
    description,metadata
  ) values('withdrawal_requested',v_user_id,v_user_id,p_amount,
    v_withdrawal_id::text,'withdrawal','Withdrawal requested; amount reserved',
    jsonb_build_object('owner_type','property_partner','bank_account_id',v_bank.id));
  return v_withdrawal_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.request_worker_withdrawal(p_amount numeric, p_bank_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id text:=public.current_profile_user_id();
  v_wallet public.wallets;
  v_bank public.bank_accounts;
  v_min numeric;
  v_request_id uuid;
  v_new_balance numeric;
begin
  if v_user_id is null or not public.current_actor_has_workspace('worker',null) then
    return jsonb_build_object(
      'success',false,'error','Worker workspace required'
    );
  end if;
  if p_amount is null or p_amount<=0 then
    return jsonb_build_object('success',false,'error','Amount must be positive');
  end if;
  if p_bank_account_id is not null then
    select * into v_bank from public.bank_accounts
    where id=p_bank_account_id and user_id=v_user_id
      and verified_at is not null and is_active;
  else
    select * into v_bank from public.bank_accounts
    where user_id=v_user_id and verified_at is not null and is_active
    order by is_default desc,created_at limit 1;
  end if;
  if v_bank.id is null
     or nullif(btrim(coalesce(v_bank.paystack_recipient_code,'')),'') is null then
    return jsonb_build_object(
      'success',false,'error','Choose a Paystack-verified payout account'
    );
  end if;
  select * into v_wallet from public.wallets
  where owner_id=v_user_id and owner_type='worker' for update;
  if v_wallet.id is null then
    return jsonb_build_object('success',false,'error','Wallet not found');
  end if;
  if coalesce(v_wallet.is_frozen,false) then
    return jsonb_build_object('success',false,'error','Wallet is frozen');
  end if;
  select nullif(trim(value),'')::numeric into v_min
  from public.platform_settings
  where key in ('wallet_minimum_withdrawal','min_withdrawal')
    and coalesce(is_active,true)
  order by case key when 'wallet_minimum_withdrawal' then 0 else 1 end
  limit 1;
  if v_min is null then
    return jsonb_build_object(
      'success',false,'error','Minimum withdrawal setting is missing'
    );
  end if;
  if p_amount<v_min then
    return jsonb_build_object(
      'success',false,'error',format('Minimum withdrawal is ₦%s',v_min)
    );
  end if;
  if p_amount>coalesce(v_wallet.available_balance,0) then
    return jsonb_build_object(
      'success',false,'error','Insufficient available balance'
    );
  end if;
  v_new_balance:=v_wallet.available_balance-p_amount;
  update public.wallets
  set available_balance=v_new_balance,
      frozen_balance=coalesce(frozen_balance,0)+p_amount,
      updated_at=now()
  where id=v_wallet.id;
  insert into public.withdrawals(
    wallet_id,amount,status,bank_name,bank_account_number,bank_account_name,
    bank_account_id,payout_recipient_code,snapshot_bank_name,
    snapshot_bank_account_number,snapshot_bank_account_name,
    snapshot_bank_code,created_at,updated_at
  ) values(
    v_wallet.id,p_amount,'awaiting_review',v_bank.bank_name,
    v_bank.account_number,v_bank.account_name,v_bank.id,
    v_bank.paystack_recipient_code,v_bank.bank_name,v_bank.account_number,
    v_bank.account_name,v_bank.bank_code,now(),now()
  ) returning id into v_request_id;
  insert into public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,
    reference_type,description,metadata,created_at
  ) values(
    v_user_id,'withdrawal',-p_amount,v_new_balance,v_request_id::text,
    'withdrawal','Withdrawal awaiting Finance Operations review',
    jsonb_build_object(
      'wallet_id',v_wallet.id,'status','awaiting_review',
      'bank_account_id',v_bank.id
    ),now()
  );
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,
    description,metadata
  ) values(
    'withdrawal_requested',v_user_id,v_user_id,p_amount,
    v_request_id::text,'withdrawal',
    'Withdrawal requested; amount reserved from available balance',
    jsonb_build_object('owner_type','worker','bank_account_id',v_bank.id)
  );
  return jsonb_build_object(
    'success',true,'request_id',v_request_id,
    'amount',p_amount,'status','awaiting_review'
  );
end
$function$;

create or replace function public.request_my_wallet_withdrawal(
  p_owner_type text, p_amount numeric, p_bank_account_id uuid, p_request_id uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor text:=public.current_profile_user_id(); v_wallet public.wallets;
  v_request public.withdrawals; v_id uuid; v_result jsonb;
begin
  if v_actor is null or p_owner_type not in ('worker','property_partner')
    or p_owner_type is null
    or not public.current_actor_has_workspace(p_owner_type,null) then
    raise exception 'Active wallet workspace required' using errcode='42501';
  end if;
  if p_request_id is null or p_bank_account_id is null or p_amount is null
    or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0
    or p_amount<>trunc(p_amount,2) then
    raise exception 'A request ID, payout account and positive amount with at most two decimal places are required' using errcode='22023';
  end if;
  -- Same wallet lock as the existing financial command: two devices serialize.
  select * into v_wallet from public.wallets
    where owner_id=v_actor and owner_type=p_owner_type for update;
  if v_wallet.id is null then
    raise exception 'No earnings wallet is available yet' using errcode='22023';
  end if;
  select * into v_request from public.withdrawals
    where wallet_id=v_wallet.id and client_request_id=p_request_id;
  if v_request.id is not null then
    if v_request.amount is distinct from p_amount
      or v_request.bank_account_id is distinct from p_bank_account_id then
      raise exception 'This request ID belongs to different withdrawal details' using errcode='22023';
    end if;
    return jsonb_build_object('success',true,'request_id',v_request.id,
      'amount',v_request.amount,'status',v_request.status,'replayed',true);
  end if;
  if exists(select 1 from public.withdrawals where wallet_id=v_wallet.id
    and status in ('awaiting_review','processing')) then
    return jsonb_build_object('success',false,'error','A withdrawal is already awaiting review or processing. Check wallet activity.');
  end if;
  perform 1 from public.bank_accounts where id=p_bank_account_id
    and user_id=v_actor and is_active and verified_at is not null
    and nullif(btrim(paystack_recipient_code),'') is not null for share;
  if not found then raise exception 'Choose your current verified payout account' using errcode='22023'; end if;
  if p_owner_type='worker' then
    v_result:=public.request_worker_withdrawal(p_amount,p_bank_account_id);
    if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
    v_id:=(v_result->>'request_id')::uuid;
  else
    v_id:=public.request_my_property_partner_withdrawal(p_amount,p_bank_account_id);
  end if;
  update public.withdrawals set client_request_id=p_request_id
    where id=v_id and wallet_id=v_wallet.id returning * into v_request;
  if v_request.id is null then raise exception 'Withdrawal receipt was not recorded'; end if;
  return jsonb_build_object('success',true,'request_id',v_request.id,
    'amount',v_request.amount,'status',v_request.status,'replayed',false);
end $$;
revoke all on function public.request_my_wallet_withdrawal(text,numeric,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.request_my_wallet_withdrawal(text,numeric,uuid,uuid)
  to authenticated;
comment on column public.withdrawals.client_request_id is
  'Durable client intent ID scoped to this wallet; retries return this request without reserving money again.';

-- Reassert the existing wallet hardening contract on environments which have

-- Missing, revoked or another user's session cannot satisfy recent-login checks.
CREATE OR REPLACE FUNCTION private.enforce_withdrawal_controls()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  -- Authenticated requests must identify an existing session belonging to this user.
  if v_minutes>0 and coalesce(auth.jwt()->>'role','')='authenticated' then
    begin
      v_session_id:=nullif(auth.jwt()->>'session_id','')::uuid;
    exception when others then v_session_id:=null;
    end;
    if v_session_id is not null then
      select created_at into v_session_at from auth.sessions
        where id=v_session_id and user_id=auth.uid()
          and (not_after is null or not_after>now());
    end if;
    if v_session_at is null or v_session_at<now()-make_interval(mins=>v_minutes::integer) then
      raise exception 'Please confirm your password or sign in again before withdrawing' using errcode='28000';
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
$function$;
revoke all on function private.enforce_withdrawal_controls() from public,anon,authenticated;

-- Display the same minimum-withdrawal setting which the command enforces.
CREATE OR REPLACE FUNCTION public.get_my_property_partner_finance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id text:=public.current_profile_user_id(); v_wallet public.wallets;
  v_min numeric:=5000; v_long numeric; v_short numeric; v_hotel numeric;
  v_total_earnings numeric:=0;
begin
  if v_user_id is null or not public.current_actor_has_workspace('property_partner',null)
    then raise exception 'Property Partner workspace required'; end if;
  perform public.ensure_my_property_partner_wallet();
  select * into v_wallet from public.wallets
  where owner_id=v_user_id and owner_type='property_partner';
  select coalesce(nullif(value,'')::numeric,5000) into v_min
  from public.platform_settings where key in ('wallet_minimum_withdrawal','min_withdrawal')
    and coalesce(is_active,true)
  order by case key when 'wallet_minimum_withdrawal' then 0 else 1 end limit 1;
  select (value->>'percent')::numeric into v_long
  from public.creator_policy_versions where policy_key='commission_long_let'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc limit 1;
  select (value->>'percent')::numeric into v_short
  from public.creator_policy_versions where policy_key='commission_short_let'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc limit 1;
  select (value->>'percent')::numeric into v_hotel
  from public.creator_policy_versions where policy_key='commission_hotel'
    and scope_type='global' and scope_key='*' and status='active'
    and effective_from<=now() and (effective_until is null or effective_until>now())
  order by effective_from desc limit 1;
  select coalesce(sum(amount),0) into v_total_earnings
  from public.wallet_transactions where user_id=v_user_id
    and transaction_type in('property_earning_pending','property_earning_released');
  return jsonb_build_object(
    'wallet_id',v_wallet.id,'available_balance',coalesce(v_wallet.available_balance,0),
    'pending_balance',coalesce(v_wallet.pending_balance,0),
    'frozen_balance',coalesce(v_wallet.frozen_balance,0),
    'total_withdrawn',coalesce(v_wallet.total_withdrawn,0),
    'is_frozen',coalesce(v_wallet.is_frozen,false),
    'long_let_commission_rate',v_long,'short_let_commission_rate',v_short,
    'hotel_commission_rate',v_hotel,'total_earnings',v_total_earnings,
    'minimum_withdrawal',coalesce(v_min,5000)
  );
end
$function$;

-- Reassert the existing wallet hardening contract on environments which have
-- not yet received 20261017191000. RLS scopes reads; clients never write money.
revoke all on table public.wallet_balances from anon,authenticated;
revoke all on table public.withdrawal_requests from anon;
revoke insert,update,delete,truncate,references,trigger
  on table public.withdrawal_requests from authenticated;
revoke all on table public.wallets,public.wallet_transactions,public.withdrawals,
  public.financial_audit_logs,public.bank_accounts from anon;
revoke insert,update,delete,truncate,references,trigger
  on table public.wallets,public.wallet_transactions,public.withdrawals,
  public.financial_audit_logs,public.bank_accounts from authenticated;
