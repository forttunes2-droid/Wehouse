-- The active payout flow uses withdrawals and protected provider commands.
-- This unused service-executable function directly debited wallets while
-- writing withdrawal_requests, bypassing that flow. Preserve every table/row.
do $retire$
declare target regprocedure:=to_regprocedure('public.request_withdrawal(text,numeric)');definition text;
begin
 if target is null then return;end if;
 definition:=pg_get_functiondef(target);
 if definition !~* 'insert into withdrawal_requests' or definition !~* 'update wallets' then
  raise exception 'Withdrawal implementation changed; review before retirement';
 end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f' and p.oid<>target::oid
   and pg_get_functiondef(p.oid) ~ '\mrequest_withdrawal\M') then
  raise exception 'A database function still calls request_withdrawal';
 end if;
 -- RESTRICT deliberately refuses a new catalog dependency; never CASCADE.
 drop function public.request_withdrawal(text,numeric) restrict;
end $retire$;
