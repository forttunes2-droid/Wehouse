-- Retire the last direct Worker wallet-release path. Product actions update the
-- Worker job and Payment Protection state; only the financial outbox processor
-- posts money and its idempotent projection updates the compatibility wallet.

create or replace function public.sync_worker_protected_payment_state()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_booking public.worker_bookings; v_from text;
begin
  if new.subject_type<>'worker_booking' or new.protection_state<>'protected'
    or old.protection_state='protected' then return new; end if;
  select * into v_booking from public.worker_bookings
  where id=new.subject_id::uuid for update;
  if v_booking.id is null then raise exception 'Protected Worker job is missing'; end if;
  v_from:=coalesce(v_booking.canonical_job_state,'awaiting_payment');
  if v_from in('requested','negotiating') then v_from:='awaiting_payment'; end if;
  if v_booking.canonical_job_state is distinct from 'confirmed' then
    update public.worker_bookings set canonical_job_state='confirmed',
      payment_protection_id=new.id,updated_at=now() where id=v_booking.id;
    insert into public.worker_job_transitions(
      worker_booking_id,from_state,to_state,event_type,event_key,actor_type,
      policy_version_id,metadata
    ) values(v_booking.id,v_from,'confirmed','payment_protection_confirmed',
      'worker-payment-protected:'||new.id,'paystack',v_booking.policy_version_id,
      jsonb_build_object('payment_protection_id',new.id))
    on conflict(event_key) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists sync_worker_protected_payment_state
  on public.payment_protection_transactions;
create trigger sync_worker_protected_payment_state
after update of protection_state on public.payment_protection_transactions
for each row execute function public.sync_worker_protected_payment_state();

