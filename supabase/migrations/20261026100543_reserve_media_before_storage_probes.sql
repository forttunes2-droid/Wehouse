begin;
alter table private.media_upload_policy add column reservation_revision bigint not null default 0;
create table private.media_upload_reservations(
 id uuid primary key default gen_random_uuid(),actor_auth_id uuid not null,bucket_id text not null,object_name text not null,
 reserved_bytes bigint not null check(reserved_bytes>0),previous_version text,
 state text not null default 'pending' check(state in('pending','completed')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 unique(actor_auth_id,bucket_id,object_name)
);
alter table private.media_upload_reservations enable row level security;
revoke all on private.media_upload_reservations from public,anon,authenticated;
grant all on private.media_upload_reservations to service_role;
create index media_upload_reservations_pending_idx on private.media_upload_reservations(state,bucket_id,object_name) where state='pending';

create or replace function public.reserve_my_media_upload(p_bucket text,p_name text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles; policy private.media_upload_policy; ticket private.media_upload_reservations;
 cap bigint; old_version text; used numeric; pending numeric; own_used numeric; own_pending numeric; own_count integer; own_objects integer;
begin
 select * into actor from public.profiles where auth_id=(select auth.uid())::text
 and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
 if actor.user_id is null then raise exception 'An active WeHouse account is required before uploading';end if;
 if nullif(btrim(p_name),'') is null or length(p_name)>1024 or p_name ~ '(^|/)\.{1,2}(/|$)' then raise exception 'Invalid upload name';end if;
 select coalesce(file_size_limit,50000000) into cap from storage.buckets where id=p_bucket;
 if cap is null or cap<=0 then raise exception 'This upload destination is unavailable';end if;
 if p_bucket='worker-showcase' and (split_part(p_name,'/',1)<>actor.user_id or actor.worker_status is distinct from 'verified'
  or not coalesce(actor.worker_verified,false) or not public.current_actor_has_workspace('worker',null)
  or not public.worker_identity_is_current(actor.user_id)) then raise exception 'A verified Service Provider must upload their own work';end if;
 -- This RPC commits a durable allocation BEFORE Storage's rollback permission probes.
 -- Updating the singleton also makes overlapping repeatable-read callers retry safely.
 update private.media_upload_policy set reservation_revision=reservation_revision+1 where singleton returning * into policy;
 if policy.singleton is null then raise exception 'Upload limits are unavailable';end if;
 select o.version into old_version from storage.objects o where bucket_id=p_bucket and name=p_name;
 select * into ticket from private.media_upload_reservations where actor_auth_id=(select auth.uid()) and bucket_id=p_bucket and object_name=p_name;
 if found and ticket.state='pending' and ticket.previous_version is not distinct from old_version then
  update private.media_upload_reservations set expires_at=clock_timestamp()+interval '2 hours' where id=ticket.id returning * into ticket;
  return jsonb_build_object('id',ticket.id,'expires_at',ticket.expires_at,'reserved_bytes',ticket.reserved_bytes);
 end if;
 select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,12}$'
  then case when (o.metadata->>'size')::numeric>0 then (o.metadata->>'size')::numeric else coalesce(b.file_size_limit,50000000) end
  else coalesce(b.file_size_limit,50000000) end),0) into used
 from storage.objects o join storage.buckets b on b.id=o.bucket_id;
 -- Expired unfinished allocations remain charged until verified completion or
 -- operator recovery. Expiry alone must never let a late upload overspend space.
 select coalesce(sum(r.reserved_bytes),0) into pending from private.media_upload_reservations r
 where r.state='pending' and not exists(select 1 from storage.objects o where o.bucket_id=r.bucket_id and o.name=r.object_name and o.version is distinct from r.previous_version);
 if used+pending+cap>policy.project_bytes then raise exception 'WeHouse upload capacity is temporarily full. Try later or contact support';end if;
 select count(*),coalesce(sum(r.reserved_bytes),0) into own_count,own_pending
 from private.media_upload_reservations r where r.actor_auth_id=(select auth.uid()) and r.state='pending'
 and not exists(select 1 from storage.objects o where o.bucket_id=r.bucket_id and o.name=r.object_name and o.version is distinct from r.previous_version);
 if own_count>=6 or own_pending+cap>200000000 then raise exception 'Finish your pending uploads before adding more files';end if;
 if p_bucket='worker-showcase' then
  select count(*),coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,12}$'
   then case when (o.metadata->>'size')::numeric>0 then (o.metadata->>'size')::numeric else cap end else cap end),0)
  into own_objects,own_used from storage.objects o where o.bucket_id=p_bucket and split_part(o.name,'/',1)=actor.user_id;
  select coalesce(sum(r.reserved_bytes),0) into own_pending from private.media_upload_reservations r
  where r.actor_auth_id=(select auth.uid()) and r.bucket_id=p_bucket and r.state='pending'
  and not exists(select 1 from storage.objects o where o.bucket_id=r.bucket_id and o.name=r.object_name and o.version is distinct from r.previous_version);
  if own_objects+own_count>=policy.showcase_posts+2 or own_used+own_pending+cap>policy.showcase_bytes
   then raise exception 'Your showcase upload allowance is full. Remove old work samples or contact support about unfinished uploads';end if;
 end if;
 insert into private.media_upload_reservations(actor_auth_id,bucket_id,object_name,reserved_bytes,previous_version,expires_at)
 values((select auth.uid()),p_bucket,p_name,cap,old_version,clock_timestamp()+interval '2 hours')
 on conflict(actor_auth_id,bucket_id,object_name) do update set reserved_bytes=excluded.reserved_bytes,
 previous_version=excluded.previous_version,state='pending',created_at=clock_timestamp(),expires_at=excluded.expires_at returning * into ticket;
 return jsonb_build_object('id',ticket.id,'expires_at',ticket.expires_at,'reserved_bytes',ticket.reserved_bytes);
