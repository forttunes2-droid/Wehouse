-- Serialize all financial effects for one protected payment, including within a batch.
create or replace function public.claim_financial_actions(p_worker_id text,p_limit integer default 20)
returns table(financial_action_id uuid,action_type text,subject_type text,subject_id text,
payment_protection_id uuid,amount numeric,idempotency_key text,paystack_reference text,payee_user_id text)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
 if nullif(btrim(p_worker_id),'') is null then raise exception 'worker id required'; end if;
 return query
 with due as(
  select a.financial_action_id
  from public.financial_action_outbox a
  join public.payment_protection_transactions p on p.id=a.payment_protection_id
  where a.status='pending' and a.available_at<=now()
  and not exists(
   select 1 from public.financial_action_outbox active
   where active.payment_protection_id=a.payment_protection_id
   and active.status in('processing','provider_pending','provider_attention','manual_review'))
  and not exists(
   select 1 from public.financial_action_outbox earlier
   where earlier.payment_protection_id=a.payment_protection_id
   and earlier.status='pending' and earlier.available_at<=now()
   and (earlier.available_at,earlier.created_at,earlier.financial_action_id)
      <(a.available_at,a.created_at,a.financial_action_id))
  order by a.available_at,a.created_at,a.financial_action_id
  for update of a,p skip locked
  limit least(greatest(coalesce(p_limit,20),1),50)
 ),claimed as(
  update public.financial_action_outbox a set status='processing',claimed_by=btrim(p_worker_id),
  claimed_at=now(),attempt_count=attempt_count+1,updated_at=now()
  from due where a.financial_action_id=due.financial_action_id and a.status='pending'
  returning a.*
 )
 select c.financial_action_id,c.action_type,c.subject_type,c.subject_id,c.payment_protection_id,
 c.amount,c.idempotency_key,p.paystack_reference,p.payee_user_id
 from claimed c join public.payment_protection_transactions p on p.id=c.payment_protection_id;
end; $$;
revoke all on function public.claim_financial_actions(text,integer) from public,anon,authenticated;
grant execute on function public.claim_financial_actions(text,integer) to service_role;
