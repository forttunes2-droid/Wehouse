create table public.experience_activity_photos (
 id uuid primary key,
 activity_id uuid not null references public.experience_activities(id) on delete restrict,
 revision integer not null default 1 check(revision>0),
 activity_details jsonb not null,
 object_path text not null unique,
 byte_size integer not null check(byte_size between 1 and 2000000),
 caption text not null check(length(btrim(caption)) between 5 and 240),
 status text not null default 'uploading' check(status in ('uploading','submitted','approved','rejected','archived')),
 created_at timestamptz not null default now(),submitted_at timestamptz,
 reviewed_at timestamptz,reviewed_by text references public.profiles(user_id),review_note text
);
create index experience_photos_activity_idx on public.experience_activity_photos(activity_id,status,created_at,id);
create index experience_photos_reviewer_idx on public.experience_activity_photos(reviewed_by);
alter table public.experience_activity_photos enable row level security;
revoke all on public.experience_activity_photos from public,anon,authenticated;
grant all on public.experience_activity_photos to service_role;

create function public.get_experience_activity_photos(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_access_experience_evidence(p_activity_id,false) then raise exception 'Activity photos unavailable' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(p)-'activity_details'||jsonb_build_object('context_current',p.activity_details=a.details) order by p.created_at,p.id),'[]'::jsonb)
 from public.experience_activity_photos p join public.experience_activities a on a.id=p.activity_id
 where p.activity_id=p_activity_id and p.status<>'archived');
end $$;
revoke all on function public.get_experience_activity_photos(uuid) from public,anon;
grant execute on function public.get_experience_activity_photos(uuid) to authenticated;

create function public.begin_experience_activity_photo(p_activity_id uuid,p_photo_id uuid,p_activity_revision integer,p_byte_size integer,p_caption text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); activity public.experience_activities; photo public.experience_activity_photos;
begin
 select * into activity from public.experience_activities where id=p_activity_id and host_user_id=actor for update;
 if activity.id is null then raise exception 'Activity unavailable' using errcode='42501';end if;
 if activity.status not in ('draft','changes_required','withdrawn') or activity.revision is distinct from p_activity_revision then raise exception 'Activity changed or is in review. Refresh before adding photos';end if;
 if p_photo_id is null or p_byte_size is null or p_byte_size not between 1 and 2000000 or length(btrim(coalesce(p_caption,''))) not between 5 and 240 then raise exception 'Choose a prepared photo and describe what it shows';end if;
 select * into photo from public.experience_activity_photos where id=p_photo_id;
 if photo.id is not null then
  if photo.activity_id<>activity.id or photo.activity_details<>activity.details or photo.byte_size<>p_byte_size or photo.caption<>btrim(p_caption) then raise exception 'Upload reference belongs to another photo or activity revision';end if;
  return to_jsonb(photo)-'activity_details'||jsonb_build_object('context_current',true);
 end if;
 if (select count(*) from public.experience_activity_photos where activity_id=activity.id and status<>'archived')>=20
  or (select count(*) from public.experience_activity_photos where activity_id=activity.id)>=100 then raise exception 'Photo limit reached. Archive unused photos or contact support';end if;
 insert into public.experience_activity_photos(id,activity_id,activity_details,object_path,byte_size,caption)
 values(p_photo_id,activity.id,activity.details,activity.id::text||'/'||p_photo_id::text||'.jpg',p_byte_size,btrim(p_caption)) returning * into photo;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('EXPERIENCE_PHOTO_UPLOAD_RESERVED','experience',activity.id::text,actor,jsonb_build_object('photo_id',photo.id,'bytes',photo.byte_size,'revision',photo.revision)::text);
 return to_jsonb(photo)-'activity_details'||jsonb_build_object('context_current',true);
end $$;
revoke all on function public.begin_experience_activity_photo(uuid,uuid,integer,integer,text) from public,anon;
grant execute on function public.begin_experience_activity_photo(uuid,uuid,integer,integer,text) to authenticated;

create function public.finish_experience_activity_photo(p_photo_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); activity public.experience_activities; photo public.experience_activity_photos; metadata jsonb;
begin
 select a.* into activity from public.experience_activities a join public.experience_activity_photos p on p.activity_id=a.id where p.id=p_photo_id and a.host_user_id=actor for update of a;
 if activity.id is null then raise exception 'Photo unavailable' using errcode='42501';end if;
 select * into photo from public.experience_activity_photos where id=p_photo_id for update;
 if photo.status='archived' then raise exception 'Photo was archived';end if;
 if photo.status<>'uploading' then return to_jsonb(photo)-'activity_details'||jsonb_build_object('context_current',photo.activity_details=activity.details);end if;
 if activity.status not in ('draft','changes_required','withdrawn') or photo.activity_details<>activity.details then raise exception 'Activity changed or is in review. Withdraw and refresh before finishing this photo';end if;
 select o.metadata into metadata from storage.objects o where o.bucket_id='experience-photos' and o.name=photo.object_path;
 if metadata is null or (metadata->>'size')::bigint is distinct from photo.byte_size::bigint or metadata->>'mimetype' is distinct from 'image/jpeg' then raise exception 'Uploaded photo has not been confirmed';end if;
 update public.experience_activity_photos set status='submitted',revision=revision+1,submitted_at=now() where id=photo.id returning * into photo;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('EXPERIENCE_PHOTO_SUBMITTED','experience',activity.id::text,actor,jsonb_build_object('photo_id',photo.id,'revision',photo.revision)::text);
 return to_jsonb(photo)-'activity_details'||jsonb_build_object('context_current',true);
