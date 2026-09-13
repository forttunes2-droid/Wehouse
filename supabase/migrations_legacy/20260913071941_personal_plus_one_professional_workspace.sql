-- Launch identity rule: Personal is permanent and every normal identity may
-- activate at most one marketplace workspace (Worker OR Property Partner).
-- Existing exceptional dual rows are preserved for explicit review; no row is
-- silently revoked by this migration.

create or replace function public.enforce_one_marketplace_workspace()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
begin
  if new.status='active' and new.workspace_role in('worker','property_partner')
    and exists(
      select 1 from public.workspace_role_assignments other
      where other.user_id=new.user_id and other.status='active'
        and other.workspace_role in('worker','property_partner')
        and other.workspace_role<>new.workspace_role
        and other.id<>new.id
    ) then
    raise exception 'Personal accounts may have one professional marketplace workspace at launch';
  end if;
  return new;
end
$$;

drop trigger if exists one_marketplace_workspace
on public.workspace_role_assignments;
create trigger one_marketplace_workspace
before insert or update of user_id,workspace_role,status
on public.workspace_role_assignments
for each row execute function public.enforce_one_marketplace_workspace();

create or replace function public.activate_my_worker_workspace()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_profile public.profiles;
begin
  select * into v_profile from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) for update;
  if v_profile.user_id is null then raise exception 'Active Personal account required'; end if;
  if exists(select 1 from public.workspace_role_assignments
    where user_id=v_profile.user_id and workspace_role='property_partner'
      and status='active') then
    raise exception 'This Personal account already has a Property Partner workspace';
  end if;
  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at
  ) values(v_profile.user_id,'worker','global','active',now(),now(),now())
  on conflict (user_id,workspace_role) where status='active' do nothing;
  update public.profiles set account_kind='consumer',
    worker_status=coalesce(worker_status,'pending'),updated_at=now()
  where user_id=v_profile.user_id;
  return jsonb_build_object('success',true,'workspace','worker');
end
$$;

create or replace function public.activate_my_property_partner_workspace()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_profile public.profiles; v_code text;
begin
  select * into v_profile from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) for update;
  if v_profile.user_id is null then raise exception 'Active Personal account required'; end if;
  if exists(select 1 from public.workspace_role_assignments
    where user_id=v_profile.user_id and workspace_role='worker'
      and status='active') then
    raise exception 'This Personal account already has a Worker workspace';
  end if;
  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at
  ) values(v_profile.user_id,'property_partner','global','active',now(),now(),now())
  on conflict (user_id,workspace_role) where status='active' do nothing;
  update public.profiles set account_kind='consumer',updated_at=now()
  where user_id=v_profile.user_id;
  if not exists(select 1 from public.property_partners
    where profile_id=v_profile.user_id) then
    v_code:='WHP-'||replace(v_profile.user_id,'WHU-','')||'-'
      ||upper(substr(md5(v_profile.user_id||clock_timestamp()::text),1,4));
    insert into public.property_partners(
      profile_id,partner_code,status,commission_rate,total_earnings,
      total_paid_out,properties_count,created_at,updated_at
    ) values(v_profile.user_id,v_code,'pending_verification',0,0,0,0,now(),now())
    on conflict(profile_id) do nothing;
  end if;
  return jsonb_build_object('success',true,'workspace','property_partner');
end
$$;

drop policy if exists worker_services_owner_delete_canonical
on public.worker_services;
create policy worker_services_owner_delete_canonical
on public.worker_services for delete to authenticated
using(worker_id=public.current_profile_user_id()
  and public.current_actor_has_workspace('worker',null));
drop policy if exists worker_services_owner_insert_canonical
on public.worker_services;
create policy worker_services_owner_insert_canonical
on public.worker_services for insert to authenticated
with check(worker_id=public.current_profile_user_id()
  and public.current_actor_has_workspace('worker',null));
drop policy if exists worker_services_owner_read_canonical
on public.worker_services;
create policy worker_services_owner_read_canonical
on public.worker_services for select to authenticated
using(worker_id=public.current_profile_user_id()
  and public.current_actor_has_workspace('worker',null));
