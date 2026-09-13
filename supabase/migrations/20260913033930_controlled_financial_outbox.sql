-- Controlled release/refund execution. Internal releases settle into an
-- available-payable ledger account. Original-payment refunds are submitted to
-- Paystack once and finalized only by a signed refund.processed event.

alter table public.payment_protection_transactions
  add column if not exists released_amount numeric(12,2) not null default 0,
  add column if not exists refunded_amount numeric(12,2) not null default 0,
  add column if not exists commission_recognized_amount numeric(12,2) not null default 0;

alter table public.payment_protection_transactions
  drop constraint if exists payment_protection_allocated_amount_check;
alter table public.payment_protection_transactions
  add constraint payment_protection_allocated_amount_check check(
    released_amount>=0 and refunded_amount>=0
    and commission_recognized_amount>=0
    and released_amount+refunded_amount<=amount_total
    and commission_recognized_amount<=amount_commission
  );

alter table public.financial_action_outbox
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz,
  add column if not exists provider_action_id text,
  add column if not exists provider_status text,
  add column if not exists provider_response_checksum text,
  add column if not exists provider_submitted_at timestamptz,
  add column if not exists reconciliation_due_at timestamptz;

alter table public.financial_action_outbox
  drop constraint if exists financial_action_outbox_action_type_check;
alter table public.financial_action_outbox
  add constraint financial_action_outbox_action_type_check check(action_type in(
    'refund_caution_undisputed','refund_caution_balance',
    'release_caution_award','refund_unclaimed_caution',
    'release_worker_payment','release_long_let_payment',
    'release_short_let_stay','release_hotel_stay'
  ));
alter table public.financial_action_outbox
  drop constraint if exists financial_action_outbox_status_check;
alter table public.financial_action_outbox
  add constraint financial_action_outbox_status_check check(status in(
    'pending','processing','provider_pending','provider_attention',
    'completed','failed','manual_review'
  ));

create index if not exists financial_action_due_idx
  on public.financial_action_outbox(status,available_at,created_at)
  where status in('pending','failed');
create index if not exists financial_action_provider_idx
  on public.financial_action_outbox(provider_action_id)
  where provider_action_id is not null;

