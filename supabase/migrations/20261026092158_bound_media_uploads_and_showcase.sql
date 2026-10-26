begin;
create table if not exists private.media_upload_policy(
 singleton boolean primary key default true check(singleton),
 project_bytes bigint not null default 800000000 check(project_bytes>0),
 showcase_bytes bigint not null default 80000000 check(showcase_bytes>0),
 showcase_posts integer not null default 12 check(showcase_posts between 1 and 100),
 showcase_videos integer not null default 3 check(showcase_videos between 0 and showcase_posts),
 showcase_photo_bytes bigint not null default 2000000 check(showcase_photo_bytes>0),
 showcase_video_bytes bigint not null default 13000000 check(showcase_video_bytes>0)
);
alter table private.media_upload_policy enable row level security;
revoke all on private.media_upload_policy from public,anon,authenticated;
grant all on private.media_upload_policy to service_role;
insert into private.media_upload_policy(singleton) values(true) on conflict do nothing;

-- Read system-owned metadata only. Never insert, update or delete Storage rows here.
-- A bucket's maximum is reserved conservatively when its final size is not known.
create or replace function private.storage_upload_within_budget(p_bucket text,p_object uuid,p_name text,p_metadata jsonb)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare policy private.media_upload_policy; cap bigint; used numeric; own_used numeric; own_count integer; actor text; incoming_size numeric; incoming_mime text;
begin
 if (select auth.uid()) is null then raise exception 'Sign in before uploading';end if;
 select * into policy from private.media_upload_policy where singleton;
 if policy.singleton is null then raise exception 'Upload limits are unavailable. Try again later';end if;
 select coalesce(file_size_limit,50000000) into cap from storage.buckets where id=p_bucket;
 if cap is null or cap<=0 then raise exception 'This upload destination is unavailable';end if;
 incoming_mime:=lower(split_part(coalesce(p_metadata->>'mimetype',''),';',1));
 if p_metadata->>'size' ~ '^[0-9]{1,12}$' then incoming_size:=(p_metadata->>'size')::numeric;end if;
 if p_bucket in('worker-showcase','listing-images','listing-candidates') and incoming_mime like 'image/%'
   and incoming_size>2000000 then raise exception 'Compress this photo below 2 MB before uploading';end if;
 perform pg_advisory_xact_lock(hashtextextended('wehouse:storage-admission',0));
 select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,12}$' and (o.metadata->>'size')::numeric>0
   then (o.metadata->>'size')::numeric else coalesce(b.file_size_limit,50000000) end),0)
 into used from storage.objects o join storage.buckets b on b.id=o.bucket_id
 where o.id is distinct from p_object or o.bucket_id<>p_bucket;
 if used+cap>policy.project_bytes then raise exception 'WeHouse upload capacity is temporarily full. Try later or contact support';end if;
 if p_bucket='worker-showcase' then
  actor:=public.current_profile_user_id();
  if actor is null or split_part(p_name,'/',1)<>actor then return false;end if;
  perform pg_advisory_xact_lock(hashtextextended('showcase:'||actor,0));
  select count(*),coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,12}$' and (o.metadata->>'size')::numeric>0
   then (o.metadata->>'size')::numeric else cap end),0)
  into own_count,own_used from storage.objects o
  where o.bucket_id=p_bucket and split_part(o.name,'/',1)=actor and o.id is distinct from p_object;
  if own_count>=policy.showcase_posts+2 or own_used+cap>policy.showcase_bytes
   then raise exception 'Your showcase upload allowance is full. Remove old work samples or contact support about unfinished uploads';end if;
 end if;
 return true;
end $$;
revoke all on function private.storage_upload_within_budget(text,uuid,text,jsonb) from public,anon;
grant execute on function private.storage_upload_within_budget(text,uuid,text,jsonb) to authenticated;
create policy wehouse_upload_budget_insert on storage.objects as restrictive
for insert to authenticated with check(private.storage_upload_within_budget(bucket_id,id,name,metadata));
create policy wehouse_upload_budget_update on storage.objects as restrictive
for update to authenticated using(true) with check(private.storage_upload_within_budget(bucket_id,id,name,metadata));

