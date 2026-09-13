-- Make hotel.team.manage meaningful without allowing delegated escalation.
-- The hotel owner may grant any valid hotel capability. A delegated team
-- manager may manage only other memberships whose permissions are a subset of
-- their own, and may never change or revoke their own membership.

create or replace function public.owner_invite_hotel_team_member(
  p_hotel_id integer,p_identifier text,p_role text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_member public.profiles;
  v_membership public.hotel_team_members;
  v_identifier text;
  v_role text:=case when p_role='staff' then 'front_desk' else p_role end;
  v_is_owner boolean:=false;
  v_actor_caps text[]:=array[]::text[];
  v_default_caps text[];
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active Personal account required'; end if;
  select h.owner_id=v_actor.user_id into v_is_owner
  from public.hotels h where h.hotel_id=p_hotel_id;
  if v_is_owner is null then raise exception 'Hotel not found'; end if;
  if not v_is_owner then
    select tm.capabilities into v_actor_caps
    from public.hotel_team_members tm
    where tm.hotel_id=p_hotel_id and tm.member_user_id=v_actor.user_id
      and tm.status='active' limit 1;
    if not coalesce('hotel.team.manage'=any(v_actor_caps),false) then
      raise exception 'Hotel team management access required'; end if;
  end if;
  if v_role not in('manager','front_desk') then
    raise exception 'Choose Manager or Front Desk'; end if;
  v_default_caps:=public.hotel_default_capabilities(v_role);
  if not v_is_owner and not(v_default_caps<@v_actor_caps) then
    raise exception 'You cannot grant permissions outside your own hotel access';
  end if;
  v_identifier:=btrim(regexp_replace(coalesce(p_identifier,''),'^@','','g'));
  if v_identifier='' then raise exception 'Enter a WeHouse username or user ID'; end if;
  select * into v_member from public.profiles
  where (lower(username)=lower(v_identifier) or user_id=v_identifier)
    and account_kind='consumer'
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false)
  order by case when user_id=v_identifier then 0 else 1 end limit 1;
  if v_member.user_id is null then
    raise exception 'No active Personal WeHouse account matches that username or user ID';
  end if;
  if v_member.user_id=v_actor.user_id then
    raise exception 'You cannot invite or change your own hotel access'; end if;
  if exists(select 1 from public.hotel_team_members
    where hotel_id=p_hotel_id and member_user_id=v_member.user_id
      and status='active') then
    raise exception 'This person already has hotel access'; end if;
  insert into public.hotel_team_members(
    hotel_id,member_user_id,hotel_role,status,invited_by,capabilities,
    updated_at,revoked_at,responded_at
  ) values(
    p_hotel_id,v_member.user_id,v_role,'invited',v_actor.user_id,
    v_default_caps,now(),null,null
  ) on conflict(hotel_id,member_user_id) do update set
    hotel_role=excluded.hotel_role,status='invited',invited_by=excluded.invited_by,
    capabilities=excluded.capabilities,updated_at=now(),revoked_at=null,
    responded_at=null
  returning * into v_membership;
  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope
  ) select
    v_member.user_id,'hotel_team_invitation','Hotel team invitation',
    'You were invited to join '||h.name||' as '
      ||case when v_role='manager' then 'Manager' else 'Front Desk' end||'.',
    v_membership.id::text,'hotel_team_invitation',v_membership.id::text,
    'notifications',jsonb_build_object(
      'membership_id',v_membership.id,'hotel_id',p_hotel_id
    ),'hotel-team-invite:'||v_membership.id::text||':'
      ||extract(epoch from v_membership.updated_at)::bigint,'personal'
  from public.hotels h where h.hotel_id=p_hotel_id;
  return jsonb_build_object(
    'id',v_membership.id,'name',coalesce(v_member.full_name,v_member.username,'WeHouse member'),
    'username',v_member.username,'user_id',v_member.user_id,
    'hotel_role',v_membership.hotel_role,'status',v_membership.status,
    'capabilities',to_jsonb(v_membership.capabilities)
  );
end
$$;

