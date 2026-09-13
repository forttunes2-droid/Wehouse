-- Keep the already-deployed partner withdrawal validation copy consistent.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='request_my_property_partner_withdrawal'
    and pg_get_function_identity_arguments(p.oid)='p_amount numeric, p_bank_account_id uuid';
  if v_definition is not null then
    execute replace(v_definition,'Minimum withdrawal is N%','Minimum withdrawal is ₦%');
  end if;
end
$migration$;
