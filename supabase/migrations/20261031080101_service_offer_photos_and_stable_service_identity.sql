begin;
set local search_path='';
-- Own service cover/gallery, independent of Showcase and activity photos.
alter table public.worker_services add column photos jsonb not null default '[]';
alter table public.worker_services add column photo_revision uuid not null default gen_random_uuid();
alter table public.worker_services add constraint worker_service_photo_shape
 check(jsonb_typeof(photos)='array' and jsonb_array_length(photos)<=3);
create unique index worker_services_stable_name on public.worker_services(worker_id,lower(btrim(service_name)));
create index worker_services_photo_reference on public.worker_services using gin(photos jsonb_path_ops) where photos<>'[]'::jsonb;
-- All mutations already use the canonical commands; a direct row write must
-- not bypass gallery ownership, metadata or concurrent-update validation.
revoke insert,update,delete on public.worker_services from anon,authenticated;
do $stable$
declare definition text;needle text;
begin
 definition:=pg_catalog.pg_get_functiondef('public.set_my_worker_services(jsonb)'::regprocedure);
 needle:='  if v_actor.user_id is null then raise exception ''Active Worker account required''; end if;';
 if strpos(definition,needle)=0 then raise exception 'Inspect Service actor authority';end if;
 definition:=replace(definition,needle,needle||E'\n  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''service-offers:''||v_actor.user_id,0));');
 needle:='  delete from public.worker_services where worker_id=v_actor.user_id;';
 if strpos(definition,needle)=0 then raise exception 'Inspect Service replacement behavior';end if;
 definition:=replace(definition,needle,$remove$  delete from public.worker_services service where service.worker_id=v_actor.user_id
    and not exists(select 1 from unnest(v_names) name where lower(btrim(name))=lower(btrim(service.service_name)));$remove$);
 needle:='values(v_actor.user_id,v_name,v_price,v_price_type,v_description,now(),now());';
 if strpos(definition,needle)=0 then raise exception 'Inspect Service upsert behavior';end if;
 definition:=replace(definition,needle,$upsert$values(v_actor.user_id,v_name,v_price,v_price_type,v_description,now(),now())
    on conflict(worker_id,lower(btrim(service_name))) do update set
      price=excluded.price,price_type=excluded.price_type,description=excluded.description,updated_at=now();$upsert$);
 execute definition;
end $stable$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('service-offer-photos','service-offer-photos',false,1000000,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function private.service_photo_is_referenced(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.worker_services service where service.photos<>'[]'::jsonb
  and (service.photos @> jsonb_build_array(jsonb_build_object('image',p_name))
    or service.photos @> jsonb_build_array(jsonb_build_object('preview',p_name))));
$$;
revoke all on function private.service_photo_is_referenced(text) from public,anon,authenticated,service_role;
create function private.can_access_service_offer_photo(p_name text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();parts text[]:=string_to_array(p_name,'/');offer public.worker_services;service_id uuid;
begin
 if actor is null or not public._property_document_session_active() or array_length(parts,1)<>4
  or parts[3] !~ '^[0-9a-f-]{36}$' or parts[4] not in('full.jpg','preview.jpg') then return false;end if;
 begin service_id:=parts[2]::uuid;perform parts[3]::uuid;exception when invalid_text_representation then return false;end;
 select * into offer from public.worker_services where id=service_id and worker_id=parts[1];
 if offer.id is null then return not p_write and parts[1]=actor and public.current_actor_has_workspace('worker',null);end if;
 if offer.worker_id=actor and public.current_actor_has_workspace('worker',null) then return true;end if;
 if p_write then return false;end if;
 if public.can_access_worker_credentials(offer.worker_id,true) then return true;end if;
 return exists(select 1 from private.service_provider_rows(p_ids=>array[offer.worker_id],p_take=>1)) and (
  offer.photos @> jsonb_build_array(jsonb_build_object('image',p_name)) or offer.photos @> jsonb_build_array(jsonb_build_object('preview',p_name)));
end $$;
revoke all on function private.can_access_service_offer_photo(text,boolean) from public,anon,authenticated,service_role;
grant execute on function private.can_access_service_offer_photo(text,boolean) to authenticated;
create function private.can_cleanup_service_offer_photo(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select public._property_document_session_active() and split_part(p_name,'/',1)=public.current_profile_user_id()
  and public.current_actor_has_workspace('worker',null) and not private.service_photo_is_referenced(p_name);
$$;
revoke all on function private.can_cleanup_service_offer_photo(text) from public,anon,authenticated,service_role;
grant execute on function private.can_cleanup_service_offer_photo(text) to authenticated;
create policy service_offer_photo_insert on storage.objects for insert to authenticated
 with check(bucket_id='service-offer-photos' and private.can_access_service_offer_photo(name,true));
create policy service_offer_photo_read on storage.objects for select to authenticated
 using(bucket_id='service-offer-photos' and private.can_access_service_offer_photo(name,false));
create policy service_offer_photo_cleanup on storage.objects for delete to authenticated
 using(bucket_id='service-offer-photos' and owner_id=auth.uid()::text and private.can_cleanup_service_offer_photo(name));
create policy service_offer_photo_update_boundary on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'service-offer-photos') with check(bucket_id<>'service-offer-photos');
create policy service_offer_photo_insert_boundary on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'service-offer-photos' or private.can_access_service_offer_photo(name,true));
create policy service_offer_photo_read_boundary on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'service-offer-photos' or private.can_access_service_offer_photo(name,false));
create policy service_offer_photo_delete_boundary on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'service-offer-photos' or (owner_id=auth.uid()::text and private.can_cleanup_service_offer_photo(name)));
create function private.protect_service_offer_photo() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.bucket_id='service-offer-photos' and private.service_photo_is_referenced(old.name) then
  raise exception 'Remove this photo from the service gallery before deleting or replacing it' using errcode='42501';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.protect_service_offer_photo() from public,anon,authenticated,service_role;
