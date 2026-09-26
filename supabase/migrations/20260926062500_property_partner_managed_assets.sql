-- Property Partner workspace reads exactly the properties assigned to the actor.

create or replace function public.get_my_managed_properties()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;

  select coalesce(jsonb_agg(
    (to_jsonb(l)-'access_code'-'private_video_url'-'private_video_path')
      || jsonb_build_object(
        '_assignment_role',a.assignment_role,
        '_assignment_status',a.status,
        '_can_manage',a.status='active',
        '_is_owner',a.assignment_role='owner' and a.status='active'
      )
    order by l.created_at desc
  ),'[]'::jsonb)
  into v_result
  from public.property_host_assignments a
  join public.listings l on l.id=a.listing_id
  where a.user_id=v_actor
    and a.status='active'
    and l.deleted_at is null
    and l.approved_at is not null
    and l.status in ('available','reserved','occupied','maintenance','closed');

  return v_result;
end
$$;
revoke all on function public.get_my_managed_properties() from public,anon;
grant execute on function public.get_my_managed_properties() to authenticated;

create or replace function public.get_my_property_host_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'assignment_id',a.assignment_id,
    'listing_id',l.id,
    'public_listing_code',l.listing_id,
    'title',l.title,
    'city',l.city,
    'state',l.state,
    'invited_at',a.invited_at,
    'invited_by',a.invited_by
  ) order by a.invited_at desc),'[]'::jsonb)
  into v_result
  from public.property_host_assignments a
  join public.listings l on l.id=a.listing_id
  where a.user_id=v_actor and a.status='invited' and l.deleted_at is null;
  return v_result;
end
$$;
revoke all on function public.get_my_property_host_invites() from public,anon;
grant execute on function public.get_my_property_host_invites() to authenticated;

drop policy if exists listings_property_host_read_assigned on public.listings;
create policy listings_property_host_read_assigned
on public.listings for select to authenticated
using(
  exists(
    select 1 from public.property_host_assignments a
    where a.listing_id=listings.id
      and a.user_id=public.current_profile_user_id()
      and a.status='active'
  )
);
