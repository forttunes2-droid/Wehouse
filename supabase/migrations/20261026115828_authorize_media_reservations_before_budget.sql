begin;
set local search_path='';
-- Correct correlated Hotel ownership checks: the path belongs to the Storage
-- object, not to the Hotel's display name.
do $repair$
declare p record; old_check text; old_using text;
begin
 for p in select * from pg_catalog.pg_policy where polrelid='storage.objects'::regclass
 and polname in('listing_media_insert_authorized','listing_media_update_owner','listing_media_delete_owner_or_creator') loop
  old_check:=pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid);
  old_using:=pg_catalog.pg_get_expr(p.polqual,p.polrelid);
  if old_check is not null then execute pg_catalog.format('alter policy %I on storage.objects with check (%s)',p.polname,
   pg_catalog.replace(old_check,'storage.foldername(hotel.name)','storage.foldername(objects.name)'));end if;
  if old_using is not null then execute pg_catalog.format('alter policy %I on storage.objects using (%s)',p.polname,
   pg_catalog.replace(old_using,'storage.foldername(hotel.name)','storage.foldername(objects.name)'));end if;
 end loop;
end $repair$;

-- Reuse the actual authenticated INSERT authorities, excluding only the budget
-- predicate (which requires the ticket we are about to allocate). Fail closed
-- when those policies change until a migration refreshes this projection.
do $authority$
declare permissive text; restrictive text; signature text; definition text;
begin
 select string_agg('('||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid)||')',' or ' order by polname)
 filter(where polpermissive),
 string_agg('('||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid)||')',' and ' order by polname)
 filter(where not polpermissive),
 md5(string_agg(polname||':'||polpermissive::text||':'||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid),E'\n' order by polname))
 into permissive,restrictive,signature
 from pg_catalog.pg_policy where polrelid='storage.objects'::regclass and polcmd in('a','*')
 and polname<>'wehouse_upload_budget_insert' and (polroles @> array[0::oid] or polroles @> array['authenticated'::regrole::oid]);
 if permissive is null then raise exception 'Storage upload authority is missing';end if;
 definition:=pg_catalog.format($fn$
 create or replace function private.can_reserve_storage_upload(p_bucket text,p_name text)
 returns boolean language plpgsql stable security definer set search_path='' as $body$
 declare current_signature text; permitted boolean;
 begin
 select md5(string_agg(polname||':'||polpermissive::text||':'||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid),E'\n' order by polname))
 into current_signature from pg_catalog.pg_policy
 where polrelid='storage.objects'::regclass and polcmd in('a','*') and polname<>'wehouse_upload_budget_insert'
 and (polroles @> array[0::oid] or polroles @> array['authenticated'::regrole::oid]);
 if current_signature is distinct from %L then raise exception 'Upload permissions need a configuration refresh. Contact support';end if;
 select coalesce(((%s) and (%s)),false) into permitted from
 (select p_bucket as bucket_id,p_name as name,auth.uid()::text as owner_id) objects;
 return permitted;
 end $body$;
 $fn$,signature,permissive,coalesce(restrictive,'true'));
 execute definition;
end $authority$;
revoke all on function private.can_reserve_storage_upload(text,text) from public,anon,authenticated;
do $reserve$
declare definition text; anchor text:=' -- This RPC commits a durable allocation BEFORE Storage';
begin
 definition:=pg_catalog.pg_get_functiondef('public.reserve_my_media_upload(text,text)'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'Reservation authority insertion point changed';end if;
 definition:=replace(definition,anchor,
 E' if not private.can_reserve_storage_upload(p_bucket,p_name) then raise exception ''You cannot upload to this destination'';end if;\n'||anchor);
 execute definition;
end $reserve$;
commit;