create or replace function public.get_my_worker_showcase_capacity()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); policy private.media_upload_policy; used integer; videos integer;
begin
 if actor is null or not public.current_actor_has_workspace('worker',null) then raise exception 'Service Provider account required';end if;
 select * into policy from private.media_upload_policy where singleton;
 if policy.singleton is null then raise exception 'Upload limits are unavailable';end if;
 select count(*),count(*) filter(where media_type='video') into used,videos
 from public.worker_showcase_posts where worker_id=actor and deleted_at is null;
 return jsonb_build_object('posts',used,'videos',videos,'post_limit',policy.showcase_posts,'video_limit',policy.showcase_videos,
 'photo_bytes',policy.showcase_photo_bytes,'video_bytes',policy.showcase_video_bytes);
end $$;
revoke all on function public.get_my_worker_showcase_capacity() from public,anon;
grant execute on function public.get_my_worker_showcase_capacity() to authenticated,service_role;
CREATE OR REPLACE FUNCTION public.create_my_worker_showcase_post(p_kind text, p_media_type text, p_storage_path text, p_caption text DEFAULT NULL::text, p_booking_id uuid DEFAULT NULL::uuid)
 RETURNS worker_showcase_posts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'storage'
AS $function$
declare
  v_worker public.profiles;
  v_booking public.worker_bookings;
  v_post public.worker_showcase_posts;
  v_object storage.objects;
  v_policy private.media_upload_policy;
  v_count integer; v_video_count integer; v_bytes numeric; v_mime text;
begin
  select * into v_worker
  from public.profiles
  where auth_id=(select auth.uid())::text
    and worker_status='verified'
    and coalesce(worker_verified,false)
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_worker is null or not public.current_actor_has_workspace('worker',null) then
    raise exception 'Only an approved live Worker can publish Work Posts';
  end if;
  if not public.worker_identity_is_current(v_worker.user_id) then
    raise exception 'Repeat your WeHouse identity check before publishing new work';
  end if;
  if p_kind is distinct from 'work_post' then raise exception 'Only work samples are supported'; end if;
  if p_media_type is null or p_media_type not in ('image','video') then raise exception 'Invalid media type'; end if;
  if nullif(btrim(coalesce(p_storage_path,'')),'') is null
     or split_part(p_storage_path,'/',1)<>v_worker.user_id then
    raise exception 'Invalid Work Post storage path';
  end if;
  if length(coalesce(p_caption,''))>300 then raise exception 'Caption is too long'; end if;
  perform pg_advisory_xact_lock(hashtextextended('showcase:'||v_worker.user_id,0));
  select * into v_policy from private.media_upload_policy where singleton;
  if v_policy.singleton is null then raise exception 'Upload limits are unavailable. Try again later';end if;
  select * into v_post from public.worker_showcase_posts where storage_path=p_storage_path;
  if found then
    if v_post.worker_id=v_worker.user_id and v_post.deleted_at is null and v_post.kind=p_kind
      and v_post.media_type=p_media_type and v_post.caption is not distinct from nullif(btrim(coalesce(p_caption,'')),'')
      and v_post.booking_id is not distinct from p_booking_id then return v_post;end if;
    raise exception 'This upload has already been used. Refresh your work samples before retrying';
  end if;
  select count(*),count(*) filter(where media_type='video') into v_count,v_video_count
  from public.worker_showcase_posts where worker_id=v_worker.user_id and deleted_at is null;
  if v_count>=v_policy.showcase_posts then raise exception 'Your showcase is full (% work samples). Remove an old sample before adding another',v_policy.showcase_posts;end if;
  if p_media_type='video' and v_video_count>=v_policy.showcase_videos then raise exception 'Your showcase already has % videos. Remove one before adding another',v_policy.showcase_videos;end if;
  select * into v_object from storage.objects where bucket_id='worker-showcase' and name=p_storage_path;
  begin v_bytes:=(v_object.metadata->>'size')::numeric;
  exception when others then raise exception 'Media size could not be verified. Upload the file again';end;
  v_mime:=lower(split_part(coalesce(v_object.metadata->>'mimetype',''),';',1));
  if v_bytes is null or v_bytes<=0 or v_bytes<>trunc(v_bytes)
    or (p_media_type='image' and (v_bytes>v_policy.showcase_photo_bytes or v_mime not in('image/jpeg','image/png','image/webp')))
    or (p_media_type='video' and (v_bytes>v_policy.showcase_video_bytes or v_mime not in('video/mp4','video/webm','video/quicktime')))
  then raise exception 'Upload a supported photo under 2 MB or video under 13 MB';end if;

  if not exists(
    select 1 from storage.objects object
    where object.bucket_id='worker-showcase' and object.name=p_storage_path
  ) then raise exception 'Work Post media upload was not found'; end if;
  if p_booking_id is not null then
    select * into v_booking
    from public.worker_bookings booking
    where booking.id=p_booking_id
      and booking.worker_id=v_worker.user_id
      and booking.status='approved_released';
    if v_booking is null then
      raise exception 'Only your completed WeHouse job can be linked';
    end if;
  end if;
  insert into public.worker_showcase_posts(
    worker_id,kind,media_type,storage_path,caption,booking_id,verified_job,
    expires_at,job_confirmation_status
  ) values(
    v_worker.user_id,'work_post',p_media_type,p_storage_path,
    nullif(btrim(coalesce(p_caption,'')),''),p_booking_id,false,null,
    case when p_booking_id is null then 'not_linked' else 'pending' end
  ) returning * into v_post;
  if p_booking_id is not null then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key
    ) values(
      v_booking.user_id,'work_post_confirmation_requested',
      'Confirm this work post',
      'The Worker linked a photo or video to your completed job. Review the media and confirm only if it shows the work completed for you.',
      v_post.id::text,'worker_work_post',v_post.id::text,'activity',
      jsonb_build_object(
        'work_post_id',v_post.id,'booking_id',v_booking.id
      ),
      'work-post-confirmation:'||v_post.id::text
    ) on conflict(recipient_id,event_key)
      where event_key is not null do nothing;
  end if;
  return v_post;
