-- The reconciliation migration added two optional trailing parameters with
-- defaults to the canonical Partner Pro confirmation RPC, while the original
-- five-argument overload remained. Calls with five arguments became ambiguous.
-- Keep the seven-argument function as the single canonical RPC; its defaults
-- preserve the existing five-argument client/test contract.
do $$
begin
  if to_regprocedure('public.confirm_partner_pro_paystack_charge(text,text,bigint,text,text,text,text)') is null then
    raise exception 'Canonical Partner Pro confirmation RPC is missing';
  end if;
end $$;

drop function if exists public.confirm_partner_pro_paystack_charge(text,text,bigint,text,text);

revoke all on function public.confirm_partner_pro_paystack_charge(text,text,bigint,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.confirm_partner_pro_paystack_charge(text,text,bigint,text,text,text,text)
  to service_role;

notify pgrst, 'reload schema';
