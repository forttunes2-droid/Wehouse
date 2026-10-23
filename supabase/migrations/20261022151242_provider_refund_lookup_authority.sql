begin;
alter table public.verified_provider_events alter column signature_verified_at drop not null;
alter table public.verified_provider_events add column verification_method text not null default 'signed_webhook';
alter table public.verified_provider_events add column api_verified_at timestamptz;
alter table public.verified_provider_events add constraint verified_provider_proof_method check (
(verification_method='signed_webhook' and signature_verified_at is not null and api_verified_at is null)
or (verification_method='provider_api' and api_verified_at is not null and signature_verified_at is null));
create unique index financial_refund_provider_id_unique on public.financial_action_outbox(provider_action_id)
where action_type like 'refund_%' and provider_action_id is not null;
CREATE OR REPLACE FUNCTION private.apply_verified_refund_receipt(p_provider_event_key text, p_event_type text, p_original_reference text, p_refund_reference text, p_provider_refund_id text, p_payload_sha256 text, p_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text, p_verification_method text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  if (select auth.role()) is distinct from 'service_role' then raise exception 'service role required'; end if;
  if p_event_type not in(
    'refund.pending','refund.processing','refund.needs-attention',
    'refund.failed','refund.processed'
  ) or nullif(btrim(p_provider_event_key),'') is null
    or nullif(btrim(p_original_reference),'') is null
    or nullif(btrim(p_provider_refund_id),'') is null
    or p_verified_at is null
    or p_payload_sha256 is null
    or p_amount_minor is null or p_currency is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_amount_minor<=0 or upper(p_currency)<>'NGN' then
    raise exception 'Invalid verified Paystack refund event'; end if;
  if p_verification_method not in ('signed_webhook','provider_api') then raise exception 'Unsupported refund proof'; end if;
  v_amount:=round(p_amount_minor::numeric/100,2);
  insert into public.verified_provider_events(
    provider,provider_event_key,event_type,provider_reference,payload_sha256,
    signature_verified_at,api_verified_at,verification_method,processing_status
  ) values(
    'paystack',p_provider_event_key,p_event_type,
    coalesce(nullif(btrim(p_refund_reference),''),p_provider_event_key),
    lower(p_payload_sha256),case when p_verification_method='signed_webhook' then p_verified_at end,
    case when p_verification_method='provider_api' then p_verified_at end,p_verification_method,'received'
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
    and (p_target_id is null or a.financial_action_id=p_target_id)
    and (a.status in('provider_pending','provider_attention')
      or (a.status in('processing','manual_review') and a.attempt_count>0))
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
    and (p_target_id is null or a.financial_action_id=p_target_id)
    and (a.status in('provider_pending','provider_attention')
      or (a.status in('processing','manual_review') and a.attempt_count>0))
    and p.paystack_reference=p_original_reference and a.amount=v_amount
    and (nullif(btrim(p_provider_refund_id),'') is null
      or a.provider_action_id is null or a.provider_action_id=p_provider_refund_id)
  for update of a;
  if v_action.financial_action_id is null then return jsonb_build_object('success',false,'error','Refund changed during reconciliation; retry the verified event'); end if;
  update public.financial_action_outbox set
    provider_action_id=coalesce(provider_action_id,nullif(btrim(p_provider_refund_id),'')),
    provider_status=replace(p_event_type,'refund.',''),
    provider_submitted_at=coalesce(provider_submitted_at,now()),reconciliation_due_at=now()+interval '1 hour',updated_at=now()
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
  else
    update public.financial_action_outbox set status='provider_pending',last_error=null,updated_at=now()
    where financial_action_id=v_action.financial_action_id;
  end if;
  update public.verified_provider_events set processing_status='processed',
    processed_at=now(),processing_error=null
  where provider_event_id=v_event.provider_event_id;
  return jsonb_build_object('success',true,'financial_action_id',v_action.financial_action_id);
end
$function$;
revoke all on function private.apply_verified_refund_receipt(text,text,text,text,text,text,timestamptz,bigint,text,text,uuid) from public,anon,authenticated,service_role;
create or replace function public.process_verified_paystack_refund_event(
p_provider_event_key text,p_event_type text,p_original_reference text,p_refund_reference text,
p_provider_refund_id text,p_payload_sha256 text,p_signature_verified_at timestamptz,p_amount_minor bigint,p_currency text)
returns jsonb language sql security definer set search_path to 'pg_catalog','public' as $function$
select private.apply_verified_refund_receipt(p_provider_event_key,p_event_type,p_original_reference,p_refund_reference,
p_provider_refund_id,p_payload_sha256,p_signature_verified_at,p_amount_minor,p_currency,'signed_webhook',null);
$function$;
create or replace function public.process_verified_paystack_refund_lookup(
p_financial_action_id uuid,p_provider_refund_id text,p_provider_status text,p_original_reference text,
p_payload_sha256 text,p_verified_at timestamptz,p_amount_minor bigint,p_currency text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
declare result jsonb; current_status text;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'service role required'; end if;
  if p_financial_action_id is null then raise exception 'Refund action required'; end if;
  if exists(select 1 from public.financial_action_outbox where provider_action_id=p_provider_refund_id
    and action_type like 'refund_%' and financial_action_id<>p_financial_action_id) then raise exception 'Provider refund belongs to another action'; end if;
  result:=private.apply_verified_refund_receipt('api-refund:'||p_provider_refund_id||':'||p_payload_sha256,
    'refund.'||p_provider_status,p_original_reference,null,p_provider_refund_id,p_payload_sha256,p_verified_at,
    p_amount_minor,p_currency,'provider_api',p_financial_action_id);
  select status into current_status from public.financial_action_outbox
    where financial_action_id=p_financial_action_id and provider_action_id=p_provider_refund_id;
  if coalesce((result->>'success')::boolean,false) and current_status is not null then
    return result||jsonb_build_object('financial_action_id',p_financial_action_id,'status',current_status);
  end if;
  return jsonb_build_object('success',false,'error','Provider receipt could not be matched to this refund');
end $function$;
revoke all on function public.process_verified_paystack_refund_lookup(uuid,text,text,text,text,timestamptz,bigint,text) from public,anon,authenticated;
grant execute on function public.process_verified_paystack_refund_lookup(uuid,text,text,text,text,timestamptz,bigint,text) to service_role;

create or replace function public.get_my_financial_action_reconciliation(p_financial_action_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
declare actor public.profiles; item public.financial_action_outbox; protection public.payment_protection_transactions;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  actor:=public._current_team_actor();
  if actor.user_id is null then raise exception 'Active finance account required'; end if;
  if actor.role='staff' and not public.current_staff_has_permission('finance_operations') then raise exception 'Finance Operations access required'; end if;
  if actor.role in ('staff','admin') and actor.assigned_state is null then raise exception 'Coverage assignment required'; end if;
  select * into item from public.financial_action_outbox where financial_action_id=p_financial_action_id;
  select * into protection from public.payment_protection_transactions where id=item.payment_protection_id;
  if item.financial_action_id is null or item.action_type not like 'refund_%'
    or item.status not in ('processing','manual_review','provider_pending','provider_attention','completed')
    or not (actor.role='creator' or public.can_current_actor_read_profile(protection.payer_user_id)
      or public.can_current_actor_read_profile(protection.payee_user_id)) then raise exception 'Refund reconciliation unavailable'; end if;
  return jsonb_build_object('financial_action_id',item.financial_action_id,'amount',item.amount,
    'status',item.status,'provider_action_id',item.provider_action_id,'paystack_reference',protection.paystack_reference);
end $function$;
revoke all on function public.get_my_financial_action_reconciliation(uuid) from public,anon;
grant execute on function public.get_my_financial_action_reconciliation(uuid) to authenticated;

commit;