create or replace function public.transition_payment_protection(
  p_payment_protection_id uuid,
  p_to_state text,
  p_event_type text,
  p_event_key text,
  p_actor_user_id text,
  p_actor_type text,
  p_reason text default null,
  p_ledger_transaction_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.payment_protection_transactions
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_row public.payment_protection_transactions;
  v_allowed boolean:=false;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_row from public.payment_protection_transactions
  where id=p_payment_protection_id for update;
  if v_row.id is null then raise exception 'Payment Protection record not found'; end if;
  if exists(select 1 from public.payment_protection_transitions where event_key=p_event_key)
    then return v_row; end if;
  v_allowed:=case v_row.protection_state
    when 'awaiting_funds' then p_to_state in('protected','refunded')
    when 'protected' then p_to_state in(
      'release_eligible','disputed','risk_held','reversal_pending',
      'refunded','partially_released'
    )
    when 'release_eligible' then p_to_state in(
      'release_pending','disputed','risk_held','reversal_pending',
      'released','partially_released','refunded'
    )
    when 'release_pending' then p_to_state in(
      'released','partially_released','risk_held'
    )
    when 'disputed' then p_to_state in(
      'protected','released','partially_released','refunded','risk_held'
    )
    when 'risk_held' then p_to_state in(
      'protected','disputed','refunded','reversal_pending','partially_released'
    )
    when 'reversal_pending' then p_to_state in(
      'reversed','protected','refunded','partially_released'
    )
    when 'partially_released' then p_to_state in(
      'partially_released','released','refunded','disputed','risk_held'
    )
    else false
  end;
  if not v_allowed then
    raise exception 'Illegal Payment Protection transition: % -> %',
      v_row.protection_state,p_to_state;
  end if;
  insert into public.payment_protection_transitions(
    payment_protection_id,from_state,to_state,event_type,event_key,
    actor_user_id,actor_type,reason,ledger_transaction_id,metadata
  ) values(
    v_row.id,v_row.protection_state,p_to_state,p_event_type,p_event_key,
    p_actor_user_id,p_actor_type,p_reason,p_ledger_transaction_id,
    coalesce(p_metadata,'{}'::jsonb)
  );
  update public.payment_protection_transactions set
    protection_state=p_to_state,status=p_to_state,
    release_eligible_at=case when p_to_state='release_eligible'
      then now() else release_eligible_at end,
    risk_held_at=case when p_to_state='risk_held' then now() else risk_held_at end,
    released_at=case when p_to_state='released' then now() else released_at end,
    updated_at=now()
  where id=v_row.id returning * into v_row;
  return v_row;
end
$$;

revoke all on function public.transition_payment_protection(
  uuid,text,text,text,text,text,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.transition_payment_protection(
  uuid,text,text,text,text,text,text,uuid,jsonb
) to service_role;

create or replace function public.mark_caution_protection_disputed()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_protection public.payment_protection_transactions;
begin
  select * into v_protection from public.payment_protection_transactions
  where id=new.payment_protection_id for update;
  if v_protection.protection_state not in('protected','release_eligible','partially_released') then
    raise exception 'Caution Payment Protection is not claimable';
  end if;
  insert into public.payment_protection_transitions(
    payment_protection_id,from_state,to_state,event_type,event_key,
    actor_user_id,actor_type,metadata
  ) values(
    v_protection.id,v_protection.protection_state,'disputed',
    'caution_claim_opened','caution-claim-opened:'||new.caution_claim_id::text,
    new.property_facts_reviewed_by,'property_partner',
    jsonb_build_object('caution_claim_id',new.caution_claim_id)
  ) on conflict(event_key) do nothing;
  update public.payment_protection_transactions
  set protection_state='disputed',status='disputed',
      dispute_case_id=coalesce(dispute_case_id,null),updated_at=now()
  where id=v_protection.id;
  return new;
end
$$;

drop trigger if exists mark_caution_protection_disputed on public.caution_claims;
create trigger mark_caution_protection_disputed
after insert on public.caution_claims
for each row execute function public.mark_caution_protection_disputed();

revoke all on function public.mark_caution_protection_disputed()
from public,anon,authenticated;
grant execute on function public.mark_caution_protection_disputed()
to service_role;

create or replace function public.enqueue_due_canonical_financial_actions(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_row record;
  v_count integer:=0;
  v_caution integer:=0;
  v_silent integer:=0;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  perform public.activate_due_creator_policy_versions();

  for v_row in
    select caution_claim_id from public.caution_claims
    where status='awaiting_guest_response' and guest_response_due_at<=now()
    order by guest_response_due_at for update skip locked
    limit least(greatest(coalesce(p_limit,100),1),500)
  loop
    perform public.advance_silent_caution_claim_from_service(v_row.caution_claim_id);
    v_silent:=v_silent+1;
  end loop;

  for v_row in
    select r.id from public.reservations r
    where r.stay_type='short_let' and r.caution_payment_protection_id is not null
      and r.completed_at is not null and r.completed_at+interval '24 hours'<=now()
      and not exists(select 1 from public.caution_claims c where c.reservation_id=r.id)
      and not exists(select 1 from public.financial_action_outbox a
        where a.idempotency_key='caution-unclaimed-refund:'||r.id)
    order by r.completed_at for update skip locked
    limit least(greatest(coalesce(p_limit,100),1),500)
  loop
    perform public.release_unclaimed_caution_from_service(v_row.id);
    v_caution:=v_caution+1;
  end loop;

  for v_row in
    select 'release_long_let_payment' action_type,'long_let' subject_type,
      r.id subject_id,r.year_one_rent_protection_id protection_id
    from public.reservations r
    join public.payment_protection_transactions p
      on p.id=r.year_one_rent_protection_id
    where r.stay_type<>'short_let' and r.verified_handover_at is not null
      and r.verified_handover_at+interval '24 hours'<=now()
      and p.protection_state in('protected','release_eligible')
      and not exists(select 1 from public.operational_cases c
        where c.subject_type='long_let' and c.subject_id=r.id
          and c.status not in('resolved','closed'))
    union all
    select 'release_short_let_stay','short_let',r.id,r.stay_payment_protection_id
    from public.reservations r
    join public.payment_protection_transactions p on p.id=r.stay_payment_protection_id
    where r.stay_type='short_let' and r.checked_in_at is not null
      and p.protection_state in('protected','release_eligible')
      and not exists(select 1 from public.operational_cases c
        where c.subject_type='short_let' and c.subject_id=r.id
          and c.status not in('resolved','closed'))
    union all
    select 'release_hotel_stay','hotel',h.booking_id::text,h.payment_protection_id
    from public.hotel_bookings h
    join public.payment_protection_transactions p on p.id=h.payment_protection_id
    where h.checked_in_at is not null
      and p.protection_state in('protected','release_eligible')
      and not exists(select 1 from public.operational_cases c
        where c.subject_type='hotel' and c.subject_id=h.booking_id::text
          and c.status not in('resolved','closed'))
    union all
    select 'release_worker_payment','worker_job',w.id::text,w.payment_protection_id
    from public.worker_bookings w
    join public.payment_protection_transactions p on p.id=w.payment_protection_id
    where w.canonical_job_state='completion_marked'
      and w.release_eligible_at<=now()
      and not w.risk_flag and not w.payment_conflict and not w.chargeback_open
      and p.protection_state in('protected','release_eligible')
      and not exists(select 1 from public.worker_user_blocks b
        where (b.blocker_user_id=w.user_id and b.blocked_user_id=w.worker_id)
           or (b.blocker_user_id=w.worker_id and b.blocked_user_id=w.user_id))
      and not exists(select 1 from public.operational_cases c
        where c.subject_type='worker_job' and c.subject_id=w.id::text
          and c.status not in('resolved','closed'))
    limit least(greatest(coalesce(p_limit,100),1),500)
  loop
    if (select protection_state from public.payment_protection_transactions
        where id=v_row.protection_id)='protected' then
      perform public.transition_payment_protection(
        v_row.protection_id,'release_eligible','lifecycle_release_gate_passed',
        'release-eligible:'||v_row.action_type||':'||v_row.subject_id,
        null,'system',null,null,'{}'::jsonb
      );
    end if;
    if v_row.action_type='release_worker_payment' then
      perform public.transition_worker_job(
        v_row.subject_id::uuid,'completed','controlled_release_window_elapsed',
        'worker-completed:'||v_row.subject_id,null,'system','{}'::jsonb
      );
    end if;
    insert into public.financial_action_outbox(
      action_type,subject_type,subject_id,payment_protection_id,amount,idempotency_key
    ) select
      v_row.action_type,v_row.subject_type,v_row.subject_id,p.id,
      p.amount_total-p.released_amount-p.refunded_amount,
      v_row.action_type||':'||v_row.subject_id
    from public.payment_protection_transactions p where p.id=v_row.protection_id
      and p.amount_total-p.released_amount-p.refunded_amount>0
    on conflict(idempotency_key) do nothing;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object(
    'release_actions',v_count,'unclaimed_caution_refunds',v_caution,
    'silent_claims_advanced',v_silent
  );
end
$$;

revoke all on function public.enqueue_due_canonical_financial_actions(integer)
from public,anon,authenticated;
grant execute on function public.enqueue_due_canonical_financial_actions(integer)
to service_role;

create or replace function public.claim_financial_actions(
  p_worker_id text,p_limit integer default 20
)
returns table(
  financial_action_id uuid,action_type text,subject_type text,subject_id text,
  payment_protection_id uuid,amount numeric,idempotency_key text,
  paystack_reference text,payee_user_id text
)
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  if nullif(btrim(p_worker_id),'') is null then raise exception 'worker id required'; end if;
  return query
  with due as(
    select a.financial_action_id
    from public.financial_action_outbox a
    where a.status='pending' and a.available_at<=now()
      and not(
        a.action_type like 'refund_%' and exists(
          select 1 from public.financial_action_outbox active
          where active.payment_protection_id=a.payment_protection_id
            and active.financial_action_id<>a.financial_action_id
            and active.action_type like 'refund_%'
            and active.status in('processing','provider_pending','provider_attention')
        )
      )
    order by a.available_at,a.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit,20),1),50)
  ),claimed as(
    update public.financial_action_outbox a set
      status='processing',claimed_by=btrim(p_worker_id),claimed_at=now(),
      attempt_count=attempt_count+1,updated_at=now()
    from due where a.financial_action_id=due.financial_action_id
    returning a.*
  )
  select c.financial_action_id,c.action_type,c.subject_type,c.subject_id,
    c.payment_protection_id,c.amount,c.idempotency_key,
    p.paystack_reference,p.payee_user_id
  from claimed c join public.payment_protection_transactions p
    on p.id=c.payment_protection_id;
