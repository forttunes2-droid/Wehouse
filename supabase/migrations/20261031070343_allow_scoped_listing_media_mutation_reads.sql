begin;
set local search_path='';
-- Native Storage deletion/replacement also reads the selected row. Public
-- object URLs do not grant metadata SELECT. Reuse the exact mutation scope;
-- a regional Admin still cannot select another region's file for a write.
do $read$
declare expression text;
begin
 select pg_catalog.pg_get_expr(polqual,polrelid) into expression from pg_catalog.pg_policy
 where polrelid='storage.objects'::regclass and polname='listing_media_delete_owner_or_creator' and polcmd='d';
 if expression is null or strpos(expression,'private.admin_can_mutate_listing_media')=0 then
  raise exception 'Install the reviewed listing-media scope before enabling mutation reads';end if;
 execute pg_catalog.format('create policy listing_media_mutation_read on storage.objects for select to authenticated using (%s)',expression);
end $read$;
commit;
