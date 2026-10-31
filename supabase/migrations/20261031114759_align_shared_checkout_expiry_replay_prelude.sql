begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Replay prerequisite for 20261031114800, which has already been applied on Test.
-- Keep that receipt immutable. Restore the repository's all-open-status expiry
-- behavior on Test and retain the exact entry shape consumed by the later patch.
-- This changes no booking, payment or migration receipt contents.
-- Shared Long Let / Short Let groups start as inviting, then ready / checkout_open. The expiry sweep only looked at
-- payment_pending and refunding, so an unpaid invite never expired and early payers were never refunded.
-- Both functions now cover every open status; the refund path (back to the original payment) is unchanged.

create or replace function public.sweep_expired_shared_payment_checkouts(p_limit integer default 100)
returns integer language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_group record; v_count integer:=0;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  for v_group in select id from public.shared_housing_groups
    where status in('payment_pending','refunding') and expires_at<=now()
      or (status in('inviting','ready','checkout_open') and expires_at<=now())
    order by expires_at for update skip locked limit least(greatest(p_limit,1),500)
  loop
    perform public.expire_shared_payment_checkout_from_service(v_group.id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.expire_shared_payment_checkout_from_service(p_group_id uuid)
returns integer language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_group public.shared_housing_groups; v_component record; v_queued integer:=0;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_group from public.shared_housing_groups where id=p_group_id for update;
  if v_group.id is null or v_group.status not in('payment_pending','refunding')
    and v_group.status not in('inviting','ready','checkout_open')
    or v_group.expires_at>now() then return 0; end if;
  if not exists(select 1 from public.shared_housing_members
    where group_id=p_group_id and payment_status='paid') then
    update public.shared_housing_groups set status='expired',updated_at=now() where id=p_group_id;
    update public.shared_payment_groups set status='expired',updated_at=now()
    where shared_payment_group_id=v_group.canonical_group_id;
    update public.reservations set status='expired',canonical_state='expired',updated_at=now()
    where id=v_group.reservation_id and status='payment_pending';
    return 0;
  end if;
  update public.shared_housing_groups set status='refunding',updated_at=now() where id=p_group_id;
  update public.shared_payment_groups set status='refunding',updated_at=now()
  where shared_payment_group_id=v_group.canonical_group_id;
  for v_component in
    select protection.id,protection.amount_total,member.id member_id
    from public.shared_housing_members member
    join public.booking_payments payment on payment.metadata->>'legacy_shared_member_id'=member.id::text
      and payment.metadata->>'checkout_attempt'=v_group.checkout_attempt::text
      and payment.status in('paid','completed')
    join public.payment_protection_transactions protection
      on protection.paystack_reference=payment.paystack_reference
      and protection.protection_state not in('refunded','released','reversed')
    where member.group_id=p_group_id and member.payment_status='paid'
  loop
    insert into public.financial_action_outbox(
      action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata
    ) values(
      'refund_shared_checkout','shared_payment_member',v_component.member_id::text,
      v_component.id,v_component.amount_total,'shared-checkout-refund:'||v_component.id,
      jsonb_build_object('shared_payment_group_id',p_group_id,'refund_destination','original_payment','retry_allowed',true)
    ) on conflict(idempotency_key) do nothing;
    if found then v_queued:=v_queued+1; end if;
  end loop;
  return v_queued;
end $$;

revoke all on function public.sweep_expired_shared_payment_checkouts(integer) from public, anon, authenticated;
grant execute on function public.sweep_expired_shared_payment_checkouts(integer) to service_role;
revoke all on function public.expire_shared_payment_checkout_from_service(uuid) from public, anon, authenticated;
grant execute on function public.expire_shared_payment_checkout_from_service(uuid) to service_role;

-- On an already-upgraded Test database retain the installed Hotel branch. On a
-- fresh replay, the subsequent Hotel migration installs this same branch once.
do $patch$
declare definition text;needle text;
begin
 if to_regprocedure('private.queue_shared_hotel_refunds(uuid,text)') is not null then
  definition:=pg_get_functiondef('public.expire_shared_payment_checkout_from_service(uuid)'::regprocedure);
  needle:=$n$  if v_group.id is null or v_group.status not in('payment_pending','refunding')$n$;
  if position(needle in definition)=0 then raise exception 'Inspect shared expiry replay entry';end if;
  execute replace(definition,needle,$r$  if v_group.product_type='hotel' and (v_group.status='refunding' or v_group.status in('inviting','payment_pending') and v_group.expires_at<=now()) then
    return private.queue_shared_hotel_refunds(v_group.id,'checkout_expired');end if;
  if v_group.id is null or v_group.status not in('payment_pending','refunding')$r$);
  definition:=pg_get_functiondef('public.sweep_expired_shared_payment_checkouts(integer)'::regprocedure);
  needle:=$n$where status in('payment_pending','refunding') and expires_at<=now()$n$;
  if position(needle in definition)=0 then raise exception 'Inspect shared expiry replay sweep';end if;
  execute replace(definition,needle,$r$where (status in('payment_pending','refunding') or (product_type='hotel' and status='inviting')) and expires_at<=now()$r$);
 end if;
end $patch$;
commit;
