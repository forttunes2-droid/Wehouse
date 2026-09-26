-- Property operating responsibility starts only after a home is published.
-- Submission, Field Operations evidence, inspection and WeHouse approval remain
-- one shared lifecycle regardless of who later operates guest bookings.

alter table public.listings
  alter column wehouse_management_status set default 'not_required';

-- Rows that have never had a management choice must not look like they already
-- requested WeHouse Property Operations. Existing configured/live rows are kept.
update public.listings
set wehouse_management_status='not_required'
where management_updated_at is null
  and wehouse_management_status='requested';

create or replace function public.set_my_property_management_mode(
  p_listing_id uuid,p_mode text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if p_mode not in ('host','wehouse') then
    raise exception 'Choose Host manages or WeHouse manages';
  end if;

  if not exists(
    select 1
    from public.property_host_assignments a
    where a.listing_id=p_listing_id
      and a.user_id=v_actor
      and a.assignment_role='owner'
      and a.status='active'
  ) then
    raise exception 'Only the property owner can change who manages this home';
  end if;

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null
  for update;

  if v_listing.id is null then
    raise exception 'Property not found';
  end if;

  if v_listing.approved_at is null
     or v_listing.status not in ('available','unavailable','reserved','occupied','maintenance','closed') then
    raise exception 'Choose property management after this home is published';
  end if;

  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set management_mode=p_mode,
      management_host_user_id=case when p_mode='host' then v_actor else null end,
      wehouse_management_status=case
        when p_mode='host' then 'not_required'
        when management_mode='wehouse' and wehouse_management_status='approved' and management_updated_at is not null then 'approved'
        else 'requested'
      end,
      management_updated_at=now(),
      updated_at=now()
  where id=p_listing_id
  returning * into v_listing;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'property_management_mode_changed','listing',p_listing_id::text,
    jsonb_build_object(
      'management_mode',v_listing.management_mode,
      'wehouse_management_status',v_listing.wehouse_management_status,
      'management_host_user_id',v_listing.management_host_user_id
    )::text,now());

  return public.get_my_property_management(p_listing_id);
end
$$;
revoke all on function public.set_my_property_management_mode(uuid,text) from public,anon;
grant execute on function public.set_my_property_management_mode(uuid,text) to authenticated,service_role;

create or replace function public.invite_property_host_manager(
  p_listing_id uuid,p_username text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_target public.profiles;
  v_listing public.listings;
  v_assignment public.property_host_assignments;
begin
  select l.* into v_listing
  from public.listings l
  where l.id=p_listing_id
    and l.deleted_at is null
    and exists(
      select 1 from public.property_host_assignments a
      where a.listing_id=l.id
        and a.user_id=v_actor
        and a.assignment_role='owner'
        and a.status='active'
    )
  for update;

  if v_listing.id is null then
    raise exception 'Only the property owner can invite a co-host';
  end if;

  if v_listing.approved_at is null
     or v_listing.status not in ('available','unavailable','reserved','occupied','maintenance','closed') then
    raise exception 'Co-hosts can be added after this home is published';
  end if;

  if v_listing.management_updated_at is null or v_listing.management_mode<>'host' then
    raise exception 'Choose Host manages before inviting a co-host';
  end if;

  select * into v_target
  from public.profiles
  where lower(username)=lower(btrim(p_username))
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;

  if v_target.user_id is null or v_target.user_id=v_actor then
    raise exception 'Choose another existing WeHouse user';
  end if;

  if not public.user_has_active_workspace(v_target.user_id,'property_partner') then
    raise exception 'That user must activate a Property Partner workspace first';
  end if;

  insert into public.property_host_assignments(
    listing_id,user_id,assignment_role,status,invited_by,invited_at,accepted_at,revoked_at,updated_at
  ) values(
    p_listing_id,v_target.user_id,'manager','invited',v_actor,now(),null,null,now()
  )
  on conflict(listing_id,user_id) do update set
    assignment_role='manager',
    status='invited',
    invited_by=v_actor,
    invited_at=now(),
    accepted_at=null,
    revoked_at=null,
    updated_at=now()
  returning * into v_assignment;

  return jsonb_build_object(
    'success',true,
    'assignment_id',v_assignment.assignment_id,
    'user_id',v_target.user_id,
    'username',v_target.username,
    'status',v_assignment.status
  );
end
$$;
revoke all on function public.invite_property_host_manager(uuid,text) from public,anon;
grant execute on function public.invite_property_host_manager(uuid,text) to authenticated,service_role;

create or replace function public.review_wehouse_property_management(
  p_listing_id uuid,p_approve boolean,p_reason text default null
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if not (
    public.current_actor_has_workspace('creator',null)
    or public.current_actor_has_workspace('admin',null)
    or (public.current_actor_has_workspace('staff',null) and public.current_staff_has_permission('operations'))
  ) then
    raise exception 'Property Operations authority required';
  end if;

  select * into v_listing
  from public.listings
  where id=p_listing_id and deleted_at is null
  for update;

  if v_listing.id is null
     or v_listing.management_updated_at is null
     or v_listing.management_mode<>'wehouse'
     or v_listing.wehouse_management_status<>'requested' then
    raise exception 'WeHouse management was not requested for this property';
  end if;

  if v_listing.approved_at is null
     or v_listing.status not in ('available','unavailable','reserved','occupied','maintenance','closed') then
    raise exception 'Property management starts after publication';
  end if;

  if not public.current_actor_in_scope(v_listing.state,v_listing.city) then
    raise exception 'Property is outside your authority';
  end if;

  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set wehouse_management_status=case when p_approve then 'approved' else 'declined' end,
      management_updated_at=now(),
      updated_at=now()
  where id=p_listing_id
  returning * into v_listing;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'wehouse_property_management_review','listing',p_listing_id::text,
    jsonb_build_object(
      'approved',p_approve,
      'reason',nullif(btrim(coalesce(p_reason,'')),'')
    )::text,now());

  return jsonb_build_object(
    'success',true,
    'management_mode',v_listing.management_mode,
    'wehouse_management_status',v_listing.wehouse_management_status
  );
end
$$;
revoke all on function public.review_wehouse_property_management(uuid,boolean,text) from public,anon;
grant execute on function public.review_wehouse_property_management(uuid,boolean,text) to authenticated,service_role;

comment on function public.set_my_property_management_mode(uuid,text)
is 'Owner-only post-publication operating choice. It does not alter submission, Field Operations evidence, inspection or listing approval.';