end
$$;

revoke all on function public.claim_financial_actions(text,integer)
from public,anon,authenticated;
grant execute on function public.claim_financial_actions(text,integer)
to service_role;

create or replace function public.complete_internal_release_action(
  p_financial_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_action public.financial_action_outbox;
  v_protection public.payment_protection_transactions;
  v_commission numeric(12,2);
  v_payee_amount numeric(12,2);
  v_ledger uuid;
  v_entries jsonb;
  v_new_released numeric(12,2);
  v_new_refunded numeric(12,2);
  v_to_state text;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_action from public.financial_action_outbox
  where financial_action_id=p_financial_action_id for update;
  if v_action.status='completed' then
    return jsonb_build_object('success',true,'already_completed',true); end if;
  if v_action.status<>'processing' or v_action.action_type not like 'release_%' then
    raise exception 'Release action is not processing'; end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_action.payment_protection_id for update;
  if v_protection.protection_state not in(
    'release_eligible','disputed','partially_released'
  ) then raise exception 'Payment Protection is not releasable'; end if;
  if v_action.amount<=0 or v_action.amount>
      v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount then
    raise exception 'Release exceeds the protected balance'; end if;
  v_commission:=least(
    v_protection.amount_commission-v_protection.commission_recognized_amount,
    round(v_action.amount*v_protection.commission_rate/100,2)
  );
  if v_action.amount=
      v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount then
    v_commission:=least(v_action.amount,
      v_protection.amount_commission-v_protection.commission_recognized_amount);
  end if;
  v_payee_amount:=v_action.amount-v_commission;
  v_entries:=jsonb_build_array(
    jsonb_build_object(
      'account_key','liability:payment_protection:'||v_protection.id::text,
      'account_class','liability','owner_type',v_protection.subject_type,
      'owner_id',v_protection.subject_id,'amount',v_action.amount,
      'memo','Payment Protection release'
    ),
    jsonb_build_object(
      'account_key','liability:payee_available:'||v_protection.payee_user_id,
      'account_class','liability','owner_type','profile',
      'owner_id',v_protection.payee_user_id,'amount',-v_payee_amount,
      'memo','Available for withdrawal'
    )
  );
  if v_commission>0 then
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
      'account_key','revenue:wehouse_commission:'||v_protection.subject_type,
      'account_class','revenue','owner_type','wehouse','owner_id','platform',
      'amount',-v_commission,'memo','Creator-policy commission recognized'
    ));
  end if;
  v_ledger:=public.post_ledger_transaction(
    'financial-action:'||v_action.idempotency_key,'protected_release','NGN',
    v_action.subject_type,v_action.subject_id,null,
    jsonb_build_object(
      'financial_action_id',v_action.financial_action_id,
      'payment_protection_id',v_protection.id,
      'commission',v_commission,'payee_amount',v_payee_amount
    ),v_entries
  );
  update public.payment_protection_transactions set
    released_amount=released_amount+v_action.amount,
    commission_recognized_amount=commission_recognized_amount+v_commission,
    release_ledger_transaction_id=v_ledger,updated_at=now()
  where id=v_protection.id
  returning released_amount,refunded_amount into v_new_released,v_new_refunded;
  v_to_state:=case
    when v_new_released=v_protection.amount_total then 'released'
    else 'partially_released' end;
  perform public.transition_payment_protection(
    v_protection.id,v_to_state,'financial_release_completed',
    'financial-release-completed:'||v_action.financial_action_id,
    null,'finance_processor',null,v_ledger,
    jsonb_build_object('financial_action_id',v_action.financial_action_id)
  );
  update public.financial_action_outbox set
    status='completed',processed_at=now(),last_error=null,updated_at=now()
  where financial_action_id=v_action.financial_action_id;
  return jsonb_build_object(
    'success',true,'ledger_transaction_id',v_ledger,
    'payee_amount',v_payee_amount,'commission',v_commission
  );
