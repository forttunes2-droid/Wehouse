-- Preserve the applied validator history and its OID/grants. Qualify its local
-- group identity so SQL cannot bind it to shared_housing_members.group_id.
do $$declare definition text:=pg_get_functiondef('public.validate_shared_housing_checkout(uuid,text)'::regprocedure);
begin
 if position('g.id=group_id and' in definition)=0 then raise exception 'Unexpected shared validator definition';end if;
 definition:=replace(definition,'group_id uuid;','checkout_group_id uuid;');
 definition:=replace(definition,'group_id:=','checkout_group_id:=');
 definition:=replace(definition,'g.id=group_id and','g.id=checkout_group_id and');
 definition:=replace(definition,'payment.purpose<>''shared_housing_share''','payment.purpose is distinct from ''shared_housing_share''');
 definition:=replace(definition,'payment.status<>''pending''','payment.status is distinct from ''pending''');
 execute definition;
end $$;
