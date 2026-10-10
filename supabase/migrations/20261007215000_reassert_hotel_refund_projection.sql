begin;
CREATE OR REPLACE FUNCTION public.process_verified_paystack_refund_event(p_provider_event_key text, p_event_type text, p_original_reference text, p_refund_reference text, p_provider_refund_id text, p_payload_sha256 text, p_signature_verified_at timestamp with time zone, p_amount_minor bigint, p_currency text)
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
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  if p_event_type not in(
    'refund.pending','refund.processing','refund.needs-attention',
    'refund.failed','refund.processed'
  ) or nullif(btrim(p_provider_event_key),'') is null
    or nullif(btrim(p_original_reference),'') is null
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_amount_minor<=0 or upper(p_currency)<>'NGN' then
    raise exception 'Invalid verified Paystack refund event'; end if;
  -- Match the charge path's payment -> booking lock order before claiming the outbox.
  perform 1 from public.booking_payments where paystack_reference=p_original_reference for update;
  perform 1 from public.hotel_bookings where payment_reference=p_original_reference for update;
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
    and a.status in('processing','provider_pending','provider_attention','manual_review')
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
    and a.status in('processing','provider_pending','provider_attention','manual_review')
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
$function$;
revoke all on function public.process_verified_paystack_refund_event(text,text,text,text,text,text,timestamptz,bigint,text) from public,anon,authenticated;
grant execute on function public.process_verified_paystack_refund_event(text,text,text,text,text,text,timestamptz,bigint,text) to service_role;
commit;