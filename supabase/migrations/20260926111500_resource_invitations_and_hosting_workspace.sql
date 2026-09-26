-- Structural invitations and delegated Hosting workspace.
-- Public property sharing remains read-only and is intentionally unrelated.

alter table public.property_host_assignments
  add column if not exists access_level text not null default 'full_hosting';

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='property_host_assignments_access_level_check'
      and conrelid='public.property_host_assignments'::regclass
  ) then
    alter table public.property_host_assignments
      add constraint property_host_assignments_access_level_check
      check(access_level in ('operations','full_hosting'));
  end if;
end
$$;

-- Existing managers keep their current authority. New invitations explicitly choose
-- operations or full_hosting. Owners are always treated as full authority.
update public.property_host_assignments
set access_level='full_hosting'
where assignment_role='owner';

create table if not exists public.resource_invitations(
  invitation_id uuid primary key default gen_random_uuid(),
  resource_type text not null
    check(resource_type in ('property','hotel')),
  resource_id text not null,
  role_key text not null
    check(role_key in ('property_cohost','hotel_manager','hotel_front_desk')),
  permission_profile text not null,
  delivery text not null
    check(delivery in ('direct','link')),
  inviter_user_id text not null references public.profiles(user_id),
  intended_user_id text references public.profiles(user_id),
  token_hash text,
  status text not null default 'pending'
    check(status in ('pending','accepted','declined','revoked','expired')),
  subject_assignment_id uuid,
  expires_at timestamptz not null,
  accepted_user_id text references public.profiles(user_id),
  accepted_at timestamptz,
  responded_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(
    (delivery='direct' and intended_user_id is not null and token_hash is null)
    or
    (delivery='link' and intended_user_id is null and token_hash is not null)
  )
);

create index if not exists resource_invitations_recipient_status_idx
  on public.resource_invitations(intended_user_id,status,created_at desc);
create index if not exists resource_invitations_resource_status_idx
  on public.resource_invitations(resource_type,resource_id,status,created_at desc);
create index if not exists resource_invitations_token_hash_idx
  on public.resource_invitations(token_hash)
  where token_hash is not null;

alter table public.resource_invitations enable row level security;
revoke all on table public.resource_invitations from public,anon,authenticated;
grant all on table public.resource_invitations to service_role;

create or replace function public._invitation_token_hash(p_token text)
returns text
language sql
immutable
set search_path to 'pg_catalog','extensions'
as $$
  select encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
$$;
revoke all on function public._invitation_token_hash(text) from public,anon,authenticated;
grant execute on function public._invitation_token_hash(text) to service_role;

create or replace function public._resource_invitation_actor()
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;
  if not exists(
    select 1 from public.profiles p
    where p.user_id=v_actor
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
  ) then raise exception 'Active Personal account required'; end if;
  return v_actor;
end
$$;
revoke all on function public._resource_invitation_actor() from public,anon,authenticated;
grant execute on function public._resource_invitation_actor() to service_role;

create or replace function public.create_property_cohost_invitation(
  p_listing_id uuid,
  p_identifier text default null,
  p_delivery text default 'direct',
  p_access_level text default 'operations'
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_target public.profiles;
  v_assignment public.property_host_assignments;
  v_invite public.resource_invitations;
  v_token text;
  v_identifier text:=btrim(regexp_replace(coalesce(p_identifier,''),'^@','','g'));
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;
  if p_delivery not in ('direct','link') then raise exception 'Choose direct or link invitation'; end if;
  if p_access_level not in ('operations','full_hosting') then
    raise exception 'Choose Operations or Full hosting access';
  end if;

  select l.* into v_listing
  from public.listings l
  join public.property_host_assignments owner_assignment
    on owner_assignment.listing_id=l.id
   and owner_assignment.user_id=v_actor
   and owner_assignment.assignment_role='owner'
   and owner_assignment.status='active'
  where l.id=p_listing_id and l.deleted_at is null
  for update;

  if v_listing.id is null then raise exception 'Only the property owner can invite a co-host'; end if;
  if v_listing.approved_at is null
     or v_listing.status not in ('available','unavailable','reserved','occupied','maintenance','closed') then
    raise exception 'Co-hosts can be invited after this home is published';
  end if;
  if v_listing.management_updated_at is null or v_listing.management_mode<>'host' then
    raise exception 'Choose Host manages before inviting a co-host';
  end if;

  if p_delivery='direct' then
    if v_identifier='' then raise exception 'Enter a WeHouse username or user ID'; end if;
    select * into v_target
    from public.profiles
    where (lower(username)=lower(v_identifier) or user_id=v_identifier)
      and not coalesce(deleted,false)
      and not coalesce(suspended,false)
      and not coalesce(banned,false)
    order by case when user_id=v_identifier then 0 else 1 end
    limit 1;

    if v_target.user_id is null then
      raise exception 'No active WeHouse account matches that username or user ID';
    end if;
    if v_target.user_id=v_actor then raise exception 'You already own this property'; end if;

    update public.resource_invitations
    set status='revoked',revoked_at=now(),updated_at=now()
    where resource_type='property'
      and resource_id=p_listing_id::text
      and intended_user_id=v_target.user_id
      and status='pending';

    insert into public.property_host_assignments(
      listing_id,user_id,assignment_role,status,invited_by,invited_at,
      accepted_at,revoked_at,updated_at,access_level
    ) values(
      p_listing_id,v_target.user_id,'manager','invited',v_actor,now(),
      null,null,now(),p_access_level
    )
    on conflict(listing_id,user_id) do update set
      assignment_role='manager',
      status='invited',
      invited_by=v_actor,
      invited_at=now(),
      accepted_at=null,
      revoked_at=null,
      updated_at=now(),
      access_level=excluded.access_level
    returning * into v_assignment;

    insert into public.resource_invitations(
      resource_type,resource_id,role_key,permission_profile,delivery,
      inviter_user_id,intended_user_id,status,subject_assignment_id,expires_at
    ) values(
      'property',p_listing_id::text,'property_cohost',p_access_level,'direct',
      v_actor,v_target.user_id,'pending',v_assignment.assignment_id,now()+interval '7 days'
    ) returning * into v_invite;

    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key,workspace_scope
    ) values(
      v_target.user_id,'resource_invitation','Co-host invitation',
      'You were invited to co-host '||coalesce(v_listing.title,'a property')||'.',
      v_invite.invitation_id::text,'resource_invitation',v_invite.invitation_id::text,
      'invitation',jsonb_build_object('invitation_id',v_invite.invitation_id),
      'resource-invite:'||v_invite.invitation_id::text,'personal'
    );

    return jsonb_build_object(
      'invitation_id',v_invite.invitation_id,
      'delivery','direct',
      'recipient_user_id',v_target.user_id,
      'recipient_name',coalesce(v_target.full_name,v_target.username,'WeHouse member'),
      'status','pending'
    );
  end if;

  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.resource_invitations(
    resource_type,resource_id,role_key,permission_profile,delivery,
    inviter_user_id,token_hash,status,expires_at
  ) values(
    'property',p_listing_id::text,'property_cohost',p_access_level,'link',
    v_actor,public._invitation_token_hash(v_token),'pending',now()+interval '7 days'
  ) returning * into v_invite;

  return jsonb_build_object(
    'invitation_id',v_invite.invitation_id,
    'delivery','link',
    'token',v_token,
    'expires_at',v_invite.expires_at,
    'status','pending'
  );