end $$;
revoke all on function public.reserve_my_media_upload(text,text) from public,anon;
grant execute on function public.reserve_my_media_upload(text,text) to authenticated;

create or replace function public.complete_my_media_upload(p_reservation_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare ticket private.media_upload_reservations;
begin
 select * into ticket from private.media_upload_reservations where id=p_reservation_id and actor_auth_id=(select auth.uid()) for update;
 if ticket.id is null then raise exception 'Upload allocation not found';end if;
 if ticket.state='completed' then return true;end if;
 if not exists(select 1 from storage.objects o where o.bucket_id=ticket.bucket_id and o.name=ticket.object_name
  and o.version is distinct from ticket.previous_version) then return false;end if;
 update private.media_upload_reservations set state='completed' where id=ticket.id;
 return true;
end $$;
revoke all on function public.complete_my_media_upload(uuid) from public,anon;
grant execute on function public.complete_my_media_upload(uuid) to authenticated;

-- The policy is read-only: Storage may roll back its permission probe. Only the
-- independently committed RPC above allocates space.
create or replace function private.storage_upload_within_budget(p_bucket text,p_object uuid,p_name text,p_metadata jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare ticket private.media_upload_reservations; current_version text; incoming_size numeric; incoming_mime text;
begin
 select * into ticket from private.media_upload_reservations r where r.actor_auth_id=(select auth.uid())
  and r.bucket_id=p_bucket and r.object_name=p_name and r.state='pending' and r.expires_at>clock_timestamp();
 if ticket.id is null then raise exception 'Start this upload again to confirm available space';end if;
 select o.version into current_version from storage.objects o where o.bucket_id=p_bucket and o.name=p_name;
 if current_version is distinct from ticket.previous_version then raise exception 'This upload allocation was already used';end if;
 incoming_mime:=lower(split_part(coalesce(p_metadata->>'mimetype',''),';',1));
 if p_metadata->>'size' ~ '^[0-9]{1,12}$' then incoming_size:=(p_metadata->>'size')::numeric;
 elsif p_metadata->>'contentLength' ~ '^[0-9]{1,12}$' then incoming_size:=(p_metadata->>'contentLength')::numeric;end if;
 if incoming_size>ticket.reserved_bytes then raise exception 'This file exceeds its upload allowance';end if;
 if p_bucket in('worker-showcase','listing-images','listing-candidates') and incoming_mime like 'image/%'
  and incoming_size>2000000 then raise exception 'Compress this photo below 2 MB before uploading';end if;
 return true;
end $$;

create or replace function public._validate_property_submission_facts(p_items jsonb)
returns void language plpgsql set search_path='pg_catalog','public' as $$
declare item jsonb;room jsonb;position integer:=0;field text;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Provide a property submission list';end if;
 if jsonb_array_length(p_items)=0 then raise exception 'Add a property before submitting';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  position:=position+1;
  if item ? 'photo_urls' then
   if jsonb_typeof(item->'photo_urls') is distinct from 'array' then raise exception 'Property %: choose uploaded photos',position;end if;
   if jsonb_array_length(item->'photo_urls')>12 then raise exception 'Property %: keep up to 12 photos',position;end if;
  end if;
  if item->>'property_type'='apartment' then
   foreach field in array array['bedrooms','bathrooms'] loop
    if coalesce(item->>field,'') !~ '^[0-9]+$' then raise exception 'Property %: enter a whole-number % count',position,field;end if;
    if (item->>field)::numeric>2147483647 then raise exception 'Property %: % count is too large',position,field;end if;
   end loop;
  elsif item->>'property_type'='hotel' then
   if jsonb_typeof(item->'hotel_program'->'room_types') is distinct from 'array' then raise exception 'Property %: add Hotel room types',position;end if;
   if jsonb_array_length(item->'hotel_program'->'room_types')=0 then raise exception 'Property %: add Hotel room types',position;end if;
   for room in select value from jsonb_array_elements(item->'hotel_program'->'room_types') loop
    foreach field in array array['media','images'] loop
     if room ? field then
      if jsonb_typeof(room->field) is distinct from 'array' then raise exception 'Property %: choose uploaded room photos',position;end if;
      if jsonb_array_length(room->field)>12 then raise exception 'Property %: keep up to 12 photos per room type',position;end if;
     end if;
    end loop;
    foreach field in array array['guest_capacity','inventory'] loop
     if coalesce(room->>field,'') !~ '^[0-9]+$' then raise exception 'Property %: Hotel % must be a whole number',position,field;end if;
     if (room->>field)::numeric<1 or (room->>field)::numeric>2147483647 then raise exception 'Property %: Hotel % must be at least 1 and within the supported range',position,field;end if;
    end loop;
   end loop;
  end if;
 end loop;
end $$;
commit;