end
$$;

revoke all on function public.complete_internal_release_action(uuid)
from public,anon,authenticated;
grant execute on function public.complete_internal_release_action(uuid)
to service_role;

create or replace function public.record_refund_provider_submission(
  p_financial_action_id uuid,p_provider_action_id text,p_provider_status text,
  p_response_checksum text
)
returns public.financial_action_outbox
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_action public.financial_action_outbox; v_next text;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  if p_provider_status not in('pending','processing','needs-attention') then
    raise exception 'Unexpected Paystack refund status'; end if;
  if p_response_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Invalid response checksum'; end if;
  v_next:=case when p_provider_status='needs-attention'
    then 'provider_attention' else 'provider_pending' end;
  update public.financial_action_outbox set
    provider_action_id=nullif(btrim(p_provider_action_id),''),
    provider_status=p_provider_status,
    provider_response_checksum=lower(p_response_checksum),
    provider_submitted_at=now(),reconciliation_due_at=now()+interval '1 hour',
    status=v_next,updated_at=now()
  where financial_action_id=p_financial_action_id
    and status='processing' and action_type like 'refund_%'
  returning * into v_action;
  if v_action.financial_action_id is null then raise exception 'Refund action is not processing'; end if;
  return v_action;
end
$$;

create or replace function public.mark_financial_action_manual_review(
  p_financial_action_id uuid,p_reason text
)
returns public.financial_action_outbox
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_action public.financial_action_outbox;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  update public.financial_action_outbox set status='manual_review',
    last_error=left(coalesce(nullif(btrim(p_reason),''),'Provider outcome uncertain'),500),
    updated_at=now()
  where financial_action_id=p_financial_action_id and status='processing'
  returning * into v_action;
  if v_action.financial_action_id is null then raise exception 'Action is not processing'; end if;
  return v_action;
