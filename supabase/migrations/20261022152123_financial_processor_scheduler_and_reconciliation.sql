begin;
create or replace function public.claim_due_refund_reconciliations(p_limit integer default 2)
returns table(financial_action_id uuid,amount numeric,status text,provider_action_id text,paystack_reference text)
language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'service role required'; end if;
 return query with due as (
  select a.financial_action_id from public.financial_action_outbox a
  where a.action_type like 'refund_%' and a.provider_action_id is not null
   and a.status in ('provider_pending','provider_attention','manual_review')
   and (a.reconciliation_due_at is null or a.reconciliation_due_at<=now())
  order by a.reconciliation_due_at nulls first,a.created_at,a.financial_action_id
  for update skip locked limit least(greatest(coalesce(p_limit,2),1),2)
 ), claimed as (
  update public.financial_action_outbox a set reconciliation_due_at=now()+interval '5 minutes',
   metadata=coalesce(a.metadata,'{}'::jsonb)||jsonb_build_object('reconciliation_claimed_at',now()),updated_at=now()
  from due where a.financial_action_id=due.financial_action_id returning a.*
 ) select a.financial_action_id,a.amount,a.status,a.provider_action_id,p.paystack_reference
 from claimed a join public.payment_protection_transactions p on p.id=a.payment_protection_id;
end $function$;
revoke all on function public.claim_due_refund_reconciliations(integer) from public,anon,authenticated;
grant execute on function public.claim_due_refund_reconciliations(integer) to service_role;

create or replace function public.record_refund_reconciliation_failure(p_financial_action_id uuid)
returns boolean language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'service role required'; end if;
 update public.financial_action_outbox set
  last_error='Provider refund lookup could not be confirmed; no new refund was submitted',
  reconciliation_due_at=now()+interval '15 minutes',updated_at=now()
 where financial_action_id=p_financial_action_id and status in ('provider_pending','provider_attention','manual_review');
 return found;
end $function$;
revoke all on function public.record_refund_reconciliation_failure(uuid) from public,anon,authenticated;
grant execute on function public.record_refund_reconciliation_failure(uuid) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create or replace function private.run_financial_processor() returns bigint
language plpgsql security definer set search_path='' as $function$
declare endpoint text; secret text; request_id bigint;
begin
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='financial_processor_project_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='financial_processor_worker_secret';
 if endpoint is null or endpoint !~ '^https://[a-z]{20}\.supabase\.co$' or length(coalesce(secret,''))<32 then return null; end if;
 select net.http_post(url=>endpoint||'/functions/v1/financial-action-processor',
  headers=>jsonb_build_object('Content-Type','application/json','x-wehouse-cron-secret',secret),
  body=>'{}'::jsonb,timeout_milliseconds=>120000) into request_id;
 return request_id;
end $function$;
revoke all on function private.run_financial_processor() from public,anon,authenticated,service_role;
select cron.schedule('wehouse-financial-processor','* * * * *','select private.run_financial_processor()');
commit;
