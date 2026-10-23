-- Resolution filters use Activity domains, not workspace names.
do $upgrade$
declare target regprocedure;definition text;needle text;
begin
 foreach target in array array[
  'private.worker_credential_required_activity(text)'::regprocedure,
  'private.worker_credential_document_activity()'::regprocedure
 ] loop
  definition:=pg_get_functiondef(target);
  needle:='''worker.credentials.required'',''worker''';
  if position(needle in definition)=0 then raise exception 'Worker activity definition changed: %',target;end if;
  execute replace(definition,needle,'''worker.credentials.required'',''services''');
 end loop;
 definition:=pg_get_functiondef('private.invalidate_property_document_publication()'::regprocedure);
 needle:='''property.document.expired'',''property_partner''';
 if position(needle in definition)=0 then raise exception 'Property activity definition changed';end if;
 execute replace(definition,needle,'''property.document.expired'',''housing''');
end $upgrade$;
