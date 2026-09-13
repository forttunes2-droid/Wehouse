-- Property access evidence should survive a realistic on-site submission session.
-- Validate before transferring media so an expired code cannot waste a mobile upload.
create or replace function public.create_my_property_access_challenge()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_actor public.profiles; v_row public.property_access_challenges; v_code text;
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  if not public.account_identity_is_current(v_actor.user_id) then raise exception 'Complete the private identity check before adding properties'; end if;
  v_code:=lpad(((('x'||substr(encode(extensions.gen_random_bytes(4),'hex'),1,8))::bit(32)::bigint % 1000000))::text,6,'0');
  insert into public.property_access_challenges(partner_id,code,expires_at)
  values(v_actor.user_id,v_code,now()+interval '24 hours') returning * into v_row;
  return jsonb_build_object('id',v_row.id,'code',v_row.code,'expires_at',v_row.expires_at);
end;
$$;

create or replace function public.create_my_property_access_correction(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_actor public.profiles; v_request public.inspection_requests;
  v_challenge public.property_access_challenges; v_code text;
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text
    and role='property_partner' and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  select * into v_request from public.inspection_requests
    where id=p_request_id and owner_id=v_actor.user_id for update;
  if v_request.id is null then raise exception 'Property submission not found'; end if;
  if v_request.published_at is not null or v_request.lifecycle_stage='live'
    then raise exception 'A public property does not require new access evidence'; end if;
  if v_request.lifecycle_stage='rejected' or lower(coalesce(v_request.status,''))='rejected'
    then raise exception 'This submission was stopped. Contact WeHouse from Inbox'; end if;
  if v_request.access_evidence_status<>'rejected'
    then raise exception 'WeHouse has not requested replacement access evidence'; end if;
  if coalesce(v_request.assigned_field_officer_id,v_request.field_officer_id,v_request.assigned_to) is not null
    then raise exception 'Access evidence cannot be replaced after a Field Officer is assigned'; end if;

  update public.property_access_challenges set status='expired'
    where partner_id=v_actor.user_id and request_id=p_request_id and status='prepared';
  v_code:=lpad(((('x'||substr(encode(extensions.gen_random_bytes(4),'hex'),1,8))::bit(32)::bigint % 1000000))::text,6,'0');
  insert into public.property_access_challenges(partner_id,code,expires_at,request_id)
  values(v_actor.user_id,v_code,now()+interval '24 hours',p_request_id)
  returning * into v_challenge;
  return jsonb_build_object('id',v_challenge.id,'code',v_challenge.code,'expires_at',v_challenge.expires_at);
end;
$$;

create or replace function public.validate_my_property_access_challenge(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_actor public.profiles; v_row public.property_access_challenges; v_valid boolean;
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  select * into v_row from public.property_access_challenges
    where id=p_challenge_id and partner_id=v_actor.user_id for update;
  if v_row.id is null then raise exception 'Property access challenge not found'; end if;
  v_valid := v_row.status in ('prepared','submitted') and v_row.expires_at>now();
  if not v_valid and v_row.status='prepared' then
    update public.property_access_challenges set status='expired' where id=v_row.id;
  end if;
  return jsonb_build_object('valid',v_valid,'status',case when v_valid then v_row.status else 'expired' end,'expires_at',v_row.expires_at);
end;
$$;

revoke all on function public.validate_my_property_access_challenge(uuid) from public, anon;
grant execute on function public.validate_my_property_access_challenge(uuid) to authenticated, service_role;

update public.property_access_challenges
set expires_at=created_at+interval '24 hours'
where status='prepared' and expires_at<created_at+interval '24 hours';

-- Hotel access is an invitation. It grants no capability until the recipient accepts.
alter table public.hotel_team_members add column if not exists responded_at timestamptz;
alter table public.hotel_team_members drop constraint if exists hotel_team_members_status_check;
alter table public.hotel_team_members add constraint hotel_team_members_status_check
  check (status in ('invited','active','declined','revoked'));

create or replace function public.owner_invite_hotel_team_member(
  p_hotel_id integer,
  p_identifier text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_owner public.profiles; v_member public.profiles; v_membership public.hotel_team_members; v_identifier text;
begin
  select * into v_owner from public.profiles where auth_id=(select auth.uid())::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_owner is null or not exists(select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_owner.user_id)
    then raise exception 'Hotel owner access required'; end if;
  if p_role not in('manager','staff') then raise exception 'Choose Manager or Front desk'; end if;
  v_identifier:=btrim(regexp_replace(coalesce(p_identifier,''),'^@','','g'));
  if v_identifier='' then raise exception 'Enter a WeHouse username or user ID'; end if;
  select * into v_member from public.profiles
    where (lower(username)=lower(v_identifier) or user_id=v_identifier)
      and account_kind='consumer'
      and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
    order by case when user_id=v_identifier then 0 else 1 end limit 1;
  if v_member is null then raise exception 'No active personal WeHouse account matches that username or user ID'; end if;
  if v_member.user_id=v_owner.user_id then raise exception 'The hotel owner already has full access'; end if;
  if exists(select 1 from public.hotel_team_members where hotel_id=p_hotel_id and member_user_id=v_member.user_id and status='active')
    then raise exception 'This person already has hotel access'; end if;

  insert into public.hotel_team_members(hotel_id,member_user_id,hotel_role,status,invited_by,updated_at,revoked_at,responded_at)
  values(p_hotel_id,v_member.user_id,p_role,'invited',v_owner.user_id,now(),null,null)
  on conflict(hotel_id,member_user_id) do update set hotel_role=excluded.hotel_role,status='invited',
    invited_by=excluded.invited_by,updated_at=now(),revoked_at=null,responded_at=null
  returning * into v_membership;

  insert into public.notifications(recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope)
  select v_member.user_id,'hotel_team_invitation','Hotel team invitation',
    'You were invited to join '||h.name||' as '||case when p_role='manager' then 'Manager' else 'Front desk' end||'.',
    v_membership.id::text,'hotel_team_invitation',v_membership.id::text,'notifications',
    jsonb_build_object('membership_id',v_membership.id,'hotel_id',p_hotel_id),
    'hotel-team-invite:'||v_membership.id::text||':'||extract(epoch from v_membership.updated_at)::bigint,'personal'
  from public.hotels h where h.hotel_id=p_hotel_id;

  return jsonb_build_object('id',v_membership.id,'name',coalesce(v_member.full_name,v_member.username,'WeHouse member'),
    'username',v_member.username,'user_id',v_member.user_id,'hotel_role',v_membership.hotel_role,'status',v_membership.status);
end;
$$;

create or replace function public.get_my_hotel_team(p_hotel_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_user text; v_result jsonb;
begin
  select user_id into v_user from public.profiles where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
  if not exists(select 1 from public.hotels where hotel_id=p_hotel_id and owner_id=v_user)
    then raise exception 'Hotel owner access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',tm.id,'member_user_id',tm.member_user_id,
    'hotel_role',tm.hotel_role,'status',tm.status,'name',coalesce(p.full_name,p.username,'Team member'),
    'username',p.username,'updated_at',tm.updated_at) order by case when tm.status='invited' then 0 else 1 end,tm.created_at),'[]'::jsonb)
  into v_result from public.hotel_team_members tm join public.profiles p on p.user_id=tm.member_user_id
  where tm.hotel_id=p_hotel_id and tm.status in ('invited','active');
  return v_result;
end;
$$;

create or replace function public.get_my_hotel_team_invitations()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',tm.id,'hotel_id',h.hotel_id,'hotel_name',h.name,'hotel_image',h.images[1],
    'hotel_role',tm.hotel_role,'inviter_name',coalesce(owner.full_name,owner.username,'Hotel owner'),
    'created_at',tm.created_at
  ) order by tm.created_at desc),'[]'::jsonb)
  from public.profiles me
  join public.hotel_team_members tm on tm.member_user_id=me.user_id and tm.status='invited'
  join public.hotels h on h.hotel_id=tm.hotel_id
  left join public.profiles owner on owner.user_id=tm.invited_by
  where me.auth_id=(select auth.uid())::text and not coalesce(me.deleted,false)
    and not coalesce(me.suspended,false) and not coalesce(me.banned,false);
