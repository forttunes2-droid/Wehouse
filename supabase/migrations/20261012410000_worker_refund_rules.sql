-- Service Worker cancellations and refunds.
--  * Before work starts: the customer's cancel refunds automatically, using the
--    Creator policy worker_refund_rules.before_start_refund_percent (100 if unset).
--  * After work starts, or when the worker does not show up or deliver: the money stays
--    in payment protection and a WeHouse review decides the refund share. The review
--    cannot exceed worker_refund_rules.review_max_refund_percent (100 if unset).
-- Refund and release are Finance commands in financial_action_outbox, idempotent by key.

alter table public.financial_action_outbox drop constraint if exists financial_action_outbox_action_type_check;
alter table public.financial_action_outbox add constraint financial_action_outbox_action_type_check check(action_type in(
  'refund_caution_undisputed','refund_caution_balance','release_caution_award','refund_unclaimed_caution',
  'refund_shared_checkout','refund_hotel_cancellation','release_worker_payment','release_long_let_payment',
  'release_short_let_stay','release_hotel_stay','refund_worker_cancellation','refund_worker_review'));

create or replace function private.validate_worker_refund_rules_policy()
returns trigger language plpgsql set search_path to 'pg_catalog','public' as $$
begin
  if new.policy_key<>'worker_refund_rules' then return new; end if;
  if coalesce((new.value->>'before_start_refund_percent')::numeric,-1) not between 0 and 100
     or coalesce((new.value->>'review_max_refund_percent')::numeric,-1) not between 0 and 100 then
    raise exception 'Worker refund percentages must be between 0 and 100';
  end if;
  return new;
end $$;
drop trigger if exists validate_worker_refund_rules_policy on public.creator_policy_versions;
create trigger validate_worker_refund_rules_policy before insert or update of value on public.creator_policy_versions
for each row execute function private.validate_worker_refund_rules_policy();

create or replace function private.worker_refund_rule(p_key text)
returns numeric language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select coalesce((
    select (policy.value->>p_key)::numeric from public.creator_policy_versions policy
    where policy.policy_key='worker_refund_rules' and policy.scope_type='global' and policy.scope_key='*'
      and policy.status='active' and policy.effective_from<=now()
      and (policy.effective_until is null or policy.effective_until>now())
    order by policy.effective_from desc limit 1),100)
$$;
revoke all on function private.worker_refund_rule(text) from public,anon,authenticated;

