alter table public.experience_bookings drop constraint experience_bookings_status_check;
alter table public.experience_bookings add constraint experience_bookings_status_check check(status in ('pending_payment','confirmed','review_pending','cancelled','refund_pending','completed'));
alter table public.experience_bookings
 add column attendance_confirmed_at timestamptz,
 add column host_finished_at timestamptz,
 add column customer_completed_at timestamptz,
 add column cancelled_by text,
 add column cancellation_reason text,
 add column review_case_id uuid references public.operational_cases(operational_case_id) on delete restrict,
 add column review_kind text,
 add column refund_decision jsonb;
-- A disputed booking still occupies its accepted places until cancellation.
create or replace function private.experience_session_remaining(p_session_id uuid) returns integer
language sql stable security definer set search_path='' as $$
 select greatest(0,s.capacity-coalesce((select sum(b.participants)::integer from public.experience_bookings b
  where b.session_id=s.id and (b.status in ('confirmed','completed','review_pending') or (b.status='pending_payment' and b.expires_at>now()))),0))
 from public.experience_sessions s where s.id=p_session_id;
$$;
revoke all on function private.experience_session_remaining(uuid) from public,anon,authenticated;

create index experience_bookings_review_case_idx on public.experience_bookings(review_case_id) where review_case_id is not null;
alter table public.financial_action_outbox drop constraint financial_action_outbox_action_type_check;
alter table public.financial_action_outbox add constraint financial_action_outbox_action_type_check check(action_type in(
 'refund_caution_undisputed','refund_caution_balance','release_caution_award','refund_unclaimed_caution','refund_shared_checkout',
 'refund_hotel_cancellation','release_worker_payment','release_long_let_payment','release_short_let_stay','release_hotel_stay',
 'refund_worker_cancellation','refund_worker_review','refund_short_let_cancellation','refund_experience_booking','release_experience_payment'));

create function private.guard_experience_booking_contract() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.id,new.session_id,new.activity_id,new.customer_user_id,new.host_user_id,new.participants,new.contract,new.created_at)
  is distinct from (old.id,old.session_id,old.activity_id,old.customer_user_id,old.host_user_id,old.participants,old.contract,old.created_at) then
  raise exception 'Accepted Experience booking terms and participants cannot change';end if;
 return new;
end $$;
revoke all on function private.guard_experience_booking_contract() from public,anon,authenticated,service_role;
create trigger guard_experience_booking_contract before update on public.experience_bookings for each row execute function private.guard_experience_booking_contract();

insert into public.case_reason_registry(reason_code,label,owning_domain,allowed_subject_types,requires_evidence,customer_description)
 values('experience_booking_review','Experience booking review','finance_operations',array['experience_booking'],false,
 'Ask WeHouse to review a late cancellation, attendance or activity delivery issue. The refund is decided after review.');
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.actor_can_open_case_for_subject(text,text,text)'::regprocedure);
 needle:=$find$(p_subject_type='account' and p_subject_id=p_user_id)$find$;
 if strpos(definition,needle)=0 then raise exception 'Inspect case subject authority before adding Experience bookings';end if;
 execute replace(definition,needle,$new$(p_subject_type='experience_booking' and exists(select 1 from public.experience_bookings experience_booking
   where experience_booking.id::text=p_subject_id and p_user_id in(experience_booking.customer_user_id,experience_booking.host_user_id)))
    or (p_subject_type='account' and p_subject_id=p_user_id)$new$);
 definition:=pg_get_functiondef('public.open_contextual_case(text,text,text,text)'::regprocedure);
 needle:='select coalesce(l.state,h.state,p.state) into v_state';
 if strpos(definition,needle)=0 then raise exception 'Inspect operational case location authority';end if;
 definition:=replace(definition,needle,$new$select coalesce(experience_activity.details->>'state',l.state,h.state,p.state) into v_state$new$);
 needle:='left join public.profiles p on p.user_id=v_user';
 if strpos(definition,needle)=0 then raise exception 'Inspect operational case subject joins';end if;
 definition:=replace(definition,needle,$new$left join public.experience_bookings experience_booking on p_subject_type='experience_booking' and experience_booking.id::text=p_subject_id
  left join public.experience_activities experience_activity on experience_activity.id=experience_booking.activity_id
  left join public.profiles p on p.user_id=v_user$new$);
 execute definition;