$$;

create or replace function public.respond_to_hotel_team_invitation(p_membership_id uuid,p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_actor public.profiles; v_row public.hotel_team_members; v_hotel public.hotels;
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text and account_kind='consumer'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active personal WeHouse account required'; end if;
  select * into v_row from public.hotel_team_members where id=p_membership_id and member_user_id=v_actor.user_id for update;
  if v_row.id is null then raise exception 'Hotel invitation not found'; end if;
  if v_row.status<>'invited' then raise exception 'This hotel invitation is no longer pending'; end if;
  update public.hotel_team_members set status=case when p_accept then 'active' else 'declined' end,
    responded_at=now(),updated_at=now(),revoked_at=null where id=v_row.id returning * into v_row;
  select * into v_hotel from public.hotels where hotel_id=v_row.hotel_id;
  insert into public.notifications(recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key,workspace_scope)
  values(v_row.invited_by,'hotel_team_invitation_response',
    case when p_accept then 'Hotel invitation accepted' else 'Hotel invitation declined' end,
    coalesce(v_actor.full_name,v_actor.username,'A WeHouse member')||case when p_accept then ' accepted ' else ' declined ' end||coalesce(v_hotel.name,'the hotel')||'.',
    v_row.id::text,'hotel_team_member',v_row.id::text,'property-owner',jsonb_build_object('hotel_id',v_row.hotel_id),
    'hotel-team-response:'||v_row.id::text||':'||case when p_accept then 'accepted' else 'declined' end,'property_partner');
  return jsonb_build_object('id',v_row.id,'accepted',p_accept,'hotel_id',v_row.hotel_id,'hotel_role',v_row.hotel_role);
end;
$$;

create or replace function public.owner_revoke_hotel_team_member(p_membership_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_owner public.profiles; v_row public.hotel_team_members;
begin
  select * into v_owner from public.profiles where auth_id=(select auth.uid())::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  select tm.* into v_row from public.hotel_team_members tm join public.hotels h on h.hotel_id=tm.hotel_id
    where tm.id=p_membership_id and h.owner_id=v_owner.user_id for update;
  if v_row.id is null then raise exception 'Hotel owner access required'; end if;
  update public.hotel_team_members set status='revoked',revoked_at=now(),updated_at=now() where id=v_row.id;
  return true;
end;
$$;

revoke all on function public.owner_invite_hotel_team_member(integer,text,text) from public, anon;
revoke all on function public.get_my_hotel_team_invitations() from public, anon;
revoke all on function public.respond_to_hotel_team_invitation(uuid,boolean) from public, anon;
revoke all on function public.owner_revoke_hotel_team_member(uuid) from public, anon;
grant execute on function public.owner_invite_hotel_team_member(integer,text,text) to authenticated, service_role;
grant execute on function public.get_my_hotel_team_invitations() to authenticated, service_role;
grant execute on function public.respond_to_hotel_team_invitation(uuid,boolean) to authenticated, service_role;
grant execute on function public.owner_revoke_hotel_team_member(uuid) to authenticated, service_role;

-- Do not leave the unsafe direct-grant endpoint callable by application users.
revoke execute on function public.owner_set_hotel_team_member(integer,text,text,boolean) from authenticated;
