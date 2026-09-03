alter table public.inspection_requests add column if not exists video_urls text[] not null default array[]::text[];
alter table public.user_inspection_requests add column if not exists video_urls text[] not null default array[]::text[];

create or replace function public.field_officer_add_inspection_media(
  p_inspection_id uuid,
  p_photo_urls text[] default array[]::text[],
  p_video_urls text[] default array[]::text[]
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_updated integer := 0;
begin
  select * into v_actor
  from public.profiles
  where auth_id = auth.uid()::text
    and role = 'staff'
    and coalesce(deleted,false) = false
    and coalesce(suspended,false) = false
    and coalesce(banned,false) = false
    and exists (
      select 1 from public.staff_permissions sp
      where sp.staff_id = profiles.user_id
        and sp.permission = 'field_officer'
        and sp.is_active = true
    )
  limit 1;

  if v_actor is null then raise exception 'Active Field Officer access required'; end if;
  if cardinality(coalesce(p_photo_urls,array[]::text[])) + cardinality(coalesce(p_video_urls,array[]::text[])) > 12 then
    raise exception 'A maximum of 12 evidence files is allowed per upload';
  end if;

  update public.inspection_requests
  set photo_urls = array(select distinct unnest(coalesce(photo_urls,array[]::text[]) || coalesce(p_photo_urls,array[]::text[]))),
      video_urls = array(select distinct unnest(coalesce(video_urls,array[]::text[]) || coalesce(p_video_urls,array[]::text[]))),
      updated_at = now()
  where id = p_inspection_id
    and coalesce(assigned_field_officer_id,field_officer_id,assigned_to) = v_actor.user_id;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    update public.user_inspection_requests
    set photo_urls = array(select distinct unnest(coalesce(photo_urls,array[]::text[]) || coalesce(p_photo_urls,array[]::text[]))),
        video_urls = array(select distinct unnest(coalesce(video_urls,array[]::text[]) || coalesce(p_video_urls,array[]::text[]))),
        updated_at = now()
    where id = p_inspection_id and field_officer_id = v_actor.user_id;
    get diagnostics v_updated = row_count;
  end if;

  if v_updated = 0 then raise exception 'Inspection is not assigned to this Field Officer'; end if;
  return true;
end;
$$;

create or replace function public.get_inspection_media_for_review(p_inspection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role in ('creator','admin','staff')
    and coalesce(deleted,false)=false and coalesce(suspended,false)=false and coalesce(banned,false)=false
  limit 1;
  if v_actor is null then raise exception 'Operations review access required'; end if;

  if v_actor.role='staff' and not exists (
    select 1 from public.staff_permissions sp
    where sp.staff_id=v_actor.user_id and sp.permission='operations' and sp.is_active=true
  ) then raise exception 'Operations module required'; end if;

  select * into v_request from public.inspection_requests where id=p_inspection_id;
  if v_request is null then raise exception 'Inspection not found'; end if;
  if v_actor.role <> 'creator' and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then
    raise exception 'Inspection is outside your assigned branch';
  end if;

  return jsonb_build_object(
    'photos',coalesce(to_jsonb(v_request.photo_urls),'[]'::jsonb),
    'videos',coalesce(to_jsonb(v_request.video_urls),'[]'::jsonb),
    'report',v_request.notes,
    'status',v_request.status
  );
end;
$$;

revoke all on function public.field_officer_add_inspection_media(uuid,text[],text[]), public.get_inspection_media_for_review(uuid) from public,anon;
grant execute on function public.field_officer_add_inspection_media(uuid,text[],text[]), public.get_inspection_media_for_review(uuid) to authenticated;