end
$function$
;
create or replace function public._validate_property_submission_facts(p_items jsonb)
returns void language plpgsql set search_path to 'pg_catalog','public'
as $$
declare item jsonb; room jsonb; position integer:=0; field text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Provide a property submission list'; end if;
  if jsonb_array_length(p_items)=0 then raise exception 'Add a property before submitting'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    position:=position+1;
    if item ? 'photo_urls' then
      if jsonb_typeof(item->'photo_urls') is distinct from 'array' then raise exception 'Property %: choose uploaded photos',position;end if;
      if jsonb_array_length(item->'photo_urls')>12 then raise exception 'Property %: keep up to 12 photos',position;end if;
    end if;
    if item->>'property_type'='apartment' then
      foreach field in array array['bedrooms','bathrooms'] loop
        if coalesce(item->>field,'') !~ '^[0-9]+$' then raise exception 'Property %: enter a whole-number % count',position,field; end if;
        if (item->>field)::numeric>2147483647 then raise exception 'Property %: % count is too large',position,field; end if;
      end loop;
    elsif item->>'property_type'='hotel' then
      if jsonb_typeof(item->'hotel_program'->'room_types') is distinct from 'array' then raise exception 'Property %: add Hotel room types',position; end if;
      if jsonb_array_length(item->'hotel_program'->'room_types')=0 then raise exception 'Property %: add Hotel room types',position; end if;
      for room in select value from jsonb_array_elements(item->'hotel_program'->'room_types') loop
        if room ? 'images' then
          if jsonb_typeof(room->'images') is distinct from 'array' then raise exception 'Property %: choose uploaded room photos',position;end if;
          if jsonb_array_length(room->'images')>12 then raise exception 'Property %: keep up to 12 photos per room type',position;end if;
        end if;
        foreach field in array array['guest_capacity','inventory'] loop
          if coalesce(room->>field,'') !~ '^[0-9]+$' then raise exception 'Property %: Hotel % must be a whole number',position,field; end if;
          if (room->>field)::numeric<1 or (room->>field)::numeric>2147483647 then raise exception 'Property %: Hotel % must be at least 1 and within the supported range',position,field; end if;
        end loop;
      end loop;
    end if;
  end loop;
end;
$$;
revoke all on function public._validate_property_submission_facts(jsonb) from public,anon,authenticated;


commit;
