-- WeHouse provides Payment Protection. It does not represent itself as a
-- licensed escrow service. Payout state is finalized only from Paystack.

alter table public.escrow_transactions rename to payment_protection_transactions;
alter table public.payment_protection_transactions
  rename constraint escrow_transactions_pkey to payment_protection_transactions_pkey;
alter index if exists public.uq_escrow_worker_booking rename to uq_payment_protection_worker_booking;
alter policy escrow_read_canonical on public.payment_protection_transactions
  rename to payment_protection_read_canonical;

alter table public.payment_protection_transactions
  alter column status set default 'protected';
update public.payment_protection_transactions
set status=case when status in ('held','holding') then 'protected' else status end;
update public.worker_bookings set status='payment_protected' where status='paid_escrow';
update public.wallet_transactions
set transaction_type=case when transaction_type='escrow_release' then 'payment_protection_release' else transaction_type end,
    reference_type=case when reference_type='escrow' then 'payment_protection' else reference_type end,
    description=replace(replace(description,'Escrow','Payment Protection'),'escrow','Payment Protection')
where transaction_type='escrow_release' or reference_type='escrow' or description ilike '%escrow%';

alter table public.financial_audit_logs
  drop constraint if exists financial_audit_logs_event_type_check;
update public.financial_audit_logs
set event_type=case event_type
  when 'escrow_created' then 'payment_protection_created'
  when 'escrow_released' then 'payment_protection_released'
  when 'escrow_refunded' then 'payment_protection_refunded'
  when 'escrow_credit_wallet' then 'payment_protection_credit_wallet'
  when 'withdrawal_successful' then 'withdrawal_paid'
  else event_type end,
  description=replace(replace(description,'Escrow','Payment Protection'),'escrow','Payment Protection')
where event_type in ('escrow_created','escrow_released','escrow_refunded','escrow_credit_wallet','withdrawal_successful')
   or description ilike '%escrow%';
alter table public.financial_audit_logs
  add constraint financial_audit_logs_event_type_check
  check (event_type in (
    'customer_payment','payment_protection_created','payment_protection_released',
    'payment_protection_refunded','payment_protection_credit_wallet',
    'withdrawal_requested','withdrawal_processing','withdrawal_paid',
    'withdrawal_failed','withdrawal_reversed','withdrawal_rejected',
    'wallet_frozen','wallet_unfrozen','commission_deducted',
    'security_deposit_held','security_deposit_released','security_deposit_claimed',
    'blue_badge_purchased','blue_badge_renewed','dispute_opened','dispute_resolved',
    'manual_adjustment','bank_account_change','payment_reversed',
    'worker_verification_payment','withdrawal_snapshot'
  ));

update public.platform_settings
set key=case key
      when 'escrow_hold_days' then 'payment_protection_hold_days'
      when 'escrow_auto_release' then 'payment_protection_auto_release'
      when 'escrow_dispute_window_days' then 'payment_protection_dispute_window_days'
      else key end,
    label=replace(replace(label,'Escrow','Payment Protection'),'escrow','Payment Protection'),
    description=replace(replace(description,'Escrow','Payment Protection'),'escrow','Payment Protection'),
    updated_at=now()
where key in ('escrow_hold_days','escrow_auto_release','escrow_dispute_window_days');

-- Recompile the active functions with neutral Payment Protection terminology.
do $block$
declare
  v_function record;
  v_definition text;
