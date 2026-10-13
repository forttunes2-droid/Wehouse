-- Refund review authority is global only for the Creator.
-- Admin/Staff area scoping must wait for a structured immutable service-area snapshot
-- on each booking; the free-text address and provider coordinates are not an authorization boundary.

create or replace function public.list_worker_refund_reviews(p_status text default 'open')
returns table(review_id uuid, worker_booking_id uuid, kind text, reason text, status text, created_at timestamptz,
  amount_total numeric, released_amount numeric, refunded_amount numeric, refund_percent numeric, refund_amount numeric,
  max_refund_percent numeric)
language plpgsql stable security definer set search_path to 'pg_catalog','public' as $$
begin
  if not exists(select 1 from public.profiles
    where user_id=public.current_profile_user_id() and role='creator'
      and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then
    raise exception 'Creator access required';
  end if;
  return query
  select r.review_id,r.worker_booking_id,r.kind,r.reason,r.status,r.created_at,
    p.amount_total,p.released_amount,p.refunded_amount,r.refund_percent,r.refund_amount,
    private.worker_refund_rule('review_max_refund_percent')
  from public.worker_refund_reviews r
  join public.worker_bookings b on b.id=r.worker_booking_id
  left join public.payment_protection_transactions p on p.id=b.payment_protection_id
  where r.status=p_status
  order by r.created_at desc limit 100;
end $$;

create or replace function public.decide_worker_refund(p_review_id uuid,p_refund_percent numeric,p_reason text)
returns public.worker_refund_reviews language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare
  v_actor public.profiles; v_review public.worker_refund_reviews; v_booking public.worker_bookings;
  v_protection public.payment_protection_transactions; v_remaining numeric; v_refund numeric; v_release numeric;
begin
  select * into v_actor from public.profiles where user_id=public.current_profile_user_id()
    and role='creator' and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
  if v_actor.user_id is null then raise exception 'Creator access required'; end if;
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

revoke all on function public.list_worker_refund_reviews(text),public.decide_worker_refund(uuid,numeric,text) from public,anon,service_role;
grant execute on function public.list_worker_refund_reviews(text),public.decide_worker_refund(uuid,numeric,text) to authenticated;
