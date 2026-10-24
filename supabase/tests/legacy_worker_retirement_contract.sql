begin;
do $contract$
begin
 if to_regclass('public.workers') is not null or to_regclass('public.blue_badge_subscriptions') is not null then
  raise exception 'Unused predecessor Worker tables must be retired';
 end if;
 if to_regprocedure('public.request_withdrawal(text,numeric)') is not null then
  raise exception 'Unused legacy withdrawal writer must be retired';
 end if;
 if not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
  and p.proname='request_my_wallet_withdrawal' and has_function_privilege('authenticated',p.oid,'execute')) then
  raise exception 'Canonical wallet withdrawal command must remain available';
 end if;
 if to_regclass('public.wallets') is null or to_regclass('public.wallet_transactions') is null
  or to_regclass('public.withdrawals') is null then
  raise exception 'Canonical financial records must be preserved';
 end if;
end $contract$;
rollback;
