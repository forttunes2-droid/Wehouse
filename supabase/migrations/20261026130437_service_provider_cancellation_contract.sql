begin;
alter table public.worker_bookings drop constraint service_quote_revision_pair;
alter table public.worker_bookings add constraint service_quote_revision_pair check(
 (service_quote is null and service_quote_revision=0) or
 (service_quote is not null and jsonb_typeof(service_quote)='object' and service_quote_revision>0));
alter table public.worker_bookings add constraint service_quote_acceptance_current check(
 service_quote_accepted_revision is null or
 (service_quote is not null and service_quote_accepted_revision=service_quote_revision));
alter table public.worker_refund_reviews drop constraint worker_refund_reviews_kind_check;
alter table public.worker_refund_reviews add constraint worker_refund_reviews_kind_check check(kind in(
 'customer_cancel_after_start','worker_no_show','worker_not_delivered','customer_late_cancellation'));

do $guard$
declare definition text;anchor text;
begin
 definition:=pg_get_functiondef('private.accepted_service_quote(uuid,boolean)'::regprocedure);
 anchor:=$a$ if b.id is null or q is null$a$;
 if position(anchor in definition)=0 then raise exception 'Inspect accepted Service quote validation before upgrading';end if;
 execute replace(definition,anchor,E' if q is not null and (nullif(btrim(q->>''starts_at''),'''') is null\n  or nullif(btrim(q->''cancellation''->>''full_refund_until''),'''') is null\n  or char_length(btrim(coalesce(q->>''scope'',''''))) not between 10 and 4000\n  or nullif(btrim(q->>''address''),'''') is null\n  or not exists(select 1 from pg_catalog.pg_timezone_names where name=q->>''timezone'')) then\n  raise exception ''Service quote details are incomplete'';\n end if;\n'||anchor);
 definition:=pg_get_functiondef('public.request_worker_refund_review(uuid,text,text)'::regprocedure);
 anchor:=$a$  select review_id into v_id from public.worker_refund_reviews where worker_booking_id=p_booking_id and status='open';$a$;
 if position(anchor in definition)=0 then raise exception 'Inspect Service refund-review validation before upgrading';end if;
 execute replace(definition,E'  select review_id into v_id from public.worker_refund_reviews where worker_booking_id=p_booking_id and status=''open'';',
 E'  IF p_kind=''customer_late_cancellation'' AND (v_booking.service_quote IS NULL OR v_booking.started_at IS NOT NULL\n    OR clock_timestamp()<=(v_booking.service_quote->''cancellation''->>''full_refund_until'')::timestamptz) THEN\n    RAISE EXCEPTION ''Use the cancellation option for this booking stage'';\n  END IF;\n'||anchor);
end $guard$;

create function public.provider_cancel_my_service_booking(p_booking_id uuid,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles;b public.worker_bookings;p public.payment_protection_transactions;remaining numeric;
begin
 if not public._property_document_session_active() then raise exception 'Active trusted session required';end if;
 select * into actor from public.profiles where auth_id=(select auth.uid())::text
 and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
 if actor.user_id is null or not public.current_actor_has_workspace('worker',null) then raise exception 'Active Service Provider access required';end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Explain why you need to cancel';end if;
 select * into b from public.worker_bookings where id=p_booking_id for update;
 if b.id is null or b.worker_id is distinct from actor.user_id then raise exception 'Booking not found';end if;
 if b.status='cancelled' and b.cancelled_by='worker' then return jsonb_build_object('cancelled',true,'already',true);end if;
 if b.status not in('confirmed','in_progress') then raise exception 'Use the booking controls or ask WeHouse to review this cancellation';end if;
 select * into p from public.payment_protection_transactions where id=b.payment_protection_id for update;
 if p.id is null or p.payer_user_id is distinct from b.user_id or p.payee_user_id is distinct from actor.user_id
  or p.protection_state not in('protected','release_eligible') then raise exception 'Protected money requires WeHouse review before cancellation';end if;
 remaining:=p.amount_total-p.released_amount-p.refunded_amount;
 if remaining is distinct from p.amount_total or remaining<=0 then raise exception 'This payment needs Finance review to provide the full customer refund';end if;
 insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,metadata)
 values(p.id,p.protection_state,'risk_held','provider_cancelled_service','provider-cancel:'||b.id,actor.user_id,'worker',jsonb_build_object('refund_percent',100))
 on conflict(event_key) do nothing;
 update public.payment_protection_transactions set protection_state='risk_held',status='risk_held',risk_held_at=now(),updated_at=now() where id=p.id;
 insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
 values('refund_worker_cancellation','worker_job',b.id::text,p.id,remaining,'refund_worker_cancellation:'||b.id,
 jsonb_build_object('refund_percent',100,'basis','provider_cancelled_full_refund'))
 on conflict(idempotency_key) do nothing;
 insert into public.worker_job_transitions(worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,policy_version_id,metadata)
 values(b.id,coalesce(b.canonical_job_state,b.status),'cancelled','provider_cancelled_service','provider-cancel-state:'||b.id,actor.user_id,'worker',b.policy_version_id,jsonb_build_object('reason',btrim(p_reason)))
 on conflict(event_key) do nothing;
 update public.worker_bookings set status='cancelled',canonical_job_state='cancelled',cancelled_by='worker',cancellation_reason=btrim(p_reason),updated_at=now() where id=b.id;
 return jsonb_build_object('cancelled',true,'refund_amount',remaining,'refund_pending',true);
end $$;
revoke all on function public.provider_cancel_my_service_booking(uuid,text) from public,anon;
grant execute on function public.provider_cancel_my_service_booking(uuid,text) to authenticated;
commit;