end
$$;

create or replace function public.create_hotel_team_invitation(
  p_hotel_id integer,
  p_role text,
  p_identifier text default null,
  p_delivery text default 'direct'
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_hotel public.hotels;
  v_target public.profiles;
  v_membership public.hotel_team_members;
  v_invite public.resource_invitations;
  v_token text;
  v_role text:=case when p_role='staff' then 'front_desk' else p_role end;
  v_identifier text:=btrim(regexp_replace(coalesce(p_identifier,''),'^@','','g'));
  v_caps text[];
  v_actor_caps text[];
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;
  if p_delivery not in ('direct','link') then raise exception 'Choose direct or link invitation'; end if;
  if v_role not in ('manager','front_desk') then raise exception 'Choose Manager or Front desk'; end if;

  select * into v_hotel from public.hotels where hotel_id=p_hotel_id for update;
  if v_hotel.hotel_id is null then raise exception 'Hotel not found'; end if;

  if v_hotel.owner_id<>v_actor then
    v_actor_caps:=public.current_actor_hotel_capabilities(p_hotel_id);
    if not coalesce('hotel.team.manage'=any(v_actor_caps),false) then
      raise exception 'Hotel team management access required';
    end if;
  end if;

  v_caps:=public.hotel_default_capabilities(v_role);
  if v_hotel.owner_id<>v_actor and not(v_caps<@v_actor_caps) then
    raise exception 'You cannot grant permissions outside your own hotel access';
  end if;

  if p_delivery='direct' then
    if v_identifier='' then raise exception 'Enter a WeHouse username or user ID'; end if;
    select * into v_target
    from public.profiles
    where (lower(username)=lower(v_identifier) or user_id=v_identifier)
      and not coalesce(deleted,false)
      and not coalesce(suspended,false)
      and not coalesce(banned,false)
    order by case when user_id=v_identifier then 0 else 1 end
    limit 1;

    if v_target.user_id is null then
      raise exception 'No active WeHouse account matches that username or user ID';
    end if;
    if v_target.user_id=v_actor then raise exception 'You cannot invite yourself'; end if;

    update public.resource_invitations
    set status='revoked',revoked_at=now(),updated_at=now()
    where resource_type='hotel'
      and resource_id=p_hotel_id::text
      and intended_user_id=v_target.user_id
      and status='pending';

    insert into public.hotel_team_members(
      hotel_id,member_user_id,hotel_role,status,invited_by,capabilities,
      updated_at,revoked_at,responded_at
    ) values(
      p_hotel_id,v_target.user_id,v_role,'invited',v_actor,v_caps,
      now(),null,null
    )
    on conflict(hotel_id,member_user_id) do update set
      hotel_role=excluded.hotel_role,
      status='invited',
      invited_by=v_actor,
      capabilities=excluded.capabilities,
      updated_at=now(),
      revoked_at=null,
      responded_at=null
    returning * into v_membership;

    insert into public.resource_invitations(
      resource_type,resource_id,role_key,permission_profile,delivery,
      inviter_user_id,intended_user_id,status,subject_assignment_id,expires_at
    ) values(
      'hotel',p_hotel_id::text,
      case when v_role='manager' then 'hotel_manager' else 'hotel_front_desk' end,
      v_role,'direct',v_actor,v_target.user_id,'pending',v_membership.id,
      now()+interval '7 days'
    ) returning * into v_invite;

    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key,workspace_scope
    ) values(
      v_target.user_id,'resource_invitation','Hotel team invitation',
      'You were invited to join '||coalesce(v_hotel.name,'a hotel')||' as '
        ||case when v_role='manager' then 'Manager' else 'Front desk' end||'.',
      v_invite.invitation_id::text,'resource_invitation',v_invite.invitation_id::text,
      'invitation',jsonb_build_object('invitation_id',v_invite.invitation_id),
      'resource-invite:'||v_invite.invitation_id::text,'personal'
    );

    return jsonb_build_object(
      'invitation_id',v_invite.invitation_id,
      'delivery','direct',
      'recipient_user_id',v_target.user_id,
      'recipient_name',coalesce(v_target.full_name,v_target.username,'WeHouse member'),
      'status','pending'
    );
  end if;

  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.resource_invitations(
    resource_type,resource_id,role_key,permission_profile,delivery,
    inviter_user_id,token_hash,status,expires_at
  ) values(
    'hotel',p_hotel_id::text,
    case when v_role='manager' then 'hotel_manager' else 'hotel_front_desk' end,
    v_role,'link',v_actor,public._invitation_token_hash(v_token),'pending',
    now()+interval '7 days'
  ) returning * into v_invite;

  return jsonb_build_object(
    'invitation_id',v_invite.invitation_id,
    'delivery','link',
    'token',v_token,
    'expires_at',v_invite.expires_at,
    'status','pending'
  );