begin
  for v_function in
    select p.oid,p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'confirm_worker_booking_payment','customer_confirm_completion',
      'customer_raise_dispute','delete_user_account','get_my_staff_finance_queue',
      'refund_escrow','release_escrow','release_property_partner_earning'
    )
  loop
    v_definition:=pg_get_functiondef(v_function.oid);
    v_definition:=replace(v_definition,'escrow_transactions','payment_protection_transactions');
    v_definition:=replace(v_definition,'escrow_credit_wallet','payment_protection_credit_wallet');
    v_definition:=replace(v_definition,'escrow_release','payment_protection_release');
    v_definition:=replace(v_definition,'escrow_created','payment_protection_created');
    v_definition:=replace(v_definition,'escrow_released','payment_protection_released');
    v_definition:=replace(v_definition,'escrow_refunded','payment_protection_refunded');
    v_definition:=replace(v_definition,'paid_escrow','payment_protected');
    v_definition:=replace(v_definition,'refund_escrow','refund_payment_protection');
    v_definition:=replace(v_definition,'release_escrow','release_payment_protection');
    v_definition:=replace(v_definition,'p_escrow_id','p_payment_protection_id');
    v_definition:=replace(v_definition,'Escrow','Payment Protection');
    v_definition:=replace(v_definition,'escrow','payment_protection');
    v_definition:=replace(v_definition,'''held''','''protected''');
    v_definition:=replace(v_definition,'''holding''','''protected''');
    execute v_definition;
  end loop;
end;
$block$;

drop function if exists public.refund_escrow(uuid,text);
drop function if exists public.release_escrow(uuid,text);
revoke all on function public.refund_payment_protection(uuid,text) from public,anon,authenticated;
revoke all on function public.release_payment_protection(uuid,text) from public,anon,authenticated;
grant execute on function public.refund_payment_protection(uuid,text) to service_role;
grant execute on function public.release_payment_protection(uuid,text) to service_role;

-- One payout state machine for Workers and Property Partners.
alter table public.withdrawals
  add column if not exists reviewed_by text references public.profiles(user_id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists paystack_status text,
  add column if not exists transfer_response jsonb not null default '{}'::jsonb,
  add column if not exists finalized_at timestamptz,
  add column if not exists settlement_event_key text;

alter table public.withdrawals drop constraint if exists withdrawals_status_check;
update public.withdrawals
set status=case status when 'pending' then 'awaiting_review' when 'successful' then 'paid' else status end;
alter table public.withdrawals
  add constraint withdrawals_status_check
  check (status in ('awaiting_review','processing','paid','rejected','failed','reversed'));
create unique index if not exists uq_withdrawals_paystack_transfer_reference
  on public.withdrawals(paystack_transfer_reference)
  where paystack_transfer_reference is not null;

create or replace function public.request_worker_withdrawal(
  p_amount numeric,p_bank_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_user_id text;
  v_wallet public.wallets;
  v_bank public.bank_accounts;
  v_min numeric;
  v_request_id uuid;
  v_new_balance numeric;
begin
  select user_id into v_user_id from public.profiles
  where auth_id=(select auth.uid())::text and role='worker'
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_user_id is null then return jsonb_build_object('success',false,'error','Worker account required'); end if;
  if p_amount is null or p_amount<=0 then return jsonb_build_object('success',false,'error','Amount must be positive'); end if;
  if p_bank_account_id is not null then
    select * into v_bank from public.bank_accounts
    where id=p_bank_account_id and user_id=v_user_id and verified_at is not null;
  else
    select * into v_bank from public.bank_accounts
    where user_id=v_user_id and verified_at is not null
    order by is_default desc,created_at limit 1;
  end if;
  if v_bank.id is null or nullif(btrim(coalesce(v_bank.paystack_recipient_code,'')),'') is null then
    return jsonb_build_object('success',false,'error','Choose a Paystack-verified payout account');
  end if;
  select * into v_wallet from public.wallets
  where owner_id=v_user_id and owner_type='worker' for update;
  if v_wallet.id is null then return jsonb_build_object('success',false,'error','Wallet not found'); end if;
  if coalesce(v_wallet.is_frozen,false) then return jsonb_build_object('success',false,'error','Wallet is frozen'); end if;
  select nullif(trim(value),'')::numeric into v_min from public.platform_settings
  where key in ('wallet_minimum_withdrawal','min_withdrawal') and coalesce(is_active,true)
  order by case key when 'wallet_minimum_withdrawal' then 0 else 1 end limit 1;
  if v_min is null then return jsonb_build_object('success',false,'error','Minimum withdrawal setting is missing'); end if;
  if p_amount<v_min then return jsonb_build_object('success',false,'error',format('Minimum withdrawal is ₦%s',v_min)); end if;
  if p_amount>coalesce(v_wallet.available_balance,0) then return jsonb_build_object('success',false,'error','Insufficient available balance'); end if;

  v_new_balance:=v_wallet.available_balance-p_amount;
  update public.wallets
  set available_balance=v_new_balance,
      frozen_balance=coalesce(frozen_balance,0)+p_amount,updated_at=now()
  where id=v_wallet.id;
  insert into public.withdrawals(
    wallet_id,amount,status,bank_name,bank_account_number,bank_account_name,
    bank_account_id,payout_recipient_code,snapshot_bank_name,
    snapshot_bank_account_number,snapshot_bank_account_name,snapshot_bank_code,
    created_at,updated_at
  ) values(
    v_wallet.id,p_amount,'awaiting_review',v_bank.bank_name,v_bank.account_number,v_bank.account_name,
    v_bank.id,v_bank.paystack_recipient_code,v_bank.bank_name,v_bank.account_number,
    v_bank.account_name,v_bank.bank_code,now(),now()
  ) returning id into v_request_id;
  insert into public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at
  ) values(
    v_user_id,'withdrawal',-p_amount,v_new_balance,v_request_id::text,'withdrawal',
    'Withdrawal awaiting finance review',jsonb_build_object('wallet_id',v_wallet.id,'status','awaiting_review','bank_account_id',v_bank.id),now()
  );
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata
  ) values(
    'withdrawal_requested',v_user_id,v_user_id,p_amount,v_request_id::text,'withdrawal',
    'Withdrawal requested; amount reserved from available balance',jsonb_build_object('owner_type','worker','bank_account_id',v_bank.id)
  );
  return jsonb_build_object('success',true,'request_id',v_request_id,'amount',p_amount,'status','awaiting_review');
