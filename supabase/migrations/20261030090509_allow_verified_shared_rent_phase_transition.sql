begin;

create function private.shared_rent_phase_transition(p_old jsonb,p_new jsonb,p_legacy boolean)
returns boolean language plpgsql stable security definer set search_path='' as $function$
declare group_id uuid;r public.reservations;key text;
begin
 if p_old->>'product_type' is distinct from 'long_let' or p_new->>'product_type' is distinct from 'long_let' then return false;end if;
 group_id:=(case when p_legacy then p_old->>'canonical_group_id' else p_old->>'shared_payment_group_id' end)::uuid;
 if group_id is null then return false;end if;
 foreach key in array array['product_type','listing_id','member_limit','capacity','stay_check_in','stay_check_out','guest_count','reservation_fee_total','created_by'] loop
  if p_old->key is distinct from p_new->key then return false;end if;
 end loop;
 select * into r from public.reservations where id=p_new->>'reservation_id';
 if r.id is null or r.shared_payment_group_id is distinct from group_id or r.listing_id is distinct from p_old->>'listing_id'
  or r.user_id is distinct from p_old->>'created_by' then return false;end if;
 -- Attaching the one new reservation after all real fee receipts are verified
 -- changes no paid quote, payer or attempt. It is not an arbitrary re-link.
 if p_old->>'reservation_id' is null and p_old->>'payment_phase'='reservation_fee'
  and p_new->>'payment_phase'='reservation_fee' and p_new->>'status'=(case when p_legacy then 'paid' else 'fully_paid' end)
  and p_old->'total_amount'=p_new->'total_amount' and p_old->'contract_total' is not distinct from p_new->'contract_total'
  and p_old->'checkout_attempt'=p_new->'checkout_attempt'
  and r.manual_payment_status in('paid','completed') and r.paid_at is not null and r.amount=(p_old->>'total_amount')::numeric
  and exists(select 1 from public.shared_payment_members where shared_payment_group_id=group_id)
  and not exists(select 1 from public.shared_payment_members m where m.shared_payment_group_id=group_id
   and (m.invitation_state<>'accepted' or m.payment_state<>'paid' or not exists(
    select 1 from public.booking_payments p where p.paystack_reference=m.provider_reference
     and p.purpose='shared_housing_share' and p.payer_user_id=m.user_id and p.status in('paid','completed')
     and p.verified_at is not null and p.verified_amount=m.share_amount
     and p.metadata->>'payment_phase'='reservation_fee'
     and p.metadata->>'canonical_shared_payment_group_id'=group_id::text
     and p.metadata->>'canonical_shared_payment_member_id'=m.shared_payment_member_id::text))) then return true;end if;
 -- Advancing a paid fee checkout starts a separately reviewed rent attempt.
 -- Earlier fee receipts and their protected balances remain unchanged.
 if p_old->>'reservation_id'=p_new->>'reservation_id' and p_old->>'payment_phase'='reservation_fee'
  and p_new->>'payment_phase'='contract_rent' and p_old->>'status'=(case when p_legacy then 'paid' else 'fully_paid' end)
  and p_new->>'status'='inviting' and (p_new->>'checkout_attempt')::integer=(p_old->>'checkout_attempt')::integer+1
  and r.rent_payment_status='payment_pending' and r.rent_terms_snapshot->>'accepted_by'=r.user_id
  and r.rent_terms_snapshot->>'shared_payment_group_id'=group_id::text
  and (p_new->>'total_amount')::numeric=r.upfront_rent_required
  and (not p_legacy or (p_new->>'contract_total')::numeric=r.contract_rent_total)
  and jsonb_array_length(r.rent_terms_snapshot->'payer_user_ids') between 2 and 3 then return true;end if;
 return false;
end; $function$;
revoke all on function private.shared_rent_phase_transition(jsonb,jsonb,boolean) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.prevent_legacy_shared_checkout_snapshot_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_canonical_status text;
begin
  select payment_group.status into v_canonical_status
  from public.shared_payment_groups payment_group
  where payment_group.shared_payment_group_id=old.canonical_group_id;
  if (old.status in ('payment_pending','paid')
      or new.status in ('payment_pending','paid')
      or v_canonical_status in ('checkout_open','fully_paid'))
    and (
      old.product_type is distinct from new.product_type
      or old.listing_id is distinct from new.listing_id
      or old.reservation_id is distinct from new.reservation_id
      or old.total_amount is distinct from new.total_amount
      or old.member_limit is distinct from new.member_limit
      or old.reservation_fee_total is distinct from new.reservation_fee_total
      or old.contract_total is distinct from new.contract_total
      or old.stay_check_in is distinct from new.stay_check_in
      or old.stay_check_out is distinct from new.stay_check_out
      or old.guest_count is distinct from new.guest_count
      or old.checkout_attempt is distinct from new.checkout_attempt
    )
    and not private.shared_rent_phase_transition(to_jsonb(old),to_jsonb(new),true)
  then
    raise exception 'Open or paid shared checkout terms are immutable';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.prevent_shared_checkout_snapshot_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if (old.status in ('checkout_open','fully_paid')
      or new.status in ('checkout_open','fully_paid'))
    and (
      old.product_type is distinct from new.product_type
      or old.listing_id is distinct from new.listing_id
      or old.reservation_id is distinct from new.reservation_id
      or old.total_amount is distinct from new.total_amount
      or old.capacity is distinct from new.capacity
      or old.payment_phase is distinct from new.payment_phase
      or old.stay_check_in is distinct from new.stay_check_in
      or old.stay_check_out is distinct from new.stay_check_out
      or old.guest_count is distinct from new.guest_count
      or old.checkout_attempt is distinct from new.checkout_attempt
    )
    and not private.shared_rent_phase_transition(to_jsonb(old),to_jsonb(new),false)
  then
    raise exception 'Open or paid shared checkout terms are immutable';
  end if;
  return new;
end
$function$;
commit;