end $patch$;

create function public.request_experience_booking_review(p_booking_id uuid,p_kind text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();b public.experience_bookings;p public.payment_protection_transactions;case_id uuid;
begin
 if p_kind is null or p_kind not in ('late_cancellation','activity_not_delivered','host_no_show','payment_issue')
  or length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'Choose a review reason and describe the issue';end if;
 select * into b from public.experience_bookings where id=p_booking_id and customer_user_id=actor for update;
 if b.id is null then raise exception 'Booking unavailable' using errcode='42501';end if;
 if b.review_case_id is not null and b.refund_decision is null then return public.get_my_experience_booking(b.id);end if;
 if b.status<>'confirmed' then raise exception 'Use the current booking controls or contact WeHouse about this payment';end if;
 if p_kind='late_cancellation' and now()<=(b.contract->>'cancellation_deadline')::timestamptz then raise exception 'Use the full-refund cancellation option before its deadline';end if;
 if p_kind in ('activity_not_delivered','host_no_show') and now()<(b.contract->>'starts_at')::timestamptz then raise exception 'The agreed activity has not started yet';end if;
 select * into p from public.payment_protection_transactions where id=b.payment_protection_id for update;
 if p.id is null or p.protection_state<>'protected' then raise exception 'This payment already requires Finance review';end if;
 case_id:=public.open_contextual_case('experience_booking_review','experience_booking',b.id::text,btrim(p_reason));
 insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,reason,metadata)
 values(p.id,p.protection_state,'disputed','experience_review_requested','experience-review:'||case_id,actor,'customer',btrim(p_reason),jsonb_build_object('kind',p_kind,'case_id',case_id));
 update public.payment_protection_transactions set protection_state='disputed',status='disputed',dispute_case_id=case_id,updated_at=now() where id=p.id;
 update public.experience_bookings set status='review_pending',review_case_id=case_id,review_kind=p_kind,updated_at=now() where id=b.id;
 return public.get_my_experience_booking(b.id);
end $$;
revoke all on function public.request_experience_booking_review(uuid,text,text) from public,anon;
grant execute on function public.request_experience_booking_review(uuid,text,text) to authenticated;

create function public.cancel_experience_booking(p_booking_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();b public.experience_bookings;p public.payment_protection_transactions;remaining numeric;
begin
 if length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'Explain why you need to cancel in at least 10 characters';end if;
 select * into b from public.experience_bookings where id=p_booking_id and actor in(customer_user_id,host_user_id) for update;
 if b.id is null or (actor=b.host_user_id and not public.user_has_active_workspace(actor,'worker')) then raise exception 'Booking unavailable' using errcode='42501';end if;
 if b.status in ('cancelled','refund_pending') and b.cancelled_by=actor then return public.get_my_experience_booking(b.id);end if;
 if b.status='pending_payment' then
  update public.experience_bookings set status='cancelled',cancelled_by=actor,cancellation_reason=btrim(p_reason),updated_at=now() where id=b.id;
  return public.get_my_experience_booking(b.id);
 end if;
 if b.status<>'confirmed' then raise exception 'This booking requires WeHouse review';end if;
 if actor=b.customer_user_id and now()>(b.contract->>'cancellation_deadline')::timestamptz then
  return public.request_experience_booking_review(b.id,'late_cancellation',btrim(p_reason));end if;
 select * into p from public.payment_protection_transactions where id=b.payment_protection_id for update;
 remaining:=p.amount_total-p.released_amount-p.refunded_amount;
 if p.id is null or p.protection_state<>'protected' or remaining is distinct from p.amount_total or remaining<=0 then
  raise exception 'Finance must review this payment to provide the full refund';end if;
 insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,reason,metadata)
 values(p.id,p.protection_state,'risk_held','experience_cancelled','experience-cancel:'||b.id,actor,
  case when actor=b.host_user_id then 'worker' else 'customer' end,btrim(p_reason),jsonb_build_object('refund_percent',100));
 update public.payment_protection_transactions set protection_state='risk_held',status='risk_held',risk_held_at=now(),updated_at=now() where id=p.id;
 insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
 values('refund_experience_booking','experience_booking',b.id::text,p.id,remaining,'experience-cancel-refund:'||b.id,
  jsonb_build_object('basis',case when actor=b.host_user_id then 'host_cancellation' else 'before_saved_deadline' end,'refund_percent',100));
 update public.experience_bookings set status='refund_pending',cancelled_by=actor,cancellation_reason=btrim(p_reason),updated_at=now() where id=b.id;
 return public.get_my_experience_booking(b.id);