end
$$;

create or replace function public.get_my_resource_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_invite public.resource_invitations;
  v_title text;
  v_image text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_invite
  from public.resource_invitations
  where invitation_id=p_invitation_id
    and (
      intended_user_id=v_actor
      or accepted_user_id=v_actor
      or inviter_user_id=v_actor
    );

  if v_invite.invitation_id is null then raise exception 'Invitation not found'; end if;

  if v_invite.resource_type='property' then
    select l.title,l.images[1] into v_title,v_image
    from public.listings l where l.id=v_invite.resource_id::uuid;
  else
    select h.name,h.images[1] into v_title,v_image
    from public.hotels h where h.hotel_id=v_invite.resource_id::integer;
  end if;

  return jsonb_build_object(
    'invitation_id',v_invite.invitation_id,
    'resource_type',v_invite.resource_type,
    'resource_id',v_invite.resource_id,
    'resource_title',coalesce(v_title,case when v_invite.resource_type='hotel' then 'Hotel' else 'Property' end),
    'resource_image',v_image,
    'role_key',v_invite.role_key,
    'permission_profile',v_invite.permission_profile,
    'delivery',v_invite.delivery,
    'status',case when v_invite.status='pending' and v_invite.expires_at<=now() then 'expired' else v_invite.status end,
    'expires_at',v_invite.expires_at,
    'inviter_user_id',v_invite.inviter_user_id,
    'inviter_name',(select coalesce(p.full_name,p.username,'WeHouse member') from public.profiles p where p.user_id=v_invite.inviter_user_id)
  );
end
$$;

create or replace function public.preview_resource_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_invite public.resource_invitations;
  v_title text;
  v_image text;
begin
  select * into v_invite
  from public.resource_invitations
  where delivery='link'
    and token_hash=public._invitation_token_hash(p_token)
    and status='pending'
    and expires_at>now()
  limit 1;

  if v_invite.invitation_id is null then
    return jsonb_build_object('valid',false);
  end if;

  if v_invite.resource_type='property' then
    select l.title,l.images[1] into v_title,v_image
    from public.listings l where l.id=v_invite.resource_id::uuid;
  else
    select h.name,h.images[1] into v_title,v_image
    from public.hotels h where h.hotel_id=v_invite.resource_id::integer;
  end if;

  return jsonb_build_object(
    'valid',true,
    'invitation_id',v_invite.invitation_id,
    'resource_type',v_invite.resource_type,
    'resource_title',coalesce(v_title,case when v_invite.resource_type='hotel' then 'Hotel' else 'Property' end),
    'resource_image',v_image,
    'role_key',v_invite.role_key,
    'permission_profile',v_invite.permission_profile,
    'expires_at',v_invite.expires_at,
    'inviter_name',(select coalesce(p.full_name,p.username,'WeHouse member') from public.profiles p where p.user_id=v_invite.inviter_user_id)
  );
end
$$;

