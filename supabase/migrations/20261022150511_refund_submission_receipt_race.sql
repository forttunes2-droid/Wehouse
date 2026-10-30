begin;
CREATE OR REPLACE FUNCTION public.record_refund_provider_submission(p_financial_action_id uuid, p_provider_action_id text, p_provider_status text, p_response_checksum text)
 RETURNS financial_action_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_action public.financial_action_outbox; v_next text;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'service role required'; end if;
  if p_provider_status not in('pending','processing','needs-attention') then
    raise exception 'Unexpected Paystack refund status'; end if;
  if nullif(btrim(p_provider_action_id),'') is null then raise exception 'Provider refund ID required'; end if;
  if p_response_checksum is null or p_response_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Invalid response checksum'; end if;
  v_next:=case when p_provider_status='needs-attention'
    then 'provider_attention' else 'provider_pending' end;
  select * into v_action from public.financial_action_outbox
  where financial_action_id=p_financial_action_id for update;
  if v_action.action_type like 'refund_%' and v_action.status in ('provider_pending','provider_attention','completed')
     and v_action.provider_action_id=p_provider_action_id then
    return v_action;
  end if;
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
$function$;
commit;