end $$;
revoke all on function public.finish_experience_activity_photo(uuid) from public,anon;
grant execute on function public.finish_experience_activity_photo(uuid) to authenticated;

create function public.change_experience_activity_photo(p_photo_id uuid,p_expected_revision integer,p_action text,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text; activity public.experience_activities; photo public.experience_activity_photos; previous jsonb;
begin
 select a.* into activity from public.experience_activities a join public.experience_activity_photos p on p.activity_id=a.id where p.id=p_photo_id for update of a;
 if activity.id is null then raise exception 'Photo unavailable' using errcode='42501';end if;
 if p_action in ('archive','refresh_context') then
  actor:=private.experience_host_actor();
  if activity.host_user_id<>actor or activity.status not in ('draft','changes_required','withdrawn') then raise exception 'Withdraw the application before changing photos' using errcode='42501';end if;
 elsif p_action in ('approved','rejected') then
  actor:=private.experience_creator_actor();
  if actor=activity.host_user_id or activity.status<>'submitted' then raise exception 'Independent submitted-activity review is required' using errcode='42501';end if;
  if length(btrim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'Provide a review reason';end if;
 else raise exception 'Unknown photo action';end if;
 select * into photo from public.experience_activity_photos where id=p_photo_id for update;
 if photo.revision=p_expected_revision+1 and
  ((p_action='archive' and photo.status='archived') or
   (p_action='refresh_context' and photo.status='submitted' and photo.activity_details=activity.details and photo.reviewed_at is null) or
   (p_action in ('approved','rejected') and photo.status=p_action and photo.reviewed_by=actor and photo.review_note=btrim(p_note))) then
  return to_jsonb(photo)-'activity_details'||jsonb_build_object('context_current',photo.activity_details=activity.details);
 end if;
 if photo.revision is distinct from p_expected_revision then raise exception 'Photo changed. Refresh before continuing';end if;
 if p_action in ('approved','rejected') and (photo.status not in ('submitted','approved','rejected') or photo.activity_details<>activity.details) then raise exception 'Review the photo against current activity details';end if;
 if p_action='refresh_context' and photo.status not in ('submitted','approved','rejected') then raise exception 'Finish the upload before using it for revised activity details';end if;
 previous:=to_jsonb(photo);
 update public.experience_activity_photos set revision=revision+1,
  status=case p_action when 'archive' then 'archived' when 'refresh_context' then 'submitted' else p_action end,
  activity_details=case when p_action='refresh_context' then activity.details else activity_details end,
  reviewed_at=case when p_action in ('approved','rejected') then now() end,
  reviewed_by=case when p_action in ('approved','rejected') then actor end,
  review_note=case when p_action in ('approved','rejected') then btrim(p_note) end
 where id=photo.id returning * into photo;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details)
 values('EXPERIENCE_PHOTO_'||upper(p_action),'experience',activity.id::text,actor,jsonb_build_object('before',previous,'after',to_jsonb(photo))::text);
 return to_jsonb(photo)-'activity_details'||jsonb_build_object('context_current',photo.activity_details=activity.details);
end $$;
revoke all on function public.change_experience_activity_photo(uuid,integer,text,text) from public,anon;
grant execute on function public.change_experience_activity_photo(uuid,integer,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('experience-photos','experience-photos',false,2000000,array['image/jpeg']);
create function public.can_access_experience_photo_object(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare photo public.experience_activity_photos; activity public.experience_activities;
begin
 select * into photo from public.experience_activity_photos where object_path=p_path;
 if photo.id is null or photo.status='archived' or not public.can_access_experience_evidence(photo.activity_id,false) then return false;end if;
 if not p_write then return true;end if;
 select * into activity from public.experience_activities where id=photo.activity_id;
 return activity.host_user_id=public.current_profile_user_id() and activity.status in ('draft','changes_required','withdrawn') and photo.status='uploading' and photo.activity_details=activity.details;
end $$;
revoke all on function public.can_access_experience_photo_object(text,boolean) from public,anon;
grant execute on function public.can_access_experience_photo_object(text,boolean) to authenticated;
create policy experience_photo_read on storage.objects for select to authenticated using(bucket_id='experience-photos' and public.can_access_experience_photo_object(name,false));
create policy experience_photo_insert on storage.objects for insert to authenticated with check(bucket_id='experience-photos' and public.can_access_experience_photo_object(name,true));
create policy experience_photo_anon_boundary on storage.objects as restrictive for all to anon using(bucket_id<>'experience-photos') with check(bucket_id<>'experience-photos');
create policy experience_photo_read_boundary on storage.objects as restrictive for select to authenticated using(bucket_id<>'experience-photos' or public.can_access_experience_photo_object(name,false));
create policy experience_photo_insert_boundary on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'experience-photos' or public.can_access_experience_photo_object(name,true));
create policy experience_photo_update_boundary on storage.objects as restrictive for update to authenticated using(bucket_id<>'experience-photos') with check(bucket_id<>'experience-photos');
create policy experience_photo_delete_boundary on storage.objects as restrictive for delete to authenticated using(bucket_id<>'experience-photos');