create or replace function public.respond_to_resource_invitation(
  p_invitation_id uuid,
  p_accept boolean,
  p_token text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_invite public.resource_invitations;
  v_listing public.listings;
  v_hotel public.hotels;
  v_assignment public.property_host_assignments;
  v_membership public.hotel_team_members;
  v_role text;
  v_caps text[];
begin
  if v_actor is null then raise exception 'Sign in to respond to this invitation'; end if;

  select * into v_invite
  from public.resource_invitations
  where invitation_id=p_invitation_id
  for update;

  if v_invite.invitation_id is null then raise exception 'Invitation not found'; end if;
  if v_invite.status<>'pending' then raise exception 'This invitation is no longer pending'; end if;

  if v_invite.expires_at<=now() then
    update public.resource_invitations
    set status='expired',updated_at=now()
    where invitation_id=v_invite.invitation_id;
    raise exception 'This invitation has expired';
  end if;

  if v_invite.delivery='direct' then
    if v_invite.intended_user_id<>v_actor then raise exception 'This invitation belongs to another account'; end if;
  else
    if nullif(btrim(coalesce(p_token,'')),'') is null
       or v_invite.token_hash<>public._invitation_token_hash(p_token) then
      raise exception 'Invitation link is invalid';
    end if;
  end if;

  if p_accept then
    if v_invite.resource_type='property' then
      select * into v_listing
      from public.listings
      where id=v_invite.resource_id::uuid and deleted_at is null
      for update;

      if v_listing.id is null
         or v_listing.approved_at is null
         or v_listing.management_updated_at is null
         or v_listing.management_mode<>'host' then
        raise exception 'This property is not available for co-host access';
      end if;

      insert into public.property_host_assignments(
        listing_id,user_id,assignment_role,status,invited_by,invited_at,
        accepted_at,revoked_at,updated_at,access_level
      ) values(
        v_listing.id,v_actor,'manager','active',v_invite.inviter_user_id,
        v_invite.created_at,now(),null,now(),v_invite.permission_profile
      )
      on conflict(listing_id,user_id) do update set
        assignment_role='manager',
        status='active',
        invited_by=v_invite.inviter_user_id,
        accepted_at=now(),
        revoked_at=null,
        updated_at=now(),
        access_level=v_invite.permission_profile
      returning * into v_assignment;

      update public.resource_invitations
      set subject_assignment_id=v_assignment.assignment_id
      where invitation_id=v_invite.invitation_id;
    else
      select * into v_hotel
      from public.hotels
      where hotel_id=v_invite.resource_id::integer
      for update;
      if v_hotel.hotel_id is null then raise exception 'Hotel not found'; end if;

      v_role:=case when v_invite.role_key='hotel_manager' then 'manager' else 'front_desk' end;
      v_caps:=public.hotel_default_capabilities(v_role);

      insert into public.hotel_team_members(
        hotel_id,member_user_id,hotel_role,status,invited_by,capabilities,
        updated_at,revoked_at,responded_at
      ) values(
        v_hotel.hotel_id,v_actor,v_role,'active',v_invite.inviter_user_id,
        v_caps,now(),null,now()
      )
      on conflict(hotel_id,member_user_id) do update set
        hotel_role=excluded.hotel_role,
        status='active',
        invited_by=v_invite.inviter_user_id,
        capabilities=excluded.capabilities,
        updated_at=now(),
        revoked_at=null,
        responded_at=now()
      returning * into v_membership;

      update public.resource_invitations
      set subject_assignment_id=v_membership.id
      where invitation_id=v_invite.invitation_id;
    end if;
  else
    if v_invite.resource_type='property' and v_invite.subject_assignment_id is not null then
      update public.property_host_assignments
      set status='declined',revoked_at=now(),updated_at=now()
      where assignment_id=v_invite.subject_assignment_id
        and status='invited';
    elsif v_invite.resource_type='hotel' and v_invite.subject_assignment_id is not null then
      update public.hotel_team_members
      set status='declined',responded_at=now(),updated_at=now()
      where id=v_invite.subject_assignment_id
        and status='invited';
    end if;
  end if;

  update public.resource_invitations
  set status=case when p_accept then 'accepted' else 'declined' end,
      accepted_user_id=case when p_accept then v_actor else null end,
      accepted_at=case when p_accept then now() else null end,
      responded_at=now(),
      updated_at=now()
  where invitation_id=v_invite.invitation_id;

  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope
  ) values(
    v_invite.inviter_user_id,'resource_invitation_response',
    case when p_accept then 'Invitation accepted' else 'Invitation declined' end,
    (select coalesce(p.full_name,p.username,'A WeHouse member') from public.profiles p where p.user_id=v_actor)
      ||case when p_accept then ' accepted your invitation.' else ' declined your invitation.' end,
    v_invite.invitation_id::text,'resource_invitation',v_invite.invitation_id::text,
    case when v_invite.resource_type='hotel' then 'property-owner' else 'property_partner' end,
    jsonb_build_object('invitation_id',v_invite.invitation_id,'resource_type',v_invite.resource_type,'resource_id',v_invite.resource_id),
    'resource-invite-response:'||v_invite.invitation_id::text||':'||case when p_accept then 'accepted' else 'declined' end,
    'property_partner'
  );

  return jsonb_build_object(
    'invitation_id',v_invite.invitation_id,
    'accepted',p_accept,
    'resource_type',v_invite.resource_type,
    'resource_id',v_invite.resource_id
  );
end
$$;