drop policy if exists worker_services_owner_update_canonical
on public.worker_services;
create policy worker_services_owner_update_canonical
on public.worker_services for update to authenticated
using(worker_id=public.current_profile_user_id()
  and public.current_actor_has_workspace('worker',null))
with check(worker_id=public.current_profile_user_id()
  and public.current_actor_has_workspace('worker',null));

create or replace function public.ensure_my_property_partner_wallet()
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_user_id text:=public.current_profile_user_id(); v_wallet_id uuid;
begin
  if v_user_id is null or not public.current_actor_has_workspace('property_partner',null)
    then raise exception 'Property Partner workspace required'; end if;
  insert into public.wallets(
    owner_id,owner_type,available_balance,pending_balance,frozen_balance,total_withdrawn
  ) values(v_user_id,'property_partner',0,0,0,0)
  on conflict(owner_id,owner_type) do nothing;
  select id into v_wallet_id from public.wallets
  where owner_id=v_user_id and owner_type='property_partner';
  return v_wallet_id;
end
$$;

create or replace function public.get_my_property_partner_finance()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
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
  from public.platform_settings where key='min_withdrawal'
    and coalesce(is_active,true) limit 1;
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
$$;

create or replace function public.get_my_property_partner_stays(p_listing_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null)
    then raise exception 'Property Partner workspace required'; end if;
  select coalesce(jsonb_agg(to_jsonb(stay) order by stay.created_at desc),'[]'::jsonb)
  into v_result from (
    select r.id reservation_id,r.booking_code,
      coalesce(r.stay_type,'long_stay') stay_type,r.status,
      r.rent_payment_status payment_status,r.rent_paid_at,
      r.stay_check_in check_in,r.stay_check_out check_out,r.stay_nights nights,
      coalesce(r.guest_count,1) guest_count,r.requested_move_in_at,
      r.move_in_requested_at,r.tenancy_start_date,r.tenancy_end_date,r.created_at,
      l.id::text listing_id,l.listing_id public_listing_code,l.title listing_title
    from public.reservations r join public.listings l on l.id::text=r.listing_id
    where (l.owner_id=v_actor or l.partner_id=v_actor)
      and (p_listing_id is null or l.id::text=p_listing_id or l.listing_id=p_listing_id)
      and ((coalesce(r.stay_type,'long_stay')='short_let'
        and ((r.rent_payment_status='paid' and r.rent_paid_at is not null)
          or r.status in('occupied','completed')))
        or (coalesce(r.stay_type,'long_stay')<>'short_let'
          and ((r.rent_payment_status in('paid','upfront_paid') and r.rent_paid_at is not null)
            or r.status in('occupied','completed'))))
    order by r.created_at desc limit 50
  ) stay;
  return v_result;
end
$$;

create or replace function public.request_my_property_partner_withdrawal(
  p_amount numeric,p_bank_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text:=public.current_profile_user_id(); v_wallet public.wallets;
  v_bank public.bank_accounts; v_withdrawal_id uuid; v_min numeric:=5000;
  v_new_balance numeric;
begin
  if v_user_id is null or not public.current_actor_has_workspace('property_partner',null)
    then raise exception 'Property Partner workspace required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Amount must be greater than 0'; end if;
  select * into v_bank from public.bank_accounts
  where id=p_bank_account_id and user_id=v_user_id and verified_at is not null limit 1;
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
$$;

revoke all on function public.enforce_one_marketplace_workspace()
from public,anon,authenticated;
grant execute on function public.enforce_one_marketplace_workspace() to service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  case when p.proname='enforce_one_marketplace_workspace'
    then 'approved_service_only' else 'approved_client_rpc' end,
  case when p.proname='enforce_one_marketplace_workspace'
    then 'Internal Personal-plus-one-professional integrity trigger'
    else 'Workspace-aware marketplace activation, Partner finance or stay command' end,
  now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'enforce_one_marketplace_workspace','activate_my_worker_workspace',
  'activate_my_property_partner_workspace','ensure_my_property_partner_wallet',
  'get_my_property_partner_finance','get_my_property_partner_stays',
  'request_my_property_partner_withdrawal'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();