end;
$function$;

create or replace function public.request_my_property_partner_withdrawal(
  p_amount numeric,p_bank_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_user_id text;
  v_wallet public.wallets;
  v_bank public.bank_accounts;
  v_withdrawal_id uuid;
  v_min numeric:=5000;
begin
  select user_id into v_user_id from public.profiles
  where auth_id=(select auth.uid())::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_user_id is null then raise exception 'Property Partner account required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Amount must be greater than 0'; end if;
  select * into v_bank from public.bank_accounts
  where id=p_bank_account_id and user_id=v_user_id and verified_at is not null limit 1;
  if v_bank.id is null or nullif(btrim(coalesce(v_bank.paystack_recipient_code,'')),'') is null then
    raise exception 'Choose a Paystack-verified payout account';
  end if;
  select nullif(trim(value),'')::numeric into v_min from public.platform_settings
  where key in ('wallet_minimum_withdrawal','min_withdrawal') and coalesce(is_active,true)
  order by case key when 'wallet_minimum_withdrawal' then 0 else 1 end limit 1;
  v_min:=coalesce(v_min,5000);
  if p_amount<v_min then raise exception 'Minimum withdrawal is ₦%',v_min; end if;
  select * into v_wallet from public.wallets
  where owner_id=v_user_id and owner_type='property_partner' for update;
  if v_wallet.id is null then raise exception 'Wallet not found'; end if;
  if coalesce(v_wallet.is_frozen,false) then raise exception 'Wallet is frozen'; end if;
  if p_amount>coalesce(v_wallet.available_balance,0) then raise exception 'Insufficient available balance'; end if;
  update public.wallets
  set available_balance=available_balance-p_amount,
      frozen_balance=coalesce(frozen_balance,0)+p_amount,updated_at=now()
  where id=v_wallet.id;
  insert into public.withdrawals(
    wallet_id,amount,status,bank_name,bank_account_number,bank_account_name,
    bank_account_id,payout_recipient_code,snapshot_bank_name,
    snapshot_bank_account_number,snapshot_bank_account_name,snapshot_bank_code,
    created_at,updated_at
  ) values(
    v_wallet.id,p_amount,'awaiting_review',v_bank.bank_name,v_bank.account_number,v_bank.account_name,
    v_bank.id,v_bank.paystack_recipient_code,v_bank.bank_name,v_bank.account_number,
    v_bank.account_name,v_bank.bank_code,now(),now()
  ) returning id into v_withdrawal_id;
  insert into public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata
  ) values(
    v_user_id,'withdrawal',-p_amount,v_wallet.available_balance-p_amount,v_withdrawal_id::text,'withdrawal',
    'Withdrawal awaiting finance review',jsonb_build_object('status','awaiting_review','bank_account_id',v_bank.id)
  );
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata
  ) values(
    'withdrawal_requested',v_user_id,v_user_id,p_amount,v_withdrawal_id::text,'withdrawal',
    'Withdrawal requested; amount reserved from available balance',jsonb_build_object('owner_type','property_partner','bank_account_id',v_bank.id)
  );
  return v_withdrawal_id;
