-- Possession of a guest code is not enough after the Hotel device is revoked.
-- Keep the canonical Hotel capability and code-attempt checks underneath this.
do $patch$
declare definition text;needle text:=E'begin\n';
begin
 definition:=replace(pg_get_functiondef('public.partner_confirm_hotel_stay_with_code(integer,text,text)'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,needle)=0 then raise exception 'Inspect Hotel presence confirmation entry';end if;
 execute replace(definition,needle,needle||$guard$  if not public._property_document_session_active() then
    raise exception 'Active trusted Hotel session required' using errcode='42501';
  end if;
$guard$);
end $patch$;
