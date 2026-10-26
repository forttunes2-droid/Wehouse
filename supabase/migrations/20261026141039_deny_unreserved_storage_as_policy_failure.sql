begin;
do $patch$
declare definition text;anchor text:=$a$ if ticket.id is null then raise exception 'Start this upload again to confirm available space';end if;$a$;
begin
 definition:=pg_get_functiondef('private.storage_upload_within_budget(text,uuid,text,jsonb)'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'Inspect Storage reservation denial before upgrading';end if;
 execute replace(definition,anchor,' if ticket.id is null then return false;end if;');
end $patch$;
commit;