create or replace function public.get_my_resource_invitations(
  p_resource_type text,p_resource_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_resource_type='property' then
    if not exists(
      select 1 from public.property_host_assignments a
      where a.listing_id=p_resource_id::uuid
        and a.user_id=v_actor
        and a.assignment_role='owner'
        and a.status='active'
    ) then raise exception 'Property owner access required'; end if;
  elsif p_resource_type='hotel' then
    if not exists(
      select 1 from public.hotels h where h.hotel_id=p_resource_id::integer and h.owner_id=v_actor
    ) and not coalesce('hotel.team.manage'=any(public.current_actor_hotel_capabilities(p_resource_id::integer)),false) then
      raise exception 'Hotel team management access required';
    end if;
  else raise exception 'Unsupported invitation resource'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'invitation_id',invite.invitation_id,
    'delivery',invite.delivery,
    'role_key',invite.role_key,
    'permission_profile',invite.permission_profile,
    'status',case when invite.status='pending' and invite.expires_at<=now() then 'expired' else invite.status end,
    'intended_user_id',invite.intended_user_id,
    'recipient_name',(select coalesce(p.full_name,p.username) from public.profiles p where p.user_id=invite.intended_user_id),
    'expires_at',invite.expires_at,
    'created_at',invite.created_at
  ) order by invite.created_at desc),'[]'::jsonb)
  into v_result
  from public.resource_invitations invite
  where invite.resource_type=p_resource_type
    and invite.resource_id=p_resource_id
    and invite.status in ('pending','accepted');

  return v_result;
end
$;

create or replace function public.revoke_resource_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $
declare
  v_actor text:=public.current_profile_user_id();
  v_invite public.resource_invitations;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_invite from public.resource_invitations
  where invitation_id=p_invitation_id for update;
  if v_invite.invitation_id is null then raise exception 'Invitation not found'; end if;
  if v_invite.status<>'pending' then raise exception 'Only a pending invitation can be revoked'; end if;

  if v_invite.resource_type='property' then
    if not exists(
      select 1 from public.property_host_assignments a
      where a.listing_id=v_invite.resource_id::uuid
        and a.user_id=v_actor
        and a.assignment_role='owner'
        and a.status='active'
    ) then raise exception 'Property owner access required'; end if;
  elsif v_invite.resource_type='hotel' then
    if not exists(select 1 from public.hotels h where h.hotel_id=v_invite.resource_id::integer and h.owner_id=v_actor)
       and not coalesce('hotel.team.manage'=any(public.current_actor_hotel_capabilities(v_invite.resource_id::integer)),false) then
      raise exception 'Hotel team management access required';
    end if;
  else raise exception 'Unsupported invitation resource'; end if;

  update public.resource_invitations
  set status='revoked',revoked_at=now(),updated_at=now()
  where invitation_id=v_invite.invitation_id;

  if v_invite.subject_assignment_id is not null and v_invite.resource_type='property' then
    update public.property_host_assignments
    set status='revoked',revoked_at=now(),updated_at=now()
    where assignment_id=v_invite.subject_assignment_id and status='invited';
  elsif v_invite.subject_assignment_id is not null and v_invite.resource_type='hotel' then
    update public.hotel_team_members
    set status='revoked',revoked_at=now(),updated_at=now()
    where id=v_invite.subject_assignment_id and status='invited';
  end if;

  if v_invite.intended_user_id is not null then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key,workspace_scope
    ) values(
      v_invite.intended_user_id,'resource_invitation_revoked','Invitation revoked',
      'This invitation is no longer available.',v_invite.invitation_id::text,
      'resource_invitation',v_invite.invitation_id::text,'invitation',
      jsonb_build_object('invitation_id',v_invite.invitation_id),
      'resource-invite-revoked:'||v_invite.invitation_id::text,'personal'
    );
  end if;
  return true;
end
$;

-- Preserve any invitations already pending when this migration lands.
insert into public.resource_invitations(
  resource_type,resource_id,role_key,permission_profile,delivery,
  inviter_user_id,intended_user_id,status,subject_assignment_id,expires_at,
  created_at,updated_at
)
select
  'property',assignment.listing_id::text,'property_cohost',assignment.access_level,'direct',
  assignment.invited_by,assignment.user_id,
  case when assignment.invited_at+interval '7 days'>now() then 'pending' else 'expired' end,
  assignment.assignment_id,assignment.invited_at+interval '7 days',
  assignment.invited_at,assignment.updated_at
from public.property_host_assignments assignment
where assignment.assignment_role='manager'
  and assignment.status='invited'
  and assignment.invited_by is not null
  and not exists(
    select 1 from public.resource_invitations invite
    where invite.resource_type='property'
      and invite.subject_assignment_id=assignment.assignment_id
  );

insert into public.resource_invitations(
  resource_type,resource_id,role_key,permission_profile,delivery,
  inviter_user_id,intended_user_id,status,subject_assignment_id,expires_at,
  created_at,updated_at
)
select
  'hotel',member.hotel_id::text,
  case when member.hotel_role='manager' then 'hotel_manager' else 'hotel_front_desk' end,
  case when member.hotel_role='manager' then 'manager' else 'front_desk' end,
  'direct',member.invited_by,member.member_user_id,
  case when member.created_at+interval '7 days'>now() then 'pending' else 'expired' end,
  member.id,member.created_at+interval '7 days',member.created_at,member.updated_at
from public.hotel_team_members member
where member.status='invited'
  and not exists(
    select 1 from public.resource_invitations invite
    where invite.resource_type='hotel'
      and invite.subject_assignment_id=member.id
  );

