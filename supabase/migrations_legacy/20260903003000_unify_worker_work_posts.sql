-- A worker publishes one durable Work Post type. A linked WeHouse job is
-- publicly verified only after the exact customer confirms the media.

alter table public.worker_showcase_posts
  add column if not exists job_confirmation_status text not null default 'not_linked',
  add column if not exists job_confirmed_by text,
  add column if not exists job_confirmed_at timestamptz;

alter table public.worker_showcase_posts
  drop constraint if exists worker_showcase_posts_kind_check,
  drop constraint if exists worker_showcase_story_expiry,
  drop constraint if exists worker_showcase_job_confirmation_status_check;

update public.worker_showcase_posts
set kind='work_post',
    expires_at=null,
    verified_job=false,
    job_confirmation_status=case when booking_id is null then 'not_linked' else 'pending' end,
    job_confirmed_by=null,
    job_confirmed_at=null;

alter table public.worker_showcase_posts
  add constraint worker_showcase_posts_kind_check check(kind='work_post'),
  add constraint worker_showcase_story_expiry check(expires_at is null),
  add constraint worker_showcase_job_confirmation_status_check
    check(job_confirmation_status in ('not_linked','pending','confirmed','declined'));

drop index if exists public.idx_worker_showcase_story_expiry;

create or replace function public.create_my_worker_showcase_post(
  p_kind text,
  p_media_type text,
  p_storage_path text,
  p_caption text default null,
  p_booking_id uuid default null
) returns public.worker_showcase_posts
language plpgsql security definer set search_path=public,storage
as $$
declare
  v_worker public.profiles;
  v_booking public.worker_bookings;
  v_post public.worker_showcase_posts;
begin
  select * into v_worker from public.profiles
  where auth_id=auth.uid()::text and role='worker' and worker_status='verified'
    and coalesce(worker_verified,false)=true and coalesce(deleted,false)=false
    and coalesce(suspended,false)=false and coalesce(banned,false)=false limit 1;
  if v_worker is null then raise exception 'Only an approved live Worker can publish Work Posts'; end if;
  if not public.worker_identity_is_current(v_worker.user_id) then raise exception 'Repeat your WeHouse identity check before publishing new work'; end if;
  if p_kind <> 'work_post' then raise exception 'Only Work Posts are supported'; end if;
  if p_media_type not in ('image','video') then raise exception 'Invalid media type'; end if;
  if nullif(btrim(coalesce(p_storage_path,'')),'') is null or split_part(p_storage_path,'/',1)<>v_worker.user_id then raise exception 'Invalid Work Post storage path'; end if;
  if length(coalesce(p_caption,''))>300 then raise exception 'Caption is too long'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='worker-showcase' and o.name=p_storage_path) then raise exception 'Work Post media upload was not found'; end if;

  if p_booking_id is not null then
    select * into v_booking from public.worker_bookings b
    where b.id=p_booking_id and b.worker_id=v_worker.user_id and b.status='approved_released';
    if v_booking is null then raise exception 'Only your completed WeHouse job can be linked'; end if;
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
      v_booking.user_id,'work_post_confirmation_requested','Confirm this work post',
      'The worker linked a photo or video to your completed job. Review the media and confirm only if it shows the work completed for you.',
      v_post.id::text,'worker_work_post',v_post.id::text,'activity',
      jsonb_build_object('work_post_id',v_post.id,'booking_id',v_booking.id),
      'work-post-confirmation:'||v_post.id::text
    ) on conflict(recipient_id,event_key) where event_key is not null do nothing;
  end if;
  return v_post;
end;
$$;

create or replace function public.respond_to_worker_work_post_confirmation(
  p_post_id uuid,
  p_confirm boolean
) returns public.worker_showcase_posts
language plpgsql security definer set search_path=public
as $$
declare
  v_actor public.profiles;
  v_post public.worker_showcase_posts;
  v_booking public.worker_bookings;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null then raise exception 'Profile not found'; end if;
  select * into v_post from public.worker_showcase_posts
    where id=p_post_id and deleted_at is null and booking_id is not null for update;
  if v_post is null then raise exception 'Linked Work Post not found'; end if;
  select * into v_booking from public.worker_bookings where id=v_post.booking_id;
  if v_booking is null or v_booking.user_id<>v_actor.user_id or v_booking.worker_id<>v_post.worker_id or v_booking.status<>'approved_released' then
    raise exception 'Only the customer from this completed job can confirm this Work Post';
  end if;
  if v_post.job_confirmation_status<>'pending' then raise exception 'This Work Post confirmation has already been answered'; end if;

  update public.worker_showcase_posts set
    job_confirmation_status=case when p_confirm then 'confirmed' else 'declined' end,
    verified_job=p_confirm,
    job_confirmed_by=v_actor.user_id,
    job_confirmed_at=now()
  where id=v_post.id returning * into v_post;

  update public.notifications set read=true,read_at=coalesce(read_at,now())
    where recipient_id=v_actor.user_id and event_key='work-post-confirmation:'||v_post.id::text;
  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,
    destination_route,destination_params,event_key
  ) values(
    v_post.worker_id,
    case when p_confirm then 'work_post_confirmed' else 'work_post_declined' end,
    case when p_confirm then 'Customer confirmed your work post' else 'Customer did not confirm your work post' end,
    case when p_confirm then 'This post can now show Completed through WeHouse.' else 'The post remains public as an ordinary Work Post without a WeHouse job badge.' end,
    v_post.id::text,'worker_work_post',v_post.id::text,'worker-dashboard',
    jsonb_build_object('work_post_id',v_post.id,'booking_id',v_booking.id),
    'work-post-response:'||v_post.id::text
  ) on conflict(recipient_id,event_key) where event_key is not null do nothing;
  return v_post;
end;
$$;

revoke all on function public.respond_to_worker_work_post_confirmation(uuid,boolean) from public,anon;
grant execute on function public.respond_to_worker_work_post_confirmation(uuid,boolean) to authenticated,service_role;

-- Existing linked posts now require genuine customer confirmation too.
insert into public.notifications(
  recipient_id,type,title,message,related_id,source_type,source_id,
  destination_route,destination_params,event_key
)
select b.user_id,'work_post_confirmation_requested','Confirm this work post',
  'The worker linked a photo or video to your completed job. Review the media and confirm only if it shows the work completed for you.',
  p.id::text,'worker_work_post',p.id::text,'activity',
  jsonb_build_object('work_post_id',p.id,'booking_id',b.id),
  'work-post-confirmation:'||p.id::text
from public.worker_showcase_posts p join public.worker_bookings b on b.id=p.booking_id
where p.deleted_at is null and p.job_confirmation_status='pending' and b.status='approved_released'
on conflict(recipient_id,event_key) where event_key is not null do nothing;