end $$;
revoke all on function public.cancel_experience_booking(uuid,text) from public,anon;
grant execute on function public.cancel_experience_booking(uuid,text) to authenticated;

create function public.progress_experience_booking(p_booking_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();b public.experience_bookings;p public.payment_protection_transactions;
begin
 select * into b from public.experience_bookings where id=p_booking_id and actor in(customer_user_id,host_user_id) for update;
 if b.id is null then raise exception 'Booking unavailable' using errcode='42501';end if;
 if p_action='complete' and actor=b.customer_user_id and b.customer_completed_at is not null then return public.get_my_experience_booking(b.id);end if;
 if b.status<>'confirmed' then raise exception 'The booking must be confirmed without a pending cancellation or review';end if;
 if p_action='attend' then
  if actor<>b.customer_user_id or now()<(b.contract->>'starts_at')::timestamptz then raise exception 'Only the customer can confirm attendance after the session starts';end if;
  update public.experience_bookings set attendance_confirmed_at=coalesce(attendance_confirmed_at,now()),updated_at=now() where id=b.id;
 elsif p_action='host_finished' then
  if actor<>b.host_user_id or not public.user_has_active_workspace(actor,'worker') or now()<(b.contract->>'ends_at')::timestamptz then raise exception 'Only the active host can mark the session finished after its agreed end';end if;
  update public.experience_bookings set host_finished_at=coalesce(host_finished_at,now()),updated_at=now() where id=b.id;
 elsif p_action='complete' then
  if actor<>b.customer_user_id or b.attendance_confirmed_at is null or b.host_finished_at is null or now()<(b.contract->>'ends_at')::timestamptz then raise exception 'Customer attendance and host completion are required after the session ends';end if;
  select * into p from public.payment_protection_transactions where id=b.payment_protection_id for update;
  if p.id is null or p.protection_state<>'protected' or p.released_amount<>0 or p.refunded_amount<>0 then raise exception 'This payment requires Finance review';end if;
  insert into public.payment_protection_transitions(payment_protection_id,from_state,to_state,event_type,event_key,actor_user_id,actor_type,metadata)
  values(p.id,p.protection_state,'release_eligible','experience_completed','experience-complete:'||b.id,actor,'customer',jsonb_build_object('session_id',b.session_id));
  update public.payment_protection_transactions set protection_state='release_eligible',status='release_eligible',release_eligible_at=now(),updated_at=now() where id=p.id;
  insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
  values('release_experience_payment','experience_booking',b.id::text,p.id,p.amount_total,'experience-release:'||b.id,jsonb_build_object('basis','customer_confirmed_after_host_completion'));
  update public.experience_bookings set status='completed',customer_completed_at=now(),updated_at=now() where id=b.id;
 else raise exception 'Choose a supported booking action';end if;
 return public.get_my_experience_booking(b.id);
end $$;
revoke all on function public.progress_experience_booking(uuid,text) from public,anon;
grant execute on function public.progress_experience_booking(uuid,text) to authenticated;

create function public.decide_experience_booking_review(p_booking_id uuid,p_case_updated_at timestamptz,p_refund_percent numeric,p_reason text,p_creator_elevation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();b public.experience_bookings;p public.payment_protection_transactions;c public.operational_cases;refund numeric;remaining numeric;
begin
 if not public.current_actor_has_workspace('creator',null) or not public.creator_has_elevation(p_creator_elevation_id,'finance_exception') then
  raise exception 'Fresh Creator finance confirmation is required' using errcode='42501';end if;
 if p_refund_percent is null or p_refund_percent::text in ('NaN','Infinity','-Infinity') or p_refund_percent not between 0 and 100 or round(p_refund_percent,2)<>p_refund_percent
  or length(btrim(coalesce(p_reason,''))) not between 20 and 2000 then raise exception 'Record a valid refund percentage and the reviewed decision basis';end if;
 select * into b from public.experience_bookings where id=p_booking_id for update;
 if b.id is null or actor in(b.customer_user_id,b.host_user_id) then raise exception 'Independent financial review is required' using errcode='42501';end if;
 if b.refund_decision=jsonb_build_object('percent',p_refund_percent,'reason',btrim(p_reason),'actor',actor,'case_updated_at',p_case_updated_at) then return to_jsonb(b);end if;
 select * into c from public.operational_cases where operational_case_id=b.review_case_id for update;
 if b.status<>'review_pending' or b.refund_decision is not null or c.operational_case_id is null
  or c.updated_at is distinct from p_case_updated_at or c.status in ('resolved','closed') then raise exception 'Review changed. Refresh the case before deciding';end if;
 select * into p from public.payment_protection_transactions where id=b.payment_protection_id for update;
 remaining:=p.amount_total-p.released_amount-p.refunded_amount;
 if p.id is null or p.protection_state<>'disputed' or remaining is distinct from p.amount_total or remaining<=0 then raise exception 'Protected payment balance requires reconciliation before this decision';end if;
 refund:=round(remaining*p_refund_percent/100,2);
 if refund>0 then
  insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
  values('refund_experience_booking','experience_booking',b.id::text,p.id,refund,'experience-review-refund:'||b.review_case_id,jsonb_build_object('case_id',b.review_case_id,'reason',btrim(p_reason)));
 end if;
 if remaining-refund>0 then
  insert into public.financial_action_outbox(action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key,metadata)
  values('release_experience_payment','experience_booking',b.id::text,p.id,remaining-refund,'experience-review-release:'||b.review_case_id,jsonb_build_object('case_id',b.review_case_id,'reason',btrim(p_reason)));
 end if;
 update public.operational_cases set status='resolved',resolution_code='experience_financial_decision',resolution_summary=btrim(p_reason),resolved_at=now(),updated_at=now() where operational_case_id=b.review_case_id;
 insert into public.operational_case_events(operational_case_id,event_key,event_type,to_status,actor_user_id,public_note,metadata)
 values(b.review_case_id,'experience-review-decision:'||b.review_case_id,'financial_decision','resolved',actor,btrim(p_reason),jsonb_build_object('refund_percent',p_refund_percent,'refund_amount',refund));
 update public.experience_bookings set status=case when refund>0 then 'refund_pending' else 'completed' end,
  refund_decision=jsonb_build_object('percent',p_refund_percent,'reason',btrim(p_reason),'actor',actor,'case_updated_at',p_case_updated_at),updated_at=now() where id=b.id returning * into b;
 return to_jsonb(b);
end $$;
revoke all on function public.decide_experience_booking_review(uuid,timestamptz,numeric,text,uuid) from public,anon;
grant execute on function public.decide_experience_booking_review(uuid,timestamptz,numeric,text,uuid) to authenticated;

create function private.project_experience_refund() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.subject_type='experience_booking' and new.refunded_amount>old.refunded_amount then
  update public.booking_payments set status=case when new.refunded_amount=new.amount_total then 'refunded' else 'partially_refunded' end,
   refund_processed_at=now(),updated_at=now() where experience_booking_id::text=new.subject_id;
 end if;
 if new.subject_type='experience_booking' and new.refunded_amount>0 and new.refunded_amount+new.released_amount=new.amount_total then
  update public.experience_bookings set status='cancelled',updated_at=now() where payment_protection_id=new.id and status<>'cancelled';
 end if;
 return new;
end $$;
revoke all on function private.project_experience_refund() from public,anon,authenticated,service_role;
create trigger project_experience_refund after update of protection_state,released_amount,refunded_amount on public.payment_protection_transactions for each row execute function private.project_experience_refund();

create or replace function public.get_my_experience_booking(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();b public.experience_bookings;p public.payment_protection_transactions;payment public.booking_payments;
begin
 select * into b from public.experience_bookings where id=p_booking_id and (customer_user_id=actor or (host_user_id=actor and public.user_has_active_workspace(actor,'worker')));
 if b.id is null then raise exception 'Booking unavailable' using errcode='42501';end if;
 select * into p from public.payment_protection_transactions where id=b.payment_protection_id;
 select * into payment from public.booking_payments where id=b.payment_id;
 return to_jsonb(b)||jsonb_build_object('money',jsonb_build_object('reference',payment.paystack_reference,'payment_status',payment.status,
  'protection_state',p.protection_state,'total',p.amount_total,'released',p.released_amount,'refunded',p.refunded_amount,'currency',b.contract->>'currency'),
  'customer_name',(select coalesce(nullif(full_name,''),username,'WeHouse customer') from public.profiles where user_id=b.customer_user_id),
  'host_name',(select coalesce(nullif(full_name,''),username,'Experience host') from public.profiles where user_id=b.host_user_id));
end $$;

create function public.get_my_experience_bookings(p_host boolean default false,p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();
begin
 if p_host is null or (p_before is null)<>(p_before_id is null) then raise exception 'Choose a valid booking view and cursor';end if;
 if p_host and not public.user_has_active_workspace(actor,'worker') then raise exception 'Active provider access required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(public.get_my_experience_booking(id) order by created_at desc,id desc),'[]'::jsonb) from (
  select id,created_at from public.experience_bookings where (case when p_host then host_user_id=actor else customer_user_id=actor end)
  and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 21) page);
end $$;
revoke all on function public.get_my_experience_bookings(boolean,timestamptz,uuid) from public,anon;
grant execute on function public.get_my_experience_bookings(boolean,timestamptz,uuid) to authenticated;

create function public.get_experience_finance_reviews(p_elevation_id uuid,p_after timestamptz default null,p_after_id uuid default null,p_booking_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();
begin
 if not public.current_actor_has_workspace('creator',null) or not public.creator_has_elevation(p_elevation_id,'finance_exception') then raise exception 'Fresh Creator finance confirmation required' using errcode='42501';end if;
 if (p_after is null)<>(p_after_id is null) then raise exception 'Choose a complete review cursor';end if;
 return (select coalesce(jsonb_agg(to_jsonb(page) order by updated_at,id),'[]'::jsonb) from (
  select b.id,b.contract,b.status,b.refund_decision,b.review_kind,b.customer_user_id,b.host_user_id,b.review_case_id,c.case_number,c.updated_at,c.resolution_summary,
   (select public_note from public.operational_case_events e where e.operational_case_id=c.operational_case_id order by e.created_at,e.event_key limit 1) as customer_reason,
   p.amount_total,p.refunded_amount,p.released_amount
  from public.experience_bookings b join public.operational_cases c on c.operational_case_id=b.review_case_id
  join public.payment_protection_transactions p on p.id=b.payment_protection_id
  where actor not in (b.customer_user_id,b.host_user_id)
  and (case when p_booking_id is null then b.status='review_pending' and b.refund_decision is null and c.status not in ('resolved','closed') else b.id=p_booking_id end)
  and (p_after is null or (c.updated_at,b.id)>(p_after,p_after_id))
  order by c.updated_at,b.id limit 21) page);
end $$;
revoke all on function public.get_experience_finance_reviews(uuid,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.get_experience_finance_reviews(uuid,timestamptz,uuid,uuid) to authenticated;

create function private.notify_experience_booking_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare event_id uuid;kind text;recipient text;activity_state text;title text;
begin
 if tg_op='INSERT' then kind:='awaiting_payment';
 elsif new.status is distinct from old.status then kind:=new.status;
 elsif new.host_finished_at is distinct from old.host_finished_at then kind:='host_finished';
 elsif new.attendance_confirmed_at is distinct from old.attendance_confirmed_at then kind:='attendance_confirmed';
 else return new;end if;
 perform private.resolve_subject_activity('experience_booking',new.id::text,null,null);
 select details->>'state' into activity_state from public.experience_activities where id=new.activity_id;
 title:=case kind when 'awaiting_payment' then 'Experience checkout ready' when 'confirmed' then 'Experience booking confirmed'
  when 'review_pending' then 'Experience booking is under review' when 'refund_pending' then 'Experience refund pending'
  when 'cancelled' then 'Experience booking cancelled' when 'completed' then 'Experience completion recorded'
  when 'host_finished' then 'Your host marked the Experience finished' else 'Experience attendance recorded' end;
 event_id:=private.upsert_activity_event('experience_booking:'||new.id||':'||kind||':'||new.updated_at::text,
  'experience.booking.'||kind,'experience_booking',new.id::text,public.current_profile_user_id(),title,
  'Open the booking for its saved terms, payment state and current next step.','experience_booking',jsonb_build_object('booking_id',new.id),now());
 perform private.add_activity_audience(event_id,new.customer_user_id,'personal','services',activity_state,kind in ('awaiting_payment','host_finished'));
 if kind<>'awaiting_payment' then perform private.add_activity_audience(event_id,new.host_user_id,'worker','services',activity_state,false);end if;
 if kind='review_pending' then
  event_id:=private.upsert_activity_event('experience_review_case:'||new.review_case_id,'experience.booking.review_requested','experience_booking',new.id::text,
   new.customer_user_id,'Experience booking needs Finance review','Review the saved booking, customer request and protected balance before deciding.',
   'experience_finance_review',jsonb_build_object('booking_id',new.id,'case_id',new.review_case_id),now());
  for recipient in select distinct w.user_id from public.workspace_role_assignments w where w.workspace_role='creator' and w.status='active' and w.revoked_at is null
   and w.user_id not in (new.customer_user_id,new.host_user_id) and public.user_has_active_workspace(w.user_id,'creator') loop
   perform private.add_activity_audience(event_id,recipient,'creator','services',activity_state,true);
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.notify_experience_booking_activity() from public,anon,authenticated,service_role;
create trigger experience_booking_activity after insert or update of status,host_finished_at,attendance_confirmed_at on public.experience_bookings for each row execute function private.notify_experience_booking_activity();

do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.get_my_payment_receipts(text,text,text)'::regprocedure);
 needle:=$find$left join public.worker_bookings wb on wb.id=bp.worker_booking_id$find$;
 if strpos(definition,needle)=0 then raise exception 'Inspect shared receipt joins before adding Experiences';end if;
 definition:=replace(definition,needle,$new$left join public.experience_bookings experience_booking on experience_booking.id=bp.experience_booking_id
    left join public.profiles experience_host on experience_host.user_id=experience_booking.host_user_id
    left join public.worker_bookings wb on wb.id=bp.worker_booking_id$new$);
 definition:=replace(definition,$find$coalesce(h.name,r.listing_title,nullif(worker.full_name,''),worker.username,'WeHouse')$find$,
  $new$coalesce(h.name,r.listing_title,nullif(experience_host.full_name,''),experience_host.username,nullif(worker.full_name,''),worker.username,'WeHouse')$new$);
 definition:=replace(definition,$find$'description',case when bp.purpose='hotel_booking'$find$,
  $new$'description',case when bp.purpose='experience_booking' then coalesce(experience_booking.contract->>'title','Experience booking') when bp.purpose='hotel_booking'$new$);
 definition:=replace(definition,$find$'package_name',hb.rate_plan_name,'cancellation_snapshot',hb.cancellation_snapshot,$find$,
  $new$'package_name',hb.rate_plan_name,'cancellation_snapshot',case when experience_booking.id is not null then jsonb_build_object('refundable',true,'deadline',experience_booking.contract->>'cancellation_deadline','timezone',experience_booking.contract->>'timezone','refund_amount_ngn',(experience_booking.contract->>'total_minor')::numeric/100) else hb.cancellation_snapshot end,
        'session_starts_at',experience_booking.contract->>'starts_at','session_ends_at',experience_booking.contract->>'ends_at','session_timezone',experience_booking.contract->>'timezone','participants',experience_booking.participants,$new$);
 definition:=replace(definition,$find$'booking_id',coalesce(hb.booking_id::text,wb.id::text,r.id),$find$,
  $new$'booking_id',coalesce(experience_booking.id::text,hb.booking_id::text,wb.id::text,r.id),$new$);
 definition:=replace(definition,$find$'booking_type',case when hb.booking_id is not null$find$,
  $new$'booking_type',case when experience_booking.id is not null then 'experience' when hb.booking_id is not null$new$);
 needle:=$find$or (p_subject_type='service' and wb.id::text=p_subject_id)$find$;
 if strpos(definition,needle)=0 then raise exception 'Inspect shared receipt subject authority';end if;
 definition:=replace(definition,needle,$new$or (p_subject_type='experience' and experience_booking.id::text=p_subject_id)
        or (p_subject_type='service' and wb.id::text=p_subject_id)$new$);
 if strpos(definition,$find$'session_starts_at'$find$)=0 or strpos(definition,$find$then 'experience'$find$)=0 then raise exception 'Experience receipt projection is incomplete';end if;
 execute definition;
end $patch$;