end
$$;

revoke all on function public.record_refund_provider_submission(uuid,text,text,text)
from public,anon,authenticated;
revoke all on function public.mark_financial_action_manual_review(uuid,text)
from public,anon,authenticated;
grant execute on function public.record_refund_provider_submission(uuid,text,text,text)
to service_role;
grant execute on function public.mark_financial_action_manual_review(uuid,text)
to service_role;

create or replace function public.process_verified_paystack_refund_event(
  p_provider_event_key text,p_event_type text,p_original_reference text,
  p_refund_reference text,p_provider_refund_id text,p_payload_sha256 text,
  p_signature_verified_at timestamptz,p_amount_minor bigint,p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_event public.verified_provider_events;
  v_action public.financial_action_outbox;
  v_protection public.payment_protection_transactions;
  v_amount numeric(12,2);
  v_match_count integer;
  v_ledger uuid;
  v_new_released numeric(12,2);
  v_new_refunded numeric(12,2);
  v_to_state text;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  if p_event_type not in(
    'refund.pending','refund.processing','refund.needs-attention',
    'refund.failed','refund.processed'
  ) or nullif(btrim(p_provider_event_key),'') is null
    or nullif(btrim(p_original_reference),'') is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_amount_minor<=0 or upper(p_currency)<>'NGN' then
    raise exception 'Invalid verified Paystack refund event'; end if;
  v_amount:=round(p_amount_minor::numeric/100,2);
  insert into public.verified_provider_events(
    provider,provider_event_key,event_type,provider_reference,payload_sha256,
    signature_verified_at,processing_status
  ) values(
    'paystack',p_provider_event_key,p_event_type,
    coalesce(nullif(btrim(p_refund_reference),''),p_provider_event_key),
    lower(p_payload_sha256),p_signature_verified_at,'received'
  ) on conflict do nothing;
  select * into v_event from public.verified_provider_events
  where provider='paystack' and provider_event_key=p_provider_event_key for update;
  if v_event.provider_event_id is null then raise exception 'Refund event was not registered'; end if;
  if v_event.payload_sha256<>lower(p_payload_sha256) then
    raise exception 'Refund event replay checksum mismatch'; end if;
  if v_event.processing_status='processed' then
    return jsonb_build_object('success',true,'already_processed',true); end if;

  select count(*) into v_match_count
  from public.financial_action_outbox a
  join public.payment_protection_transactions p on p.id=a.payment_protection_id
  where a.action_type like 'refund_%'
    and a.status in('provider_pending','provider_attention')
    and p.paystack_reference=p_original_reference
    and a.amount=v_amount
    and (nullif(btrim(p_provider_refund_id),'') is null
      or a.provider_action_id is null
      or a.provider_action_id=p_provider_refund_id);
  if v_match_count=0 then
    update public.verified_provider_events set processing_status='ignored',
      processed_at=now(),processing_error='No matching pending refund action'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',true,'ignored',true);
  end if;
  if v_match_count<>1 then
    update public.verified_provider_events set processing_status='failed',
      processed_at=now(),processing_error='Refund event matched multiple actions'
    where provider_event_id=v_event.provider_event_id;
    return jsonb_build_object('success',false,'error','Refund matching requires Finance review');
  end if;
  select a.* into v_action
  from public.financial_action_outbox a
  join public.payment_protection_transactions p on p.id=a.payment_protection_id
  where a.action_type like 'refund_%'
    and a.status in('provider_pending','provider_attention')
    and p.paystack_reference=p_original_reference and a.amount=v_amount
    and (nullif(btrim(p_provider_refund_id),'') is null
      or a.provider_action_id is null or a.provider_action_id=p_provider_refund_id)
  for update of a;
  update public.financial_action_outbox set
    provider_action_id=coalesce(provider_action_id,nullif(btrim(p_provider_refund_id),'')),
    provider_status=replace(p_event_type,'refund.',''),updated_at=now()
  where financial_action_id=v_action.financial_action_id;

  if p_event_type='refund.needs-attention' then
    update public.financial_action_outbox set status='provider_attention'
    where financial_action_id=v_action.financial_action_id;
  elsif p_event_type='refund.failed' then
    update public.financial_action_outbox set status='manual_review',
      last_error='Paystack reported that the refund failed',updated_at=now()
    where financial_action_id=v_action.financial_action_id;
  elsif p_event_type='refund.processed' then
    select * into v_protection from public.payment_protection_transactions
    where id=v_action.payment_protection_id for update;
    if v_action.amount>
        v_protection.amount_total-v_protection.released_amount-v_protection.refunded_amount then
      raise exception 'Refund exceeds the protected balance'; end if;
    v_ledger:=public.post_ledger_transaction(
      'paystack-refund:'||p_provider_event_key,'provider_refund','NGN',
      v_action.subject_type,v_action.subject_id,v_event.provider_event_id,
      jsonb_build_object(
        'financial_action_id',v_action.financial_action_id,
        'original_reference',p_original_reference,
        'refund_reference',p_refund_reference
      ),jsonb_build_array(
        jsonb_build_object(
          'account_key','liability:payment_protection:'||v_protection.id::text,
          'account_class','liability','owner_type',v_protection.subject_type,
          'owner_id',v_protection.subject_id,'amount',v_action.amount,
          'memo','Original-payment refund'
        ),
        jsonb_build_object(
          'account_key','asset:paystack_clearing:NGN','account_class','asset',
          'amount',-v_action.amount,'memo','Paystack processed refund'
        )
      )
    );
    update public.payment_protection_transactions set
      refunded_amount=refunded_amount+v_action.amount,
      refund_ledger_transaction_id=v_ledger,updated_at=now()
    where id=v_protection.id
    returning released_amount,refunded_amount into v_new_released,v_new_refunded;
    v_to_state:=case
      when v_new_refunded=v_protection.amount_total then 'refunded'
      else 'partially_released' end;
    perform public.transition_payment_protection(
      v_protection.id,v_to_state,'provider_refund_processed',
      'provider-refund-processed:'||p_provider_event_key,
      null,'paystack',null,v_ledger,
      jsonb_build_object('financial_action_id',v_action.financial_action_id)
    );
    update public.financial_action_outbox set status='completed',processed_at=now(),
      last_error=null,updated_at=now()
    where financial_action_id=v_action.financial_action_id;
  end if;
  update public.verified_provider_events set processing_status='processed',
    processed_at=now(),processing_error=null
  where provider_event_id=v_event.provider_event_id;
  return jsonb_build_object('success',true,'financial_action_id',v_action.financial_action_id);
end
$$;

revoke all on function public.process_verified_paystack_refund_event(
  text,text,text,text,text,text,timestamptz,bigint,text
) from public,anon,authenticated;
grant execute on function public.process_verified_paystack_refund_event(
  text,text,text,text,text,text,timestamptz,bigint,text
) to service_role;

create or replace function public.get_my_available_ledger_balance()
returns table(currency text,available_balance numeric)
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  with actor as(select public.current_profile_user_id() user_id)
  select a.currency,round(-coalesce(sum(e.amount),0),2) available_balance
  from public.ledger_accounts a
  join public.ledger_entries e on e.ledger_account_id=a.ledger_account_id
  cross join actor
  where a.account_key='liability:payee_available:'||actor.user_id
  group by a.currency
$$;

revoke all on function public.get_my_available_ledger_balance()
from public,anon;
grant execute on function public.get_my_available_ledger_balance()
to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  case when p.proname='get_my_available_ledger_balance'
    then 'approved_client_rpc' else 'approved_service_only' end,
  case when p.proname='get_my_available_ledger_balance'
    then 'Authenticated caller sees only the ledger account for its profile'
    else 'Controlled lifecycle and financial processor function' end,now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'transition_payment_protection','mark_caution_protection_disputed',
  'enqueue_due_canonical_financial_actions','claim_financial_actions',
  'complete_internal_release_action','record_refund_provider_submission',
  'mark_financial_action_manual_review','process_verified_paystack_refund_event',
  'get_my_available_ledger_balance'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,
  captured_at=excluded.captured_at;

comment on table public.financial_action_outbox is
'Controlled money commands. Refund submission is never blindly retried after an uncertain provider response.';
