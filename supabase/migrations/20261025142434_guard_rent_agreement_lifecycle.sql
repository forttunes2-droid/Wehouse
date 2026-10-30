begin;
do $patch$
declare definition text;needle text:='  if not v_access_active then return new; end if;';
begin
 definition:=pg_get_functiondef('public.enforce_protected_accommodation_handover()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Inspect accommodation access detection before upgrading';end if;
 execute replace(definition,needle,'  if not coalesce(v_access_active,false) then return new; end if;');
end $patch$;
-- The unused legacy endpoint claimed a refund/paid-out amount without a verified
-- provider refund. Tenancy exit and refunds use booking Help/Finance review.
revoke all on function public.cancel_rent_plan(uuid,text,text) from public,anon,authenticated,service_role;
commit;