create or replace function public.worker_start_job(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_booking public.worker_bookings; v_from text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_workspace('worker')
    or v_actor.worker_status<>'verified' or v_actor.worker_verified is distinct from true then
    raise exception 'Active verified Worker workspace required';
  end if;
  if not public.worker_identity_is_current(v_actor.user_id) then
    raise exception 'Repeat your WeHouse identity check before starting new work';
  end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.worker_id<>v_actor.user_id
    or v_booking.status<>'confirmed' then raise exception 'Job is not ready to start'; end if;
  if v_booking.payment_protection_id is null or not exists(
    select 1 from public.payment_protection_transactions p
    where p.id=v_booking.payment_protection_id and p.protection_state='protected'
  ) then raise exception 'Payment Protection must be confirmed before work starts'; end if;
  v_from:=coalesce(v_booking.canonical_job_state,'confirmed');
  if v_from<>'confirmed' then raise exception 'Canonical job is not ready to start'; end if;
  update public.worker_bookings set status='in_progress',canonical_job_state='in_progress',
    started_at=coalesce(started_at,now()),updated_at=now() where id=p_booking_id;
  insert into public.worker_job_transitions(
    worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(p_booking_id,v_from,'in_progress','worker_started',
    'worker-started:'||p_booking_id,v_actor.user_id,'worker',v_booking.policy_version_id,
    '{}'::jsonb) on conflict(event_key) do nothing;
  return true;
end
$$;

create or replace function public.worker_mark_complete(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_booking public.worker_bookings; v_from text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_workspace('worker') then
    raise exception 'Active Worker workspace required';
  end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.worker_id<>v_actor.user_id then
    raise exception 'Job not found';
  end if;
  if v_booking.status='completed_pending_approval'
    and v_booking.canonical_job_state='completion_marked' then return true; end if;
  if v_booking.status<>'in_progress' then raise exception 'Job is not in progress'; end if;
  v_from:=coalesce(v_booking.canonical_job_state,'in_progress');
  if v_from<>'in_progress' then raise exception 'Canonical job is not in progress'; end if;
  update public.worker_bookings set
    status='completed_pending_approval',canonical_job_state='completion_marked',
    worker_approved=true,marked_complete_at=coalesce(marked_complete_at,now()),
    release_eligible_at=now()+interval '24 hours',
    help_until=coalesce(help_until,now()+interval '3 days'),updated_at=now()
  where id=p_booking_id;
  insert into public.worker_job_transitions(
    worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(p_booking_id,v_from,'completion_marked','worker_marked_complete',
    'worker-completion-marked:'||p_booking_id,v_actor.user_id,'worker',
    v_booking.policy_version_id,jsonb_build_object(
      'release_eligible_after_hours',24,'reminder_available_after_hours',12,
      'help_window_days',3)) on conflict(event_key) do nothing;
  return true;
end
$$;

create or replace function public.customer_confirm_completion(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles; v_booking public.worker_bookings;
  v_protection public.payment_protection_transactions; v_from text;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.user_id<>v_actor.user_id then
    raise exception 'Job not found';
  end if;
  if v_booking.status='approved_released' then return true; end if;
  if v_booking.status<>'completed_pending_approval'
    or coalesce(v_booking.canonical_job_state,'')<>'completion_marked' then
    raise exception 'Worker has not marked this job complete';
  end if;
  if v_booking.risk_flag or v_booking.payment_conflict or v_booking.chargeback_open
    or exists(select 1 from public.worker_user_blocks b
      where (b.blocker_user_id=v_booking.user_id and b.blocked_user_id=v_booking.worker_id)
         or (b.blocker_user_id=v_booking.worker_id and b.blocked_user_id=v_booking.user_id))
    or exists(select 1 from public.operational_cases c
      where c.subject_type='worker_job' and c.subject_id=v_booking.id::text
        and c.status not in('resolved','closed')) then
    raise exception 'This job needs controlled WeHouse review before release';
  end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_booking.payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state not in('protected','release_eligible') then
    raise exception 'Worker Payment Protection is not releasable';
  end if;
  if v_protection.protection_state='protected' then
    insert into public.payment_protection_transitions(
      payment_protection_id,from_state,to_state,event_type,event_key,
      actor_user_id,actor_type,metadata
    ) values(v_protection.id,'protected','release_eligible',
      'customer_confirmed_completion','worker-customer-release-eligible:'||p_booking_id,
      v_actor.user_id,'customer',jsonb_build_object('worker_booking_id',p_booking_id))
    on conflict(event_key) do nothing;
    update public.payment_protection_transactions set protection_state='release_eligible',
      status='release_eligible',release_eligible_at=now(),updated_at=now()
    where id=v_protection.id and protection_state='protected';
  end if;
  v_from:=v_booking.canonical_job_state;
  update public.worker_bookings set canonical_job_state='completed',user_approved=true,
    completed_at=coalesce(completed_at,now()),
    help_until=coalesce(help_until,now()+interval '3 days'),
    review_edit_until=coalesce(review_edit_until,now()+interval '48 hours'),
    updated_at=now() where id=p_booking_id;
  insert into public.worker_job_transitions(
    worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(p_booking_id,v_from,'completed','customer_confirmed_completion',
    'worker-customer-completed:'||p_booking_id,v_actor.user_id,'customer',
    v_booking.policy_version_id,jsonb_build_object('release_queued',true))
  on conflict(event_key) do nothing;
  insert into public.financial_action_outbox(
    action_type,subject_type,subject_id,payment_protection_id,amount,
    idempotency_key,metadata
  ) select 'release_worker_payment','worker_job',p_booking_id::text,v_protection.id,
    v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount,
    'release_worker_payment:'||p_booking_id,
    jsonb_build_object('trigger','customer_confirmed_completion','customer_id',v_actor.user_id)
  where v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount>0
  on conflict(idempotency_key) do nothing;
  return true;
end
$$;

create or replace function public.customer_raise_dispute(p_booking_id uuid,p_reason text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles; v_booking public.worker_bookings;
  v_protection public.payment_protection_transactions; v_from text; v_case jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Explain what needs review'; end if;
  select * into v_booking from public.worker_bookings where id=p_booking_id for update;
  if v_booking.id is null or v_booking.user_id<>v_actor.user_id
    or v_booking.status not in('confirmed','in_progress','completed_pending_approval') then
    raise exception 'Job is not eligible for review';
  end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_booking.payment_protection_id for update;
  if v_protection.id is null or v_protection.protection_state not in('protected','release_eligible','disputed') then
    raise exception 'Worker Payment Protection is unavailable';
  end if;
  if v_protection.protection_state<>'disputed' then
    insert into public.payment_protection_transitions(
      payment_protection_id,from_state,to_state,event_type,event_key,
      actor_user_id,actor_type,reason,metadata
    ) values(v_protection.id,v_protection.protection_state,'disputed',
      'customer_requested_job_review','worker-disputed:'||p_booking_id,
      v_actor.user_id,'customer',btrim(p_reason),jsonb_build_object('worker_booking_id',p_booking_id))
    on conflict(event_key) do nothing;
    update public.payment_protection_transactions set protection_state='disputed',
      status='disputed',updated_at=now() where id=v_protection.id;
  end if;
  v_from:=coalesce(v_booking.canonical_job_state,
    case v_booking.status when 'confirmed' then 'confirmed' when 'in_progress' then 'in_progress'
      else 'completion_marked' end);
  update public.worker_bookings set status='disputed',canonical_job_state='disputed',
    dispute_reason=btrim(p_reason),updated_at=now() where id=p_booking_id;
  insert into public.worker_job_transitions(
    worker_booking_id,from_state,to_state,event_type,event_key,actor_user_id,
    actor_type,policy_version_id,metadata
  ) values(p_booking_id,v_from,'disputed','customer_requested_job_review',
    'worker-job-disputed:'||p_booking_id,v_actor.user_id,'customer',
    v_booking.policy_version_id,jsonb_build_object('reason',btrim(p_reason)))
  on conflict(event_key) do nothing;
  update public.escrow_transactions set status='disputed',updated_at=now()
  where booking_id=p_booking_id and booking_type='worker_booking'
    and status not in('released','refunded');
  v_case:=public.open_contextual_case_conversation(
    'worker_job_issue','worker_job',p_booking_id::text,btrim(p_reason),
    jsonb_build_object('booking_code',v_booking.booking_code,
      'service_type',v_booking.service_type,'worker_id',v_booking.worker_id,
      'payment_protection_id',v_protection.id)
  );
  return true;
end
$$;

create or replace function public.sync_worker_release_completion()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_protection public.payment_protection_transactions;
begin
  select * into v_protection from public.payment_protection_transactions
  where id=new.payment_protection_id;
  if v_protection.subject_type='worker_booking' then
    update public.worker_bookings set status='approved_released',
      canonical_job_state='completed',completed_at=coalesce(completed_at,now()),
      review_edit_until=coalesce(review_edit_until,now()+interval '48 hours'),
      help_until=coalesce(help_until,now()+interval '3 days'),updated_at=now()
    where id=v_protection.subject_id::uuid;
    -- Legacy record is a compatibility projection and changes only after the
    -- canonical ledger release and wallet projection both succeeded.
    update public.escrow_transactions set status='released',released_at=now(),
      released_by='finance_processor',updated_at=now()
    where booking_id=v_protection.subject_id::uuid
      and booking_type='worker_booking'
      and status not in('released','refunded','disputed');
  end if;
  return new;
end
$$;

drop trigger if exists sync_worker_release_completion
  on public.canonical_wallet_release_receipts;
create trigger sync_worker_release_completion
after insert on public.canonical_wallet_release_receipts
for each row execute function public.sync_worker_release_completion();

revoke all on function public.worker_start_job(uuid) from public,anon;
revoke all on function public.worker_mark_complete(uuid) from public,anon;
revoke all on function public.customer_confirm_completion(uuid) from public,anon;
revoke all on function public.customer_raise_dispute(uuid,text) from public,anon;
grant execute on function public.worker_start_job(uuid) to authenticated,service_role;
grant execute on function public.worker_mark_complete(uuid) to authenticated,service_role;
grant execute on function public.customer_confirm_completion(uuid) to authenticated,service_role;
grant execute on function public.customer_raise_dispute(uuid,text) to authenticated,service_role;
revoke all on function public.sync_worker_protected_payment_state()
  from public,anon,authenticated;
revoke all on function public.sync_worker_release_completion()
  from public,anon,authenticated;
grant execute on function public.sync_worker_protected_payment_state() to service_role;
grant execute on function public.sync_worker_release_completion() to service_role;

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
  case when p.proname like 'sync_worker_%' then 'approved_service_only'
    else 'approved_client_rpc' end,
  case when p.proname like 'sync_worker_%'
    then 'Canonical lifecycle compatibility trigger'
    else 'Actor-bound canonical Worker lifecycle action' end,now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'sync_worker_protected_payment_state','worker_start_job','worker_mark_complete',
  'customer_confirm_completion','customer_raise_dispute','sync_worker_release_completion'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

comment on function public.customer_confirm_completion(uuid) is
  'Confirms Worker completion and queues canonical Payment Protection release; never credits a wallet directly.';
