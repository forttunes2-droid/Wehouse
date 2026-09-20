begin;
-- Only trusted Paystack handlers may record provider mode, after a charge has
-- been verified. Never infer historical Test/Live from today's account setting.
create or replace function public.record_verified_payment_mode(p_reference text,p_transaction_id text,p_domain text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if p_domain is null or p_domain not in ('test','live') then return; end if;
  update public.booking_payments
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('paystack_domain',p_domain)
  where paystack_reference=p_reference and paystack_transaction_id=p_transaction_id
    and verified_at is not null and verified_amount is not null
    and (metadata->>'paystack_domain' is null or metadata->>'paystack_domain'=p_domain);
end;
$$;
revoke all on function public.record_verified_payment_mode(text,text,text) from public,anon,authenticated;
grant execute on function public.record_verified_payment_mode(text,text,text) to service_role;
commit;
