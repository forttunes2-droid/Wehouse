-- Runtime repair after the PR #72 compatibility extraction: use the locked
-- Front Desk label end-to-end, preserve invitation decline, and expose explicit
-- pause/revoke controls for a hotel's optional PMS connection.

alter table public.hotel_team_members
  drop constraint if exists hotel_team_members_status_check;
alter table public.hotel_team_members
  add constraint hotel_team_members_status_check
  check(status in('invited','active','declined','revoked'));

create or replace function public.owner_invite_hotel_team_member(
  p_hotel_id integer,p_identifier text,p_role text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_owner public.profiles;
  v_member public.profiles;
  v_membership public.hotel_team_members;
  v_identifier text;
  v_role text:=case when p_role='staff' then 'front_desk' else p_role end;
begin
  select * into v_owner from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_owner.user_id is null or not exists(
    select 1 from public.hotels
    where hotel_id=p_hotel_id and owner_id=v_owner.user_id
  ) then raise exception 'Hotel owner access required'; end if;
  if v_role not in('manager','front_desk') then
    raise exception 'Choose Manager or Front Desk'; end if;
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
  if v_member.user_id=v_owner.user_id then
    raise exception 'The hotel owner already has full access'; end if;
  if exists(select 1 from public.hotel_team_members
    where hotel_id=p_hotel_id and member_user_id=v_member.user_id
      and status='active') then
    raise exception 'This person already has hotel access'; end if;
  insert into public.hotel_team_members(
    hotel_id,member_user_id,hotel_role,status,invited_by,capabilities,
    updated_at,revoked_at,responded_at
  ) values(
    p_hotel_id,v_member.user_id,v_role,'invited',v_owner.user_id,
    public.hotel_default_capabilities(v_role),now(),null,null
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

revoke all on function public.owner_invite_hotel_team_member(integer,text,text)
from public,anon;
grant execute on function public.owner_invite_hotel_team_member(integer,text,text)
to authenticated,service_role;

create or replace function public.owner_set_hotel_integration_status(
  p_integration_id uuid,p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_row public.hotel_integrations;
begin
  if p_status not in('active','paused','revoked') then
    raise exception 'Choose active, paused or revoked'; end if;
  select * into v_row from public.hotel_integrations
  where integration_id=p_integration_id for update;
  if v_row.integration_id is null or not public.hotel_actor_has_capability(
    v_row.hotel_id,'hotel.integration.manage'
  ) then raise exception 'Hotel integration management access required'; end if;
  if v_row.status='revoked' and p_status<>'revoked' then
    raise exception 'A revoked integration cannot be reactivated'; end if;
  update public.hotel_integrations set
    status=p_status,
    revoked_at=case when p_status='revoked' then now() else revoked_at end,
    updated_at=now()
  where integration_id=p_integration_id returning * into v_row;
  insert into public.audit_logs(
    id,admin_id,admin_email,action,target_type,target_id,details,created_at
  ) select
    gen_random_uuid()::text,p.user_id,p.email,
    'HOTEL_PMS_INTEGRATION_'||upper(p_status),'hotel_integration',
    v_row.integration_id::text,
    jsonb_build_object('hotel_id',v_row.hotel_id,'status',v_row.status)::text,now()
  from public.profiles p where p.auth_id=(select auth.uid())::text;
  return to_jsonb(v_row)-'token_hash';
end
$$;

revoke all on function public.owner_set_hotel_integration_status(uuid,text)
from public,anon;
grant execute on function public.owner_set_hotel_integration_status(uuid,text)
to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  'approved_client_rpc','Hotel owner or effective capability is enforced in the function',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'owner_invite_hotel_team_member','owner_set_hotel_integration_status'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,
  captured_at=excluded.captured_at;
