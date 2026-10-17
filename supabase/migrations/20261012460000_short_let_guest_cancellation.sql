-- A guest can cancel a paid Short Let stay in the clear case: a refundable rate and enough time
-- before check-in (Creator policy short_let_cancellation). The refund is what the guest actually paid,
-- discount included, and is queued once for Finance. Late cancellations and non-refundable rates
-- are not decided here; the guest is told to ask WeHouse for a review.
alter table public.financial_action_outbox drop constraint if exists financial_action_outbox_action_type_check;
alter table public.financial_action_outbox add constraint financial_action_outbox_action_type_check check(action_type in(
  'refund_caution_undisputed','refund_caution_balance','release_caution_award','refund_unclaimed_caution',
  'refund_shared_checkout','refund_hotel_cancellation','release_worker_payment','release_long_let_payment',
  'release_short_let_stay','release_hotel_stay','refund_worker_cancellation','refund_worker_review',
  'refund_short_let_cancellation'));

create or replace function public.cancel_my_paid_short_let(p_reservation_id text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare
  v_actor text:=public.current_profile_user_id();
  r public.reservations; p public.payment_protection_transactions;
  v_hours numeric; v_remaining numeric; v_snapshot jsonb;
begin
  if v_actor is null then raise exception 'Sign in required'; end if;
  select * into r from public.reservations where id=p_reservation_id and user_id=v_actor for update;
  if r.id is null or coalesce(r.stay_type,'')<>'short_let' then raise exception 'Reservation not found'; end if;
  if r.status='cancelled' then
    return jsonb_build_object('refund_amount',coalesce((select refunded_amount from public.payment_protection_transactions where id=r.stay_payment_protection_id),0),'already',true);
  end if;
  if r.status in('completed','expired') or r.stay_payment_protection_id is null then
    raise exception 'This stay cannot be cancelled here';
  end if;
  v_snapshot:=coalesce(r.short_stay_cancellation_policy_snapshot,'{}'::jsonb);
  if coalesce((v_snapshot->>'non_refundable')::boolean,false) then
    raise exception 'This is a non-refundable rate. If the host failed you, ask WeHouse for a review.';
  end if;
  v_hours:=coalesce((v_snapshot->>'standard_full_refund_hours_before_check_in')::numeric,24);
  if r.stay_check_in is null
     or (r.stay_check_in::timestamp at time zone 'Africa/Lagos')-now()<make_interval(hours=>v_hours::integer) then
    raise exception 'This is inside the free-cancellation window. Ask WeHouse for a review.';
  end if;
  if r.caution_payment_protection_id is not null then
    raise exception 'This stay has a security deposit. Ask WeHouse to cancel it so the deposit is returned too.';
  end if;
  select * into p from public.payment_protection_transactions where id=r.stay_payment_protection_id for update;
  if p.id is null or p.protection_state not in('protected','release_eligible') then
    raise exception 'There is no protected payment to refund';
  end if;
  if exists(select 1 from public.financial_action_outbox where payment_protection_id=p.id and status<>'completed') then
    raise exception 'Payment requires Finance reconciliation before cancellation';
  end if;
  v_remaining:=p.amount_total-p.released_amount-p.refunded_amount;
  if v_remaining>0 then
    insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
    values('refund_short_let_cancellation','short_let',r.id,p.id,v_remaining,'short-let-cancellation:'||r.id,
      jsonb_build_object('basis','amount_paid','hours_before_check_in',v_hours))
    on conflict(idempotency_key) do nothing;
  end if;
  insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,reason,metadata)
  values(p.id,p.protection_state,'risk_held','short_let_guest_cancelled','short-let-cancelled:'||r.id,v_actor,'customer','Guest cancelled before the free-cancellation deadline',jsonb_build_object('refund_amount',v_remaining))
  on conflict(event_key) do nothing;
  update public.payment_protection_transactions set protection_state='risk_held',status='risk_held',risk_held_at=now(),updated_at=now() where id=p.id;
  update public.reservations set status='cancelled',processed_at=now(),updated_at=now() where id=r.id;
  update public.listings set reserved_by=null,reservation_expiry=null,occupied_by=null,occupied_at=null,tenancy_ends_at=null,current_reservation_id=null,updated_at=now()
  where id::text=r.listing_id and current_reservation_id=r.id;
  return jsonb_build_object('refund_amount',v_remaining,'already',false);
end $$;
revoke all on function public.cancel_my_paid_short_let(text) from public,anon;
grant execute on function public.cancel_my_paid_short_let(text) to authenticated,service_role;
