\set ON_ERROR_STOP on
begin;

do $$
declare
  v_wallet uuid;
  v_partner_wallet uuid;
  v_first uuid;
  v_rejected boolean := false;
begin
  select id into v_wallet from public.wallets
  where owner_id='upgrade-approved' and owner_type='worker';
  if v_wallet is null then raise exception 'Existing-account wallet fixture is missing'; end if;

  insert into public.withdrawals(wallet_id,amount,status)
  values(v_wallet,50,'awaiting_review') returning id into v_first;
  insert into public.wallets(owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn)
  values('upgrade-approved','property_partner',0,0,0,0)
  on conflict(owner_id,owner_type) do update set updated_at=now()
  returning id into v_partner_wallet;
  insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata)
  values('upgrade-approved','withdrawal',-50,0,v_first::text,'withdrawal','Worker payout','{}');
  insert into public.wallet_transactions(user_id,transaction_type,amount,balance_after,reference_id,reference_type,description,metadata)
  values('upgrade-approved','property_earning_pending',25,25,null,'booking_payment','Partner earning','{}');
  if (select wallet_id from public.wallet_transactions where description='Worker payout') is distinct from v_wallet
    or (select wallet_id from public.wallet_transactions where description='Partner earning') is distinct from v_partner_wallet then
    raise exception 'Wallet movements crossed workspace boundaries';
  end if;
  begin
    insert into public.withdrawals(wallet_id,amount,status)
    values(v_wallet,25,'awaiting_review');
  exception when unique_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'A second open payout was accepted for the same wallet';
  end if;

  update public.withdrawals set status='paid' where id=v_first;
  insert into public.withdrawals(wallet_id,amount,status)
  values(v_wallet,25,'awaiting_review');
end $$;

rollback;