insert into public.notifications(
  recipient_id,type,title,message,related_id,source_type,source_id,
  destination_route,destination_params,event_key,workspace_scope
)
select
  invite.intended_user_id,
  'resource_invitation',
  case when invite.resource_type='hotel' then 'Hotel team invitation' else 'Co-host invitation' end,
  case when invite.resource_type='hotel'
    then 'You have a pending Hotel Team invitation.'
    else 'You have a pending co-host invitation.'
  end,
  invite.invitation_id::text,'resource_invitation',invite.invitation_id::text,
  'invitation',jsonb_build_object('invitation_id',invite.invitation_id),
  'resource-invite:'||invite.invitation_id::text,'personal'
from public.resource_invitations invite
where invite.delivery='direct'
  and invite.status='pending'
  and invite.intended_user_id is not null
  and not exists(
    select 1 from public.notifications notification
    where notification.event_key='resource-invite:'||invite.invitation_id::text
  );

create or replace function public.get_my_sent_resource_invitations(
  p_resource_type text,
  p_resource_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $
declare
  v_actor text:=public.current_profile_user_id();
  v_result jsonb;
  v_allowed boolean:=false;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_resource_type='property' then
    select exists(
      select 1 from public.property_host_assignments a
      where a.listing_id=p_resource_id::uuid
        and a.user_id=v_actor
        and a.assignment_role='owner'
        and a.status='active'
    ) into v_allowed;
  elsif p_resource_type='hotel' then
    select exists(
      select 1 from public.hotels h
      where h.hotel_id=p_resource_id::integer and h.owner_id=v_actor
    ) or coalesce('hotel.team.manage'=any(public.current_actor_hotel_capabilities(p_resource_id::integer)),false)
    into v_allowed;
  end if;
  if not v_allowed then raise exception 'Resource invitation management access required'; end if;

  update public.resource_invitations
  set status='expired',updated_at=now()
  where resource_type=p_resource_type
    and resource_id=p_resource_id
    and status='pending'
    and expires_at<=now();

  select coalesce(jsonb_agg(jsonb_build_object(
    'invitation_id',i.invitation_id,
    'resource_type',i.resource_type,
    'resource_id',i.resource_id,
    'role_key',i.role_key,
    'permission_profile',i.permission_profile,
    'delivery',i.delivery,
    'status',i.status,
    'recipient_user_id',i.intended_user_id,
    'recipient_name',case when i.intended_user_id is null then null else coalesce(p.full_name,p.username,'WeHouse member') end,
    'expires_at',i.expires_at,
    'created_at',i.created_at
  ) order by i.created_at desc),'[]'::jsonb)
  into v_result
  from public.resource_invitations i
  left join public.profiles p on p.user_id=i.intended_user_id
  where i.resource_type=p_resource_type
    and i.resource_id=p_resource_id
    and i.inviter_user_id=v_actor
    and i.status='pending';

  return v_result;
end
$;

create or replace function public.revoke_my_resource_invitation(
  p_invitation_id uuid
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $
declare
  v_actor text:=public.current_profile_user_id();
  v_invite public.resource_invitations;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select * into v_invite
  from public.resource_invitations
  where invitation_id=p_invitation_id
    and inviter_user_id=v_actor
    and status='pending'
  for update;

  if v_invite.invitation_id is null then
    raise exception 'Pending invitation not found';
  end if;

  update public.resource_invitations
  set status='revoked',revoked_at=now(),updated_at=now()
  where invitation_id=v_invite.invitation_id;

  if v_invite.subject_assignment_id is not null then
    if v_invite.resource_type='property' then
      update public.property_host_assignments
      set status='revoked',revoked_at=now(),updated_at=now()
      where assignment_id=v_invite.subject_assignment_id
        and status='invited';
    else
      update public.hotel_team_members
      set status='revoked',revoked_at=now(),updated_at=now()
      where id=v_invite.subject_assignment_id
        and status='invited';
    end if;
  end if;

  if v_invite.intended_user_id is not null then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key,workspace_scope
    ) values(
      v_invite.intended_user_id,'resource_invitation_revoked','Invitation withdrawn',
      'An access invitation sent to you is no longer available.',
      v_invite.invitation_id::text,'resource_invitation',v_invite.invitation_id::text,
      'notifications',jsonb_build_object('invitation_id',v_invite.invitation_id),
      'resource-invite-revoked:'||v_invite.invitation_id::text,'personal'
    );
  end if;

  return true;
end
$;

-- Direct legacy response functions remain for compatibility but no longer require
-- a Property Partner workspace. They only activate an invitation already bound
-- to the signed-in identity.
create or replace function public.respond_to_property_host_invite(
  p_assignment_id uuid,p_accept boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $
declare
  v_actor text:=public.current_profile_user_id();
  v_assignment public.property_host_assignments;
  v_invitation_id uuid;
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;

  select invitation_id into v_invitation_id
  from public.resource_invitations
  where resource_type='property'
    and subject_assignment_id=p_assignment_id
    and intended_user_id=v_actor
    and status='pending'
  order by created_at desc
  limit 1;

  if v_invitation_id is not null then
    return public.respond_to_resource_invitation(v_invitation_id,p_accept,null);
  end if;

  update public.property_host_assignments
  set status=case when p_accept then 'active' else 'declined' end,
      accepted_at=case when p_accept then now() else null end,
      revoked_at=case when p_accept then null else now() end,
      updated_at=now()
  where assignment_id=p_assignment_id and user_id=v_actor and status='invited'
  returning * into v_assignment;

  if v_assignment.assignment_id is null then raise exception 'Active invitation not found'; end if;
  return jsonb_build_object('success',true,'status',v_assignment.status,'listing_id',v_assignment.listing_id);
end
$;

create or replace function public.respond_to_hotel_team_invitation(
  p_membership_id uuid,p_accept boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $
declare
  v_actor text:=public.current_profile_user_id();
  v_invitation_id uuid;
  v_row public.hotel_team_members;
begin
  if v_actor is null then raise exception 'Active Personal account required'; end if;

  select invitation_id into v_invitation_id
  from public.resource_invitations
  where resource_type='hotel'
    and subject_assignment_id=p_membership_id
    and intended_user_id=v_actor
    and status='pending'
  order by created_at desc
  limit 1;

  if v_invitation_id is not null then
    return public.respond_to_resource_invitation(v_invitation_id,p_accept,null);
  end if;

  update public.hotel_team_members
  set status=case when p_accept then 'active' else 'declined' end,
      responded_at=now(),updated_at=now(),
      revoked_at=case when p_accept then null else now() end
  where id=p_membership_id and member_user_id=v_actor and status='invited'
  returning * into v_row;

  if v_row.id is null then raise exception 'Hotel invitation not found'; end if;
  return jsonb_build_object(
    'id',v_row.id,'accepted',p_accept,'hotel_id',v_row.hotel_id,
    'hotel_role',v_row.hotel_role,'capabilities',to_jsonb(v_row.capabilities)
  );
end
$;

-- A co-host is a delegated operator, not a Property Partner owner.
create or replace function public.current_actor_can_manage_property(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1
    from public.property_host_assignments a
    join public.profiles p on p.user_id=a.user_id
    join public.listings l on l.id=a.listing_id
    where a.listing_id=p_listing_id
      and a.user_id=public.current_profile_user_id()
      and a.status='active'
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        a.assignment_role='owner'
        or (
          a.assignment_role='manager'
          and (
            l.management_mode='host'
            or exists(
              select 1 from public.reservations r
              where (r.listing_id=l.id::text or r.listing_id=l.listing_id)
                and r.management_mode_snapshot='host'
                and r.responsible_host_user_id=a.user_id
                and r.status not in ('completed','cancelled','refunded','expired')
            )
          )
        )
      )
  )
$$;

create or replace function public.user_has_active_workspace(
  p_user_id text,p_workspace_role text
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select case
    when p_workspace_role='hosting' then exists(
      select 1
      from public.property_host_assignments a
      join public.profiles p on p.user_id=a.user_id
      join public.listings l on l.id=a.listing_id
      where a.user_id=p_user_id
        and a.assignment_role='manager'
        and a.status='active'
        and (
          l.management_mode='host'
          or exists(
            select 1 from public.reservations r
            where (r.listing_id=l.id::text or r.listing_id=l.listing_id)
              and r.management_mode_snapshot='host'
              and r.responsible_host_user_id=a.user_id
              and r.status not in ('completed','cancelled','refunded','expired')
          )
        )
        and not coalesce(p.deleted,false)
        and not coalesce(p.suspended,false)
        and not coalesce(p.banned,false)
    )
    else exists(
      select 1
      from public.profiles p
      join public.workspace_role_assignments w on w.user_id=p.user_id
      where p.user_id=p_user_id
        and w.workspace_role=p_workspace_role
        and w.status='active'
        and w.revoked_at is null
        and not coalesce(p.deleted,false)
        and not coalesce(p.suspended,false)
        and not coalesce(p.banned,false)
    )
  end
$$;

create or replace function public.current_actor_has_workspace(
  p_workspace text,p_state text default null
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select case
    when p_workspace='hosting' then exists(
      select 1
      from public.property_host_assignments a
      join public.listings l on l.id=a.listing_id
      join public.profiles p on p.user_id=a.user_id
      where a.user_id=public.current_profile_user_id()
        and a.assignment_role='manager'
        and a.status='active'
        and (
          l.management_mode='host'
          or exists(
            select 1 from public.reservations r
            where (r.listing_id=l.id::text or r.listing_id=l.listing_id)
              and r.management_mode_snapshot='host'
              and r.responsible_host_user_id=a.user_id
              and r.status not in ('completed','cancelled','refunded','expired')
          )
        )
        and not coalesce(p.deleted,false)
        and not coalesce(p.suspended,false)
        and not coalesce(p.banned,false)
        and (
          p_state is null
          or public.wehouse_state_key(l.state)=public.wehouse_state_key(p_state)
        )
    )
    else exists(
      select 1
      from public.profiles p
      join public.workspace_role_assignments w on w.user_id=p.user_id
      where p.auth_id=(select auth.uid())::text
        and w.workspace_role=p_workspace
        and w.status='active'
        and w.revoked_at is null
        and not coalesce(p.deleted,false)
        and not coalesce(p.suspended,false)
        and not coalesce(p.banned,false)
        and (
          p_state is null or w.scope_type='global'
          or (
            nullif(public.wehouse_state_key(w.scope_state),'') is not null
            and public.wehouse_state_key(w.scope_state)=public.wehouse_state_key(p_state)
          )
        )
    )
  end
$$;

create or replace function public.get_my_workspace_access()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select jsonb_build_object(
    'identity',jsonb_build_object(
      'user_id',profile.user_id,
      'account_kind','consumer',
      'compatibility_role',profile.role
    ),
    'personal_workspace',
      profile.deleted_at is null and not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false),
    'privileged_workspaces',coalesce((
      select jsonb_agg(workspace.item order by workspace.item->>'role')
      from (
        select jsonb_build_object(
          'role',assignment.workspace_role,
          'scope_type',assignment.scope_type,
          'state',assignment.scope_state,
          'lga',assignment.scope_lga
        ) as item
        from public.workspace_role_assignments assignment
        where assignment.user_id=profile.user_id
          and assignment.status='active' and assignment.revoked_at is null
          and profile.deleted_at is null and not coalesce(profile.deleted,false)
          and not coalesce(profile.suspended,false) and not coalesce(profile.banned,false)
          and assignment.workspace_role in(
            'worker','property_partner','staff','admin','creator'
          )
        union all
        select jsonb_build_object(
          'role','hotel','scope_type','hotel','state',null,'lga',null
        )
        where profile.deleted_at is null and not coalesce(profile.deleted,false)
          and not coalesce(profile.suspended,false) and not coalesce(profile.banned,false)
          and exists(
            select 1 from public.hotel_team_members team
            where team.member_user_id=profile.user_id and team.status='active'
          )
        union all
        select jsonb_build_object(
          'role','hosting','scope_type','property','state',null,'lga',null
        )
        where profile.deleted_at is null and not coalesce(profile.deleted,false)
          and not coalesce(profile.suspended,false) and not coalesce(profile.banned,false)
          and exists(
            select 1
            from public.property_host_assignments host
            join public.listings listing on listing.id=host.listing_id
            where host.user_id=profile.user_id
              and host.assignment_role='manager'
              and host.status='active'
              and (
                listing.management_mode='host'
                or exists(
                  select 1 from public.reservations reservation
                  where (reservation.listing_id=listing.id::text or reservation.listing_id=listing.listing_id)
                    and reservation.management_mode_snapshot='host'
                    and reservation.responsible_host_user_id=host.user_id
                    and reservation.status not in ('completed','cancelled','refunded','expired')
                )
              )
          )
      ) workspace
    ),'[]'::jsonb)
  )
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
$$;

revoke all on function public.create_property_cohost_invitation(uuid,text,text,text) from public,anon;
revoke all on function public.create_hotel_team_invitation(integer,text,text,text) from public,anon;
revoke all on function public.get_my_resource_invitation(uuid) from public,anon;
revoke all on function public.get_my_resource_invitations(text,text) from public,anon;
revoke all on function public.revoke_resource_invitation(uuid) from public,anon;
revoke all on function public.preview_resource_invitation(text) from public;
revoke all on function public.respond_to_resource_invitation(uuid,boolean,text) from public,anon;
revoke all on function public.get_my_sent_resource_invitations(text,text) from public,anon;
revoke all on function public.revoke_my_resource_invitation(uuid) from public,anon;
revoke all on function public.respond_to_property_host_invite(uuid,boolean) from public,anon;
revoke all on function public.respond_to_hotel_team_invitation(uuid,boolean) from public,anon;
revoke all on function public.current_actor_can_manage_property(uuid) from public,anon;
revoke all on function public.user_has_active_workspace(text,text) from public,anon;
revoke all on function public.current_actor_has_workspace(text,text) from public,anon;
revoke all on function public.get_my_workspace_access() from public,anon;

grant execute on function public.create_property_cohost_invitation(uuid,text,text,text) to authenticated,service_role;
grant execute on function public.create_hotel_team_invitation(integer,text,text,text) to authenticated,service_role;
grant execute on function public.get_my_resource_invitation(uuid) to authenticated,service_role;
grant execute on function public.get_my_resource_invitations(text,text) to authenticated,service_role;
grant execute on function public.revoke_resource_invitation(uuid) to authenticated,service_role;
grant execute on function public.preview_resource_invitation(text) to anon,authenticated,service_role;
grant execute on function public.respond_to_resource_invitation(uuid,boolean,text) to authenticated,service_role;
grant execute on function public.get_my_sent_resource_invitations(text,text) to authenticated,service_role;
grant execute on function public.revoke_my_resource_invitation(uuid) to authenticated,service_role;
grant execute on function public.respond_to_property_host_invite(uuid,boolean) to authenticated,service_role;
grant execute on function public.respond_to_hotel_team_invitation(uuid,boolean) to authenticated,service_role;
grant execute on function public.current_actor_can_manage_property(uuid) to authenticated,service_role;
grant execute on function public.user_has_active_workspace(text,text) to authenticated,service_role;
grant execute on function public.current_actor_has_workspace(text,text) to authenticated,service_role;
grant execute on function public.get_my_workspace_access() to authenticated,service_role;

comment on table public.resource_invitations is
  'Single invitation authority for delegated property and hotel access. Public property sharing never grants rows here.';
