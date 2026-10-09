-- The production-schema reconciliation introduced p_auto_renew with a
-- default but left the earlier one-argument overload in place. PostgREST then
-- cannot disambiguate checkout RPC calls that provide only p_billing_period.
-- Keep the two-argument function as the single canonical RPC; its default
-- preserves the existing client contract (auto-renew remains false by default).
do $$
begin
  if to_regprocedure('public.create_my_partner_pro_payment(text,boolean)') is null then
    raise exception 'Canonical Partner Pro checkout RPC is missing';
  end if;
end $$;

drop function if exists public.create_my_partner_pro_payment(text);

revoke all on function public.create_my_partner_pro_payment(text,boolean) from public, anon;
grant execute on function public.create_my_partner_pro_payment(text,boolean) to authenticated, service_role;

comment on function public.create_my_partner_pro_payment(text,boolean) is
  'Canonical prepaid Partner Pro checkout RPC; p_auto_renew defaults to false.';

notify pgrst, 'reload schema';