end;
$function$;

create or replace function public.claim_withdrawal_for_payout(
  p_withdrawal_id uuid,p_reviewer_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_reviewer public.profiles;
  v_withdrawal public.withdrawals;
  v_wallet public.wallets;
  v_reference text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  select * into v_reviewer from public.profiles
  where user_id=p_reviewer_id and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_reviewer.user_id is null then raise exception 'Active finance reviewer required'; end if;
  if v_reviewer.role='staff' and not exists(
    select 1 from public.staff_permissions where staff_id=v_reviewer.user_id
      and permission='finance' and is_active
  ) then raise exception 'Finance permission required'; end if;
  select * into v_withdrawal from public.withdrawals
  where id=p_withdrawal_id for update;
  if v_withdrawal.id is null then raise exception 'Withdrawal not found'; end if;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id for update;
  if v_wallet.id is null then raise exception 'Wallet not found'; end if;
  if v_wallet.owner_id=p_reviewer_id then raise exception 'You cannot review your own withdrawal'; end if;
  if v_reviewer.role in ('staff','admin') and not public.can_current_actor_read_profile_for(v_reviewer.user_id,v_wallet.owner_id) then
    raise exception 'Withdrawal is outside your branch';
  end if;
  if v_withdrawal.status='processing' and v_withdrawal.paystack_transfer_reference is not null then
    return jsonb_build_object('success',true,'already_claimed',true,'withdrawal_id',v_withdrawal.id,
      'amount',v_withdrawal.amount,'recipient_code',v_withdrawal.payout_recipient_code,
      'reference',v_withdrawal.paystack_transfer_reference,'owner_type',v_wallet.owner_type);
  end if;
  if v_withdrawal.status<>'awaiting_review' then raise exception 'Withdrawal is not awaiting review'; end if;
  if coalesce(v_wallet.frozen_balance,0)<v_withdrawal.amount then raise exception 'Reserved wallet balance is incomplete'; end if;
  if nullif(btrim(coalesce(v_withdrawal.payout_recipient_code,'')),'') is null then raise exception 'Paystack recipient is missing'; end if;
  v_reference:='WHP-'||replace(v_withdrawal.id::text,'-','');
  update public.withdrawals
  set status='processing',reviewed_by=p_reviewer_id,reviewed_at=now(),
      paystack_transfer_reference=v_reference,paystack_status='initiating',updated_at=now()
  where id=v_withdrawal.id;
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata
  ) values(
    'withdrawal_processing',p_reviewer_id,v_wallet.owner_id,v_withdrawal.amount,
    v_withdrawal.id::text,'withdrawal','Withdrawal approved for Paystack transfer',
    jsonb_build_object('paystack_reference',v_reference,'owner_type',v_wallet.owner_type)
  );
  return jsonb_build_object('success',true,'withdrawal_id',v_withdrawal.id,
    'amount',v_withdrawal.amount,'recipient_code',v_withdrawal.payout_recipient_code,
    'reference',v_reference,'owner_type',v_wallet.owner_type);
end;
$function$;