create table if not exists public.worker_refund_reviews(
  review_id uuid primary key default gen_random_uuid(),
  worker_booking_id uuid not null references public.worker_bookings(id),
  requested_by text not null,
  kind text not null check(kind in('customer_cancel_after_start','worker_no_show','worker_not_delivered')),
  reason text not null check(char_length(btrim(reason))>=10),
  status text not null default 'open' check(status in('open','decided')),
  refund_percent numeric check(refund_percent is null or refund_percent between 0 and 100),
  refund_amount numeric,
  release_amount numeric,
  decided_by text,
  decision_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists worker_refund_reviews_one_open on public.worker_refund_reviews(worker_booking_id) where status='open';
alter table public.worker_refund_reviews enable row level security;
revoke all on public.worker_refund_reviews from public,anon,authenticated;

create or replace function public.cancel_my_worker_booking(p_booking_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_booking public.worker_bookings;
  v_protection public.payment_protection_transactions;
  v_state text; v_pct numeric; v_amount numeric; v_remaining numeric;
begin
  if v_actor is null then raise exception 'Sign in required'; end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.user_id<>v_actor then raise exception 'Booking not found'; end if;
  v_state:=coalesce(v_booking.canonical_job_state,v_booking.status);
  if v_state='cancelled' then return jsonb_build_object('cancelled',true,'already',true); end if;
  if v_state in('completed','completion_marked','disputed','refunded')
     or v_booking.started_at is not null or v_state='in_progress' then
    raise exception 'Work has started. Ask for a refund review instead.';
  end if;

  if v_booking.payment_protection_id is not null then
    select * into v_protection from public.payment_protection_transactions
    where id=v_booking.payment_protection_id for update;
    if v_protection.id is not null and v_protection.payer_user_id=v_actor
       and v_protection.protection_state in('protected','release_eligible') then
      v_remaining:=v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount;
      v_pct:=private.worker_refund_rule('before_start_refund_percent');
      v_amount:=round(v_remaining*v_pct/100,2);
      insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,metadata)
      values(v_protection.id,v_protection.protection_state,'risk_held','worker_cancelled_before_start','worker-cancel:'||p_booking_id,v_actor,'customer',jsonb_build_object('refund_percent',v_pct))
      on conflict(event_key) do nothing;
      update public.payment_protection_transactions set protection_state='risk_held',status='risk_held',risk_held_at=now(),updated_at=now() where id=v_protection.id;
      if v_amount>0 then
        insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
        values('refund_worker_cancellation','worker_job',p_booking_id::text,v_protection.id,v_amount,'refund_worker_cancellation:'||p_booking_id,
          jsonb_build_object('refund_percent',v_pct,'basis','amount_paid'))
        on conflict(idempotency_key) do nothing;
      end if;
      if v_remaining-v_amount>0 then
        insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
        values('release_worker_payment','worker_job',p_booking_id::text,v_protection.id,v_remaining-v_amount,'worker-cancel-release:'||p_booking_id,
          jsonb_build_object('trigger','cancel_before_start_retained_share'))
        on conflict(idempotency_key) do nothing;
      end if;
    end if;
  end if;

  insert into public.worker_job_transitions(worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,policy_version_id,metadata)
  values(p_booking_id,v_state,'cancelled','customer_cancelled_before_start','worker-cancel-state:'||p_booking_id,v_actor,'customer',v_booking.policy_version_id,jsonb_build_object('reason',left(coalesce(p_reason,''),500)))
  on conflict(event_key) do nothing;
  update public.worker_bookings set status='cancelled',canonical_job_state='cancelled',cancelled_by='customer',
    cancellation_reason=left(nullif(btrim(coalesce(p_reason,'')),''),500),updated_at=now() where id=p_booking_id;
  return jsonb_build_object('cancelled',true,'refund_amount',coalesce(v_amount,0),'refund_percent',coalesce(v_pct,0));
end $$;
revoke all on function public.cancel_my_worker_booking(uuid,text) from public,anon;
grant execute on function public.cancel_my_worker_booking(uuid,text) to authenticated,service_role;

create or replace function public.request_worker_refund_review(p_booking_id uuid,p_kind text,p_reason text)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_booking public.worker_bookings; v_protection public.payment_protection_transactions; v_id uuid;
begin
  if v_actor is null then raise exception 'Sign in required'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Please describe what happened (at least 10 characters)'; end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.user_id<>v_actor then raise exception 'Booking not found'; end if;
  select review_id into v_id from public.worker_refund_reviews where worker_booking_id=p_booking_id and status='open';
  if v_id is not null then return v_id; end if;
  select * into v_protection from public.payment_protection_transactions where id=v_booking.payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state not in('protected','release_eligible') then
    raise exception 'There is no protected payment to review';
  end if;
  insert into public.worker_refund_reviews(worker_booking_id,requested_by,kind,reason)
  values(p_booking_id,v_actor,p_kind,btrim(p_reason)) returning review_id into v_id;
  insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,metadata)
  values(v_protection.id,v_protection.protection_state,'disputed','worker_refund_review_requested','worker-refund-review:'||v_id,v_actor,'customer',jsonb_build_object('kind',p_kind))
  on conflict(event_key) do nothing;
  update public.payment_protection_transactions set protection_state='disputed',status='disputed',updated_at=now() where id=v_protection.id;
  insert into public.worker_job_transitions(worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,policy_version_id,metadata)
  values(p_booking_id,coalesce(v_booking.canonical_job_state,v_booking.status),'disputed','refund_review_requested','worker-refund-review-state:'||v_id,v_actor,'customer',v_booking.policy_version_id,jsonb_build_object('kind',p_kind))
  on conflict(event_key) do nothing;
  update public.worker_bookings set canonical_job_state='disputed',updated_at=now() where id=p_booking_id;
  return v_id;