create trigger protect_service_offer_photo_delete before delete on storage.objects for each row execute function private.protect_service_offer_photo();
create trigger protect_service_offer_photo_update before update of bucket_id,name,owner,owner_id,metadata,version,user_metadata on storage.objects for each row execute function private.protect_service_offer_photo();

-- The existing project-wide quota serializes final writes. Bound this bucket
-- per Provider too, including staging objects; failed uploads cannot grow it
-- without limit. Unreferenced objects are removed through Storage's API.
create function private.bound_service_offer_storage() returns trigger
language plpgsql security definer set search_path='' as $$
declare used_bytes bigint;used_count integer;actor text:=split_part(new.name,'/',1);incoming bigint;
begin
 if new.bucket_id<>'service-offer-photos' then return new;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('service-offers:'||actor,0));
 incoming:=coalesce((new.metadata->>'size')::bigint,1000000);
 select coalesce(sum(coalesce((metadata->>'size')::bigint,1000000)),0),count(*) into used_bytes,used_count
 from storage.objects where bucket_id=new.bucket_id and split_part(name,'/',1)=actor and id<>new.id;
 if used_bytes+incoming>30000000 or used_count>=80 then
  raise exception 'Remove unused service photos before uploading more' using errcode='54000';end if;
 return new;
end $$;
revoke all on function private.bound_service_offer_storage() from public,anon,authenticated,service_role;
create trigger bound_service_offer_storage before insert or update on storage.objects for each row execute function private.bound_service_offer_storage();

