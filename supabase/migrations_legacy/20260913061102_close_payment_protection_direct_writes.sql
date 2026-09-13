-- Payment Protection is written only by reviewed command/service functions.
-- Keep the existing participant read policy for the compatibility projection,
-- but remove every direct browser mutation capability inherited from the old
-- escrow-era table generation.

revoke insert,update,delete,truncate,references,trigger
on table public.payment_protection_transactions
from public,anon,authenticated;
grant all on table public.payment_protection_transactions to service_role;

drop policy if exists payment_protection_no_client_insert
on public.payment_protection_transactions;
create policy payment_protection_no_client_insert
on public.payment_protection_transactions
as restrictive for insert to anon,authenticated
with check(false);

drop policy if exists payment_protection_no_client_update
on public.payment_protection_transactions;
create policy payment_protection_no_client_update
on public.payment_protection_transactions
as restrictive for update to anon,authenticated
using(false) with check(false);

drop policy if exists payment_protection_no_client_delete
on public.payment_protection_transactions;
create policy payment_protection_no_client_delete
on public.payment_protection_transactions
as restrictive for delete to anon,authenticated
using(false);

do $$
begin
  if has_table_privilege('anon','public.payment_protection_transactions','INSERT')
    or has_table_privilege('anon','public.payment_protection_transactions','UPDATE')
    or has_table_privilege('anon','public.payment_protection_transactions','DELETE')
    or has_table_privilege('authenticated','public.payment_protection_transactions','INSERT')
    or has_table_privilege('authenticated','public.payment_protection_transactions','UPDATE')
    or has_table_privilege('authenticated','public.payment_protection_transactions','DELETE')
  then
    raise exception 'Payment Protection still has a direct client write grant';
  end if;
end
$$;

comment on table public.payment_protection_transactions is
  'Compatibility Payment Protection projection. Participant reads may be policy-scoped; all writes flow through canonical reviewed commands.';