-- Explicit reviewer identity is checked against branch scope without relying on auth.uid(),
-- because the payout Edge Function uses the service-role database client.
create or replace function public.can_current_actor_read_profile_for(
  p_actor_id text,p_target_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_actor public.profiles;v_target public.profiles;
begin
  select * into v_actor from public.profiles where user_id=p_actor_id limit 1;
  select * into v_target from public.profiles where user_id=p_target_id limit 1;
  if v_actor.user_id is null or v_target.user_id is null then return false; end if;
  if v_actor.role='creator' then return true; end if;
  if v_actor.role not in ('admin','staff') then return false; end if;
  return public.wehouse_state_key(v_actor.assigned_state)=public.wehouse_state_key(v_target.state)
    and public.wehouse_lga_key(v_actor.assigned_lga)=public.wehouse_lga_key(coalesce(nullif(v_target.local_government,''),v_target.city));
end;
$function$;

-- Recreate claim now that its helper exists (PL/pgSQL resolves it on execution).
revoke all on function public.can_current_actor_read_profile_for(text,text) from public,anon,authenticated;
grant execute on function public.can_current_actor_read_profile_for(text,text) to service_role;

create or replace function public.get_withdrawal_payout_snapshot(
  p_withdrawal_id uuid,p_reviewer_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_reviewer public.profiles;v_withdrawal public.withdrawals;v_wallet public.wallets;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  select * into v_reviewer from public.profiles where user_id=p_reviewer_id and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id;
  if v_reviewer.user_id is null or v_withdrawal.id is null or v_wallet.id is null then raise exception 'Payout record not found'; end if;
  if v_reviewer.role='staff' and not exists(select 1 from public.staff_permissions where staff_id=v_reviewer.user_id and permission='finance' and is_active) then raise exception 'Finance permission required'; end if;
  if v_wallet.owner_id=p_reviewer_id then raise exception 'You cannot review your own withdrawal'; end if;
  if v_reviewer.role in ('staff','admin') and not public.can_current_actor_read_profile_for(v_reviewer.user_id,v_wallet.owner_id) then raise exception 'Withdrawal is outside your branch'; end if;
  return jsonb_build_object('success',true,'withdrawal_id',v_withdrawal.id,'status',v_withdrawal.status,
    'amount',v_withdrawal.amount,'reference',v_withdrawal.paystack_transfer_reference,
    'transfer_code',v_withdrawal.paystack_transfer_code,'paystack_status',v_withdrawal.paystack_status);
end;
$function$;

create or replace function public.record_withdrawal_transfer_response(
  p_withdrawal_id uuid,p_transfer_code text,p_paystack_status text,p_response jsonb
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  update public.withdrawals set
    paystack_transfer_code=coalesce(nullif(btrim(coalesce(p_transfer_code,'')),''),paystack_transfer_code),
    paystack_status=nullif(lower(btrim(coalesce(p_paystack_status,''))),''),
    transfer_response=coalesce(p_response,'{}'::jsonb),updated_at=now()
  where id=p_withdrawal_id and status='processing';
  if not found then raise exception 'Processing withdrawal not found'; end if;
  return true;
end;
$function$;

create or replace function public.return_reserved_withdrawal(
  p_withdrawal_id uuid,p_status text,p_reason text,p_event_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_withdrawal public.withdrawals;v_wallet public.wallets;v_event text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  if p_status not in ('rejected','failed','reversed') then raise exception 'Invalid terminal payout status'; end if;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id for update;
  if v_withdrawal.id is null then raise exception 'Withdrawal not found'; end if;
  if v_withdrawal.status in ('paid','rejected','failed','reversed') then
    return jsonb_build_object('success',true,'already_finalized',true,'status',v_withdrawal.status);
  end if;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id for update;
  if v_wallet.id is null or coalesce(v_wallet.frozen_balance,0)<v_withdrawal.amount then raise exception 'Reserved wallet balance is incomplete'; end if;
  update public.wallets set available_balance=coalesce(available_balance,0)+v_withdrawal.amount,
    frozen_balance=frozen_balance-v_withdrawal.amount,updated_at=now() where id=v_wallet.id;
  update public.withdrawals set status=p_status,failed_reason=nullif(btrim(coalesce(p_reason,'')),''),
    reversed_at=case when p_status='reversed' then now() else reversed_at end,
    finalized_at=now(),settlement_event_key=p_event_key,updated_at=now() where id=v_withdrawal.id;
  insert into public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata,created_at
  ) values(
    v_wallet.owner_id,'withdrawal_reversal',v_withdrawal.amount,
    coalesce(v_wallet.available_balance,0)+v_withdrawal.amount,v_withdrawal.id::text,'withdrawal',
    'Reserved withdrawal funds returned to available balance',
    jsonb_build_object('status',p_status,'reason',nullif(btrim(coalesce(p_reason,'')),''),'event_key',p_event_key),now()
  );
  v_event:=case p_status when 'rejected' then 'withdrawal_rejected' when 'reversed' then 'withdrawal_reversed' else 'withdrawal_failed' end;
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata
  ) values(
    v_event,null,v_wallet.owner_id,v_withdrawal.amount,v_withdrawal.id::text,'withdrawal',
    'Withdrawal did not complete; reserved funds returned',
    jsonb_build_object('status',p_status,'reason',nullif(btrim(coalesce(p_reason,'')),''),'event_key',p_event_key)
  );
  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key
  ) values(
    v_wallet.owner_id,'withdrawal_'||p_status,
    case when p_status='rejected' then 'Withdrawal not approved' when p_status='reversed' then 'Withdrawal reversed' else 'Withdrawal failed' end,
    coalesce(nullif(btrim(coalesce(p_reason,'')),''),'The reserved amount is available in your wallet again.'),
    v_withdrawal.id::text,'withdrawal',v_withdrawal.id::text,
    case when v_wallet.owner_type='worker' then 'worker_wallet' else 'partner_finance' end,
    jsonb_build_object('withdrawal_id',v_withdrawal.id),
    'withdrawal-final:'||v_withdrawal.id::text||':'||p_status
  ) on conflict do nothing;
  return jsonb_build_object('success',true,'status',p_status,'amount_returned',v_withdrawal.amount);
end;
$function$;

create or replace function public.reject_withdrawal_for_payout(
  p_withdrawal_id uuid,p_reviewer_id text,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_reviewer public.profiles;v_withdrawal public.withdrawals;v_wallet public.wallets;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  select * into v_reviewer from public.profiles where user_id=p_reviewer_id and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  select * into v_withdrawal from public.withdrawals where id=p_withdrawal_id for update;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id;
  if v_reviewer.user_id is null or v_withdrawal.id is null or v_wallet.id is null then raise exception 'Payout record not found'; end if;
  if v_reviewer.role='staff' and not exists(select 1 from public.staff_permissions where staff_id=v_reviewer.user_id and permission='finance' and is_active) then raise exception 'Finance permission required'; end if;
  if v_wallet.owner_id=p_reviewer_id then raise exception 'You cannot review your own withdrawal'; end if;
  if v_reviewer.role in ('staff','admin') and not public.can_current_actor_read_profile_for(v_reviewer.user_id,v_wallet.owner_id) then raise exception 'Withdrawal is outside your branch'; end if;
  if v_withdrawal.status<>'awaiting_review' then raise exception 'Only a withdrawal awaiting review can be rejected'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'A rejection reason is required'; end if;
  update public.withdrawals set reviewed_by=p_reviewer_id,reviewed_at=now() where id=p_withdrawal_id;
  return public.return_reserved_withdrawal(p_withdrawal_id,'rejected',p_reason,'review-rejected:'||p_withdrawal_id::text);
end;
$function$;

create or replace function public.fail_withdrawal_before_transfer(
  p_withdrawal_id uuid,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  return public.return_reserved_withdrawal(p_withdrawal_id,'failed',p_reason,'paystack-rejected:'||p_withdrawal_id::text);
end;
$function$;

create or replace function public.settle_withdrawal_transfer_event(
  p_reference text,p_transfer_code text,p_paystack_status text,p_reason text,
  p_event_key text,p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_withdrawal public.withdrawals;v_wallet public.wallets;v_status text:=lower(btrim(coalesce(p_paystack_status,'')));
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
  if v_status not in ('success','failed','reversed') then raise exception 'Unsupported Paystack transfer status'; end if;
  select * into v_withdrawal from public.withdrawals
  where paystack_transfer_reference=p_reference for update;
  if v_withdrawal.id is null then return jsonb_build_object('success',false,'error','Withdrawal not found'); end if;
  if v_withdrawal.status in ('paid','rejected','failed','reversed') then
    return jsonb_build_object('success',true,'already_finalized',true,'status',v_withdrawal.status);
  end if;
  if v_withdrawal.status<>'processing' then raise exception 'Withdrawal is not processing'; end if;
  update public.withdrawals set
    paystack_transfer_code=coalesce(nullif(btrim(coalesce(p_transfer_code,'')),''),paystack_transfer_code),
    paystack_status=v_status,transfer_response=coalesce(p_payload,'{}'::jsonb),updated_at=now()
  where id=v_withdrawal.id;
  if v_status in ('failed','reversed') then
    return public.return_reserved_withdrawal(v_withdrawal.id,v_status,p_reason,p_event_key);
  end if;
  select * into v_wallet from public.wallets where id=v_withdrawal.wallet_id for update;
  if v_wallet.id is null or coalesce(v_wallet.frozen_balance,0)<v_withdrawal.amount then raise exception 'Reserved wallet balance is incomplete'; end if;
  update public.wallets set frozen_balance=frozen_balance-v_withdrawal.amount,
    total_withdrawn=coalesce(total_withdrawn,0)+v_withdrawal.amount,updated_at=now()
  where id=v_wallet.id;
  update public.withdrawals set status='paid',processed_at=now(),finalized_at=now(),
    settlement_event_key=p_event_key,updated_at=now() where id=v_withdrawal.id;
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,description,metadata
  ) values(
    'withdrawal_paid',v_withdrawal.reviewed_by,v_wallet.owner_id,v_withdrawal.amount,
    v_withdrawal.id::text,'withdrawal','Paystack confirmed the withdrawal transfer',
    jsonb_build_object('paystack_reference',p_reference,'transfer_code',p_transfer_code,'event_key',p_event_key)
  );
  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key
  ) values(
    v_wallet.owner_id,'withdrawal_paid','Withdrawal paid',
    'Paystack confirmed that your withdrawal was paid.',v_withdrawal.id::text,
    'withdrawal',v_withdrawal.id::text,
    case when v_wallet.owner_type='worker' then 'worker_wallet' else 'partner_finance' end,
    jsonb_build_object('withdrawal_id',v_withdrawal.id),
    'withdrawal-final:'||v_withdrawal.id::text||':paid'
  ) on conflict do nothing;
  return jsonb_build_object('success',true,'status','paid','amount',v_withdrawal.amount);
end;
$function$;

revoke all on function public.claim_withdrawal_for_payout(uuid,text) from public,anon,authenticated;
revoke all on function public.get_withdrawal_payout_snapshot(uuid,text) from public,anon,authenticated;
revoke all on function public.record_withdrawal_transfer_response(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.return_reserved_withdrawal(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.reject_withdrawal_for_payout(uuid,text,text) from public,anon,authenticated;
revoke all on function public.fail_withdrawal_before_transfer(uuid,text) from public,anon,authenticated;
revoke all on function public.settle_withdrawal_transfer_event(text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_withdrawal_for_payout(uuid,text) to service_role;
grant execute on function public.get_withdrawal_payout_snapshot(uuid,text) to service_role;
grant execute on function public.record_withdrawal_transfer_response(uuid,text,text,jsonb) to service_role;
grant execute on function public.return_reserved_withdrawal(uuid,text,text,text) to service_role;
grant execute on function public.reject_withdrawal_for_payout(uuid,text,text) to service_role;
grant execute on function public.fail_withdrawal_before_transfer(uuid,text) to service_role;
grant execute on function public.settle_withdrawal_transfer_event(text,text,text,text,text,jsonb) to service_role;

drop function if exists public.approve_withdrawal_v2(uuid,text);
drop function if exists public.reject_withdrawal_v2(uuid,text);
drop function if exists public.process_withdrawal(uuid,text,text);
drop function if exists public.fail_withdrawal(uuid,text);

create or replace function public.get_my_staff_finance_queue()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_payments jsonb;v_withdrawals jsonb;v_commissions jsonb;
  v_payment_protection jsonb;v_refunds jsonb;v_audit jsonb;
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text
    and role in ('staff','admin','creator') and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active finance account required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('finance') then raise exception 'Finance permission required'; end if;
  if v_actor.role in ('staff','admin') and (v_actor.assigned_state is null or v_actor.assigned_lga is null) then raise exception 'Branch assignment required'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_payments from (
    select bp.id,bp.payment_reference,bp.type,bp.booking_type,bp.amount,bp.amount_total,
      bp.amount_commission,bp.net_amount,bp.currency,bp.status,bp.purpose,bp.payment_method,
      bp.paystack_reference,bp.verified_at,bp.paid_at,bp.created_at
    from public.booking_payments bp
    where v_actor.role='creator' or public.can_current_actor_read_profile(bp.user_id)
      or public.can_current_actor_read_profile(bp.payer_user_id) or public.can_current_actor_read_profile(bp.payee_user_id)
      or (bp.listing_id is not null and public.current_actor_can_access_listing_ref(bp.listing_id))
    order by bp.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_withdrawals from (
    select wd.id,wd.amount,wd.status,wd.snapshot_bank_name,wd.snapshot_bank_account_number,
      wd.snapshot_bank_account_name,wd.paystack_transfer_reference,wd.paystack_transfer_code,
      wd.paystack_status,wd.reviewed_by,wd.reviewed_at,wd.processed_at,wd.failed_reason,
      wd.finalized_at,wd.created_at,w.owner_id,w.owner_type,
      coalesce(p.full_name,p.username,p.email) owner_name
    from public.withdrawals wd join public.wallets w on w.id=wd.wallet_id
    left join public.profiles p on p.user_id=w.owner_id
    where v_actor.role='creator' or public.can_current_actor_read_profile(w.owner_id)
    order by wd.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_commissions from (
    select c.id,c.booking_type,c.commission_amount,c.commission_rate,c.gross_amount,
      c.description,c.paystack_reference,c.status,c.created_at
    from public.commission_ledger c
    where v_actor.role='creator' or public.can_current_actor_read_profile(c.source_user_id)
    order by c.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_payment_protection from (
    select t.id,t.booking_id,t.booking_type,t.amount_total,t.amount_commission,t.amount_payee,
      t.commission_rate,t.status,t.released_at,t.released_by,t.paystack_reference,t.created_at
    from public.payment_protection_transactions t
    where v_actor.role='creator' or public.can_current_actor_read_profile(t.payer_user_id)
      or public.can_current_actor_read_profile(t.payee_user_id)
    order by t.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_refunds from (
    select bp.id,bp.payment_reference,bp.booking_type,bp.amount_total,bp.status,
      bp.refund_reason,bp.refund_processed_at,bp.refund_reference,bp.created_at
    from public.booking_payments bp
    where (bp.refund_reason is not null or bp.refund_processed_at is not null
      or bp.refund_reference is not null or lower(coalesce(bp.status,'')) like 'refund%')
      and (v_actor.role='creator' or public.can_current_actor_read_profile(bp.user_id)
        or public.can_current_actor_read_profile(bp.payer_user_id) or public.can_current_actor_read_profile(bp.payee_user_id)
        or (bp.listing_id is not null and public.current_actor_can_access_listing_ref(bp.listing_id)))
    order by bp.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_audit from (
    select a.id,a.action,a.actor_role,a.target_type,a.target_id,a.amount,a.commission_amount,
      a.description,a.status_before,a.status_after,a.failure_reason,a.created_at
    from public.financial_audit_log a
    where v_actor.role='creator' or (a.target_user_id is not null and public.can_current_actor_read_profile(a.target_user_id))
    order by a.created_at desc limit 100
  ) x;
  return jsonb_build_object('payments',v_payments,'withdrawals',v_withdrawals,
    'commissions',v_commissions,'payment_protection',v_payment_protection,
    'refunds',v_refunds,'audit',v_audit);
end;
$function$;

revoke all on function public.get_my_staff_finance_queue() from public,anon;
grant execute on function public.get_my_staff_finance_queue() to authenticated,service_role;