create function public.get_my_service_offer_photos(p_service_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();offer public.worker_services;unused jsonb;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('worker',null) then raise exception 'Active Services workspace required';end if;
 select * into offer from public.worker_services where id=p_service_id and worker_id=actor;
 if offer.id is null then raise exception 'Service not found';end if;
 select coalesce(jsonb_agg(name),'[]'::jsonb) into unused from(
  select name from storage.objects where bucket_id='service-offer-photos' and owner_id=auth.uid()::text
   and split_part(name,'/',1)=actor and not private.service_photo_is_referenced(name) order by name limit 24
 ) staged;
 return jsonb_build_object('id',offer.id,'photos',offer.photos,'revision',offer.photo_revision,'unused',unused);
end $$;
create function public.set_my_service_offer_photos(p_service_id uuid,p_photos jsonb,p_expected_revision uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();offer public.worker_services;photo jsonb;photo_id uuid;seen uuid[]:='{}';prefix text;object record;matched integer:=0;
begin
 if actor is null or not public._property_document_session_active() or not public.current_actor_has_workspace('worker',null) then raise exception 'Active Services workspace required';end if;
 if p_photos is null or pg_column_size(p_photos)>8000 or jsonb_typeof(p_photos)<>'array' or jsonb_array_length(p_photos)>3 then raise exception 'Choose up to three service photos';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('service-offers:'||actor,0));
 select * into offer from public.worker_services where id=p_service_id and worker_id=actor for update;
 if offer.id is null then raise exception 'Service not found';end if;
 if offer.photos=p_photos then return public.get_my_service_offer_photos(p_service_id);end if;
 if offer.photo_revision is distinct from p_expected_revision then raise exception 'Service photos changed. Refresh before editing';end if;
 for photo in select value from jsonb_array_elements(p_photos) loop
  if jsonb_typeof(photo)<>'object' or (select count(*) from jsonb_object_keys(photo))<>4
   or jsonb_typeof(photo->'caption') is distinct from 'string' or length(btrim(photo->>'caption')) not between 1 and 140 then raise exception 'Describe each service photo';end if;
  begin photo_id:=(photo->>'id')::uuid;exception when invalid_text_representation then raise exception 'Invalid service photo';end;
  if photo_id is null or photo_id=any(seen) then raise exception 'Choose distinct service photos';end if;
  seen:=array_append(seen,photo_id);prefix:=actor||'/'||offer.id||'/'||photo_id||'/';
  if (photo->>'image') is distinct from prefix||'full.jpg' or (photo->>'preview') is distinct from prefix||'preview.jpg' then raise exception 'Photo belongs to another service';end if;
 end loop;
 -- Lock the actual uploaded objects before publishing references. A concurrent
 -- deletion either finishes first and is rejected here, or waits for publication.
 for object in select name,owner_id,metadata from storage.objects
   where bucket_id='service-offer-photos' and name in(select value->>'image' from jsonb_array_elements(p_photos) union all select value->>'preview' from jsonb_array_elements(p_photos))
   order by name for key share loop
  if object.owner_id is distinct from auth.uid()::text or (object.metadata->>'mimetype') is distinct from 'image/jpeg'
   or coalesce((object.metadata->>'size')::bigint,0) not between 1 and (case when right(object.name,11)='preview.jpg' then 120000 else 700000 end) then raise exception 'Upload a prepared JPG photo and preview before saving';end if;
  matched:=matched+1;
 end loop;
 if matched<>2*jsonb_array_length(p_photos) then raise exception 'Photo upload is incomplete. Refresh before retrying';end if;
 update public.worker_services set photos=p_photos,photo_revision=gen_random_uuid(),updated_at=now() where id=offer.id;
 return public.get_my_service_offer_photos(p_service_id);
end $$;
revoke all on function public.get_my_service_offer_photos(uuid),public.set_my_service_offer_photos(uuid,jsonb,uuid) from public,anon;
grant execute on function public.get_my_service_offer_photos(uuid),public.set_my_service_offer_photos(uuid,jsonb,uuid) to authenticated;

-- Enrich the existing bounded search page, rather than issuing a gallery query
-- for every card. Match the actual requested service before choosing a cover.
create function private.service_offer_card(p_worker text,p_category text default null,p_specialty text default null,p_query text default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',service.id,'name',service.service_name,'price',service.price,'price_type',service.price_type,'cover',service.photos->0)
 from public.worker_services service where worker_id=p_worker
  and (p_specialty is null or lower(btrim(service.service_name))=lower(btrim(p_specialty)))
  and (p_category is null or exists(select 1 from public.service_subcategories sub join public.service_categories category on category.id=sub.category_id
   where lower(btrim(sub.name))=lower(btrim(service.service_name)) and category.name=p_category and sub.is_active and category.is_active))
 order by (p_query is not null and private.discovery_text_matches(service.service_name,p_query)) desc,
  (jsonb_array_length(service.photos)>0) desc,service.created_at,service.id limit 1;
$$;
revoke all on function private.service_offer_card(text,text,text,text) from public,anon,authenticated,service_role;
do $search$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.search_service_providers(text,text,text,text,text,text,numeric,integer,text)'::regprocedure);
 needle:='to_jsonb(rows) as item';
 if strpos(definition,needle)=0 then raise exception 'Inspect service search projection';end if;
 execute replace(definition,needle,'to_jsonb(rows)||jsonb_build_object(''service_offer'',private.service_offer_card(rows.user_id,p_category,p_specialty,p_query)) as item');
 definition:=pg_get_functiondef('public.get_discoverable_service_providers(text[])'::regprocedure);
 needle:='jsonb_agg(to_jsonb(provider) order by provider.user_id)';
 if strpos(definition,needle)=0 then raise exception 'Inspect shared service projection';end if;
 execute replace(definition,needle,'jsonb_agg(to_jsonb(provider)||jsonb_build_object(''service_offer'',private.service_offer_card(provider.user_id)) order by provider.user_id)');
end $search$;
do $authority$
declare permissive text; restrictive text; signature text; definition text;
begin
 select string_agg('('||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid)||')',' or ' order by polname) filter(where polpermissive),
 string_agg('('||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid)||')',' and ' order by polname) filter(where not polpermissive),
 md5(string_agg(polname||':'||polpermissive::text||':'||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid),E'\n' order by polname))
 into permissive,restrictive,signature from pg_catalog.pg_policy
 where polrelid='storage.objects'::regclass and polcmd in('a','*') and polname<>'wehouse_upload_budget_insert'
 and (polroles @> array[0::oid] or polroles @> array['authenticated'::regrole::oid]);
 if permissive is null then raise exception 'Storage upload authority is missing';end if;
 definition:=pg_catalog.format($fn$
 create or replace function private.can_reserve_storage_upload(p_bucket text,p_name text)
 returns boolean language plpgsql stable security definer set search_path='' as $body$
 declare current_signature text; permitted boolean;
 begin
 select md5(string_agg(polname||':'||polpermissive::text||':'||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid),E'\n' order by polname))
 into current_signature from pg_catalog.pg_policy where polrelid='storage.objects'::regclass and polcmd in('a','*')
 and polname<>'wehouse_upload_budget_insert' and (polroles @> array[0::oid] or polroles @> array['authenticated'::regrole::oid]);
 if current_signature is distinct from %L then raise exception 'Upload permissions need a configuration refresh. Contact support';end if;
 select coalesce(((%s) and (%s)),false) into permitted from (select p_bucket as bucket_id,p_name as name,auth.uid()::text as owner_id) objects;
 return permitted;
 end $body$;
 $fn$,signature,permissive,coalesce(restrictive,'true'));
 execute definition;
end $authority$;
commit;