end $$;
revoke all on function public.request_worker_refund_review(uuid,text,text) from public,anon;
grant execute on function public.request_worker_refund_review(uuid,text,text) to authenticated,service_role;

create or replace function public.decide_worker_refund(p_review_id uuid,p_refund_percent numeric,p_reason text)
returns public.worker_refund_reviews language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare
  v_actor public.profiles; v_review public.worker_refund_reviews; v_booking public.worker_bookings;
  v_protection public.payment_protection_transactions; v_remaining numeric; v_refund numeric; v_release numeric;
begin
  select * into v_actor from public.profiles where user_id=public.current_profile_user_id()
    and role in('creator','admin','staff') and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
  if v_actor.user_id is null or (v_actor.role='staff' and not public.current_staff_has_permission('operations')) then
    raise exception 'Operations access required';
  end if;
  if p_refund_percent is null or p_refund_percent<0 or p_refund_percent>private.worker_refund_rule('review_max_refund_percent') then
    raise exception 'Refund share is outside the allowed range';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<10 then raise exception 'A clear reason is required'; end if;
  select * into v_review from public.worker_refund_reviews where review_id=p_review_id for update;
  if v_review.review_id is null or v_review.status<>'open' then raise exception 'Review is not open'; end if;
  select * into v_booking from public.worker_bookings where id=v_review.worker_booking_id for update;
  select * into v_protection from public.payment_protection_transactions where id=v_booking.payment_protection_id for update;
  v_remaining:=v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount;
  if v_remaining<=0 then raise exception 'No protected balance remains'; end if;
  v_refund:=round(v_remaining*p_refund_percent/100,2);
  v_release:=v_remaining-v_refund;
  if v_refund>0 then
    insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
    values('refund_worker_review','worker_job',v_booking.id::text,v_protection.id,v_refund,'refund_worker_review:'||p_review_id,
      jsonb_build_object('refund_percent',p_refund_percent,'basis','amount_paid','kind',v_review.kind))
    on conflict(idempotency_key) do nothing;
  end if;
  if v_release>0 then
    insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
    values('release_worker_payment','worker_job',v_booking.id::text,v_protection.id,v_release,'worker-refund-release:'||p_review_id,
      jsonb_build_object('trigger','refund_review_retained_share'))
    on conflict(idempotency_key) do nothing;
  end if;
  insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,reason,metadata)
  values(v_protection.id,v_protection.protection_state,'risk_held','worker_refund_decided','worker-refund-decided:'||p_review_id,v_actor.user_id,'operations',btrim(p_reason),jsonb_build_object('refund_percent',p_refund_percent))
  on conflict(event_key) do nothing;
  update public.payment_protection_transactions set protection_state='risk_held',status='risk_held',risk_held_at=now(),updated_at=now() where id=v_protection.id;
  update public.worker_bookings set canonical_job_state=case when p_refund_percent=100 then 'cancelled' else 'completed' end,
    status=case when p_refund_percent=100 then 'cancelled' else status end,updated_at=now() where id=v_booking.id;
  update public.worker_refund_reviews set status='decided',refund_percent=p_refund_percent,refund_amount=v_refund,release_amount=v_release,
    decided_by=v_actor.user_id,decision_reason=btrim(p_reason),decided_at=now() where review_id=p_review_id returning * into v_review;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor.user_id,'decide_worker_refund','worker_booking',v_booking.id::text,
    jsonb_build_object('review_id',p_review_id,'refund_percent',p_refund_percent,'reason',btrim(p_reason))::text,now());
  return v_review;
end $$;
revoke all on function public.decide_worker_refund(uuid,numeric,text) from public,anon;
grant execute on function public.decide_worker_refund(uuid,numeric,text) to authenticated,service_role;