create or replace function public.owner_set_hotel_team_capabilities(
  p_membership_id uuid,p_capabilities text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_row public.hotel_team_members;
  v_owner_id text;
  v_actor_caps text[]:=array[]::text[];
  v_caps text[]:=coalesce(p_capabilities,array[]::text[]);
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active Personal account required'; end if;
  select tm.* into v_row from public.hotel_team_members tm
  where tm.id=p_membership_id for update;
  if v_row.id is null then raise exception 'Hotel membership not found'; end if;
  select h.owner_id into v_owner_id from public.hotels h
  where h.hotel_id=v_row.hotel_id;
  if not public.hotel_capabilities_valid(v_caps) then
    raise exception 'Unsupported hotel capability'; end if;
  if v_owner_id<>v_actor.user_id then
    select tm.capabilities into v_actor_caps
    from public.hotel_team_members tm
    where tm.hotel_id=v_row.hotel_id and tm.member_user_id=v_actor.user_id
      and tm.status='active' limit 1;
    if not coalesce('hotel.team.manage'=any(v_actor_caps),false) then
      raise exception 'Hotel team management access required'; end if;
    if v_row.member_user_id=v_actor.user_id then
      raise exception 'Delegated managers cannot change their own permissions'; end if;
    if not(v_row.capabilities<@v_actor_caps) or not(v_caps<@v_actor_caps) then
      raise exception 'You cannot manage permissions outside your own hotel access';
    end if;
  end if;
  update public.hotel_team_members set capabilities=v_caps,updated_at=now()
  where id=v_row.id returning * into v_row;
  return jsonb_build_object(
    'id',v_row.id,'hotel_id',v_row.hotel_id,'hotel_role',v_row.hotel_role,
    'status',v_row.status,'capabilities',to_jsonb(v_row.capabilities)
  );
end
$$;

create or replace function public.owner_revoke_hotel_team_member(
  p_membership_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_row public.hotel_team_members;
  v_owner_id text;
  v_actor_caps text[]:=array[]::text[];
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active Personal account required'; end if;
  select tm.* into v_row from public.hotel_team_members tm
  where tm.id=p_membership_id for update;
  if v_row.id is null then raise exception 'Hotel membership not found'; end if;
  select h.owner_id into v_owner_id from public.hotels h
  where h.hotel_id=v_row.hotel_id;
  if v_owner_id<>v_actor.user_id then
    select tm.capabilities into v_actor_caps
    from public.hotel_team_members tm
    where tm.hotel_id=v_row.hotel_id and tm.member_user_id=v_actor.user_id
      and tm.status='active' limit 1;
    if not coalesce('hotel.team.manage'=any(v_actor_caps),false) then
      raise exception 'Hotel team management access required'; end if;
    if v_row.member_user_id=v_actor.user_id then
      raise exception 'Delegated managers cannot revoke their own access'; end if;
    if not(v_row.capabilities<@v_actor_caps) then
      raise exception 'You cannot revoke a membership above your own hotel access';
    end if;
  end if;
  update public.hotel_team_members set status='revoked',revoked_at=now(),
    updated_at=now() where id=v_row.id;
  return true;
end
$$;

revoke all on function public.owner_invite_hotel_team_member(integer,text,text)
from public,anon;
revoke all on function public.owner_set_hotel_team_capabilities(uuid,text[])
from public,anon;
revoke all on function public.owner_revoke_hotel_team_member(uuid)
from public,anon;
grant execute on function public.owner_invite_hotel_team_member(integer,text,text)
to authenticated,service_role;
grant execute on function public.owner_set_hotel_team_capabilities(uuid,text[])
to authenticated,service_role;
grant execute on function public.owner_revoke_hotel_team_member(uuid)
to authenticated,service_role;

-- Trigger functions and abandoned maintenance/ID helpers are implementation
-- details, not PostgREST endpoints.
do $$
declare v_proc record;
begin
  for v_proc in
    select p.oid::regprocedure::text signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prorettype='trigger'::regtype
  loop
    execute format('revoke all on function %s from public,anon,authenticated',v_proc.signature);
  end loop;
end
$$;

revoke all on function public.expire_old_searches() from public,anon,authenticated;
revoke all on function public.generate_user_id() from public,anon,authenticated;
revoke all on function public.generate_user_id_simple() from public,anon,authenticated;
revoke all on function public.increment_unread(integer,varchar) from public,anon,authenticated;
revoke all on function public.lga_booking_prefix(text) from public,anon,authenticated;
grant execute on function public.expire_old_searches() to service_role;

update public.function_execution_registry r set
  public_allowed=has_function_privilege('public',p.oid,'execute'),
  anon_allowed=has_function_privilege('anon',p.oid,'execute'),
  authenticated_allowed=has_function_privilege('authenticated',p.oid,'execute'),
  service_role_allowed=has_function_privilege('service_role',p.oid,'execute'),
  review_state=case
    when p.prorettype='trigger'::regtype then 'approved_service_only'
    when p.proname in('expire_old_searches','generate_user_id','generate_user_id_simple','increment_unread','lga_booking_prefix') then 'approved_service_only'
    else 'approved_client_rpc' end,
  rationale=case
    when p.prorettype='trigger'::regtype then 'Trigger-only implementation; no direct API execution'
    when p.proname in('expire_old_searches','generate_user_id','generate_user_id_simple','increment_unread','lga_booking_prefix') then 'Internal legacy helper; no direct client execution'
    else 'Hotel-scoped capability RPC with active Personal identity checks' end,
  captured_at=now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where r.function_signature=p.oid::regprocedure::text
  and n.nspname='public'
  and (
    p.prorettype='trigger'::regtype or p.proname in(
      'expire_old_searches','generate_user_id','generate_user_id_simple',
      'increment_unread','lga_booking_prefix','get_my_hotel_capabilities',
      'owner_invite_hotel_team_member','owner_set_hotel_team_capabilities',
      'owner_revoke_hotel_team_member','owner_create_hotel_integration',
      'owner_rotate_hotel_integration','get_my_hotel_integrations',
      'owner_set_hotel_integration_status'
    )
  );
