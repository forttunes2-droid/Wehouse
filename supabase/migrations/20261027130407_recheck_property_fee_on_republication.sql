-- A renewed document approval does not grant consent to a changed fee.
-- Reuse the existing guard and immutable accepted-fee record.
do $repair$
declare definition text;needle text;
begin
 definition:=replace(pg_get_functiondef('private.require_property_fee_acceptance()'::regprocedure),chr(13),'');
 needle:='if new.approved_at is null or (tg_op=''UPDATE'' and old.approved_at is not null) then return new;end if;';
 if strpos(definition,needle)=0 then raise exception 'Inspect property publication fee guard before updating it';end if;
 execute replace(definition,needle,'if new.approved_at is null then return new;end if;');
end $repair$;
