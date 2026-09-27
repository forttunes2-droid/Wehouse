-- Close ownership, invitation, support-routing and capacity gaps found in the
-- reviewed marketplace branch. All grants remain explicit.
begin;

-- A pending invitation must never overwrite an owner's assignment or briefly
-- remove an active manager's access when the owner re-invites them.
create or replace function public.guard_invited_team_assignment()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
begin
  if tg_table_name='property_host_assignments' then
    if tg_op='UPDATE' and old.assignment_role='owner'
       and new.assignment_role is distinct from old.assignment_role then
      raise exception 'A property owner assignment cannot be replaced by a co-host invitation';
    end if;
    if tg_op='UPDATE' and old.status='active' and new.status='invited' then
      raise exception 'An active co-host must be revoked before a new invitation is sent';
    end if;
  elsif tg_table_name='hotel_team_members' then
    if tg_op='UPDATE' and old.status='active' and new.status='invited' then
      raise exception 'An active hotel team member must be revoked before a new invitation is sent';
    end if;
    if exists(
      select 1 from public.hotels h
      where h.hotel_id=new.hotel_id and h.owner_id=new.member_user_id
    ) then
      raise exception 'A hotel owner cannot be added as a team member';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.guard_invited_team_assignment() from public,anon,authenticated;

drop trigger if exists property_host_invitation_assignment_guard on public.property_host_assignments;
create trigger property_host_invitation_assignment_guard
before insert or update on public.property_host_assignments
for each row execute function public.guard_invited_team_assignment();
drop trigger if exists hotel_team_invitation_assignment_guard on public.hotel_team_members;
create trigger hotel_team_invitation_assignment_guard
before insert or update on public.hotel_team_members
for each row execute function public.guard_invited_team_assignment();

-- Resource locks precede invitation locks, matching creation/revocation paths.
-- Acceptance checks the inviter's current authority and the recipient's current
-- assignment so stale invitations cannot grant or overwrite access.
create or replace function public.respond_to_resource_invitation(
  p_invitation_id uuid,p_accept boolean,p_token text default null
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_invite public.resource_invitations;
  v_initial public.resource_invitations;
  v_actor_profile public.profiles;
  v_inviter public.profiles;
  v_listing public.listings;
  v_hotel public.hotels;
  v_assignment public.property_host_assignments;
  v_membership public.hotel_team_members;
  v_role text;
  v_caps text[];
  v_inviter_caps text[];
begin
  if v_actor is null then raise exception 'Sign in to respond to this invitation'; end if;
  select * into v_actor_profile from public.profiles
    where user_id=v_actor and not coalesce(deleted,false)
      and not coalesce(suspended,false) and not coalesce(banned,false);
  if v_actor_profile.user_id is null then raise exception 'Active WeHouse account required'; end if;

  select * into v_initial from public.resource_invitations where invitation_id=p_invitation_id;
  if v_initial.invitation_id is null then raise exception 'Invitation not found'; end if;
  if v_initial.resource_type='property' then
    select * into v_listing from public.listings
      where id=v_initial.resource_id::uuid for update;
  else
    select * into v_hotel from public.hotels
      where hotel_id=v_initial.resource_id::integer for update;
  end if;
  select * into v_invite from public.resource_invitations
    where invitation_id=p_invitation_id for update;
  if v_invite.invitation_id is null
     or v_invite.resource_type is distinct from v_initial.resource_type
     or v_invite.resource_id is distinct from v_initial.resource_id then
    raise exception 'Invitation changed; refresh and try again';
  end if;
  if v_invite.status<>'pending' then raise exception 'This invitation is no longer pending'; end if;
  if v_invite.expires_at<=now() then raise exception 'This invitation has expired'; end if;

  if v_invite.delivery='direct' then
    if v_invite.intended_user_id<>v_actor then raise exception 'This invitation belongs to another account'; end if;
  elsif nullif(btrim(coalesce(p_token,'')),'') is null
     or v_invite.token_hash<>public._invitation_token_hash(p_token) then
    raise exception 'Invitation link is invalid';
  end if;

  if p_accept then
    select * into v_inviter from public.profiles
      where user_id=v_invite.inviter_user_id
        and not coalesce(deleted,false)
        and not coalesce(suspended,false)
        and not coalesce(banned,false)
      for share;
    if v_inviter.user_id is null then raise exception 'The inviter no longer has an active account'; end if;

    if v_invite.resource_type='property' then
      if v_listing.id is null or v_listing.deleted_at is not null
         or v_listing.approved_at is null or v_listing.management_updated_at is null
         or v_listing.management_mode<>'host' then
        raise exception 'This property is not available for co-host access';
      end if;
      select * into v_assignment from public.property_host_assignments a
        where a.listing_id=v_listing.id and a.user_id=v_invite.inviter_user_id
          and a.assignment_role='owner' and a.status='active'
        for update;
      if v_assignment.assignment_id is null then
        raise exception 'The inviter no longer owns this property';
      end if;
      if v_actor=v_invite.inviter_user_id or exists(
        select 1 from public.property_host_assignments a
        where a.listing_id=v_listing.id and a.user_id=v_actor
          and a.assignment_role='owner' and a.status='active'
      ) then raise exception 'A property owner cannot accept a co-host invitation'; end if;

      select * into v_assignment from public.property_host_assignments a
        where a.listing_id=v_listing.id and a.user_id=v_actor for update;
      if v_assignment.assignment_id is not null
         and (v_assignment.assignment_role='owner' or v_assignment.status='active') then
        raise exception 'This account already has active property access';
      end if;
      insert into public.property_host_assignments(
        listing_id,user_id,assignment_role,status,invited_by,invited_at,
        accepted_at,revoked_at,updated_at,access_level
      ) values(
        v_listing.id,v_actor,'manager','active',v_invite.inviter_user_id,
        v_invite.created_at,now(),null,now(),v_invite.permission_profile
      ) on conflict(listing_id,user_id) do update set
        assignment_role='manager',status='active',invited_by=v_invite.inviter_user_id,
        accepted_at=now(),revoked_at=null,updated_at=now(),
        access_level=excluded.access_level
      where public.property_host_assignments.assignment_role<>'owner'
        and public.property_host_assignments.status<>'active'
      returning * into v_assignment;
      if v_assignment.assignment_id is null then
        raise exception 'Property access changed; ask the owner to send a new invitation';
      end if;
    else
      if v_hotel.hotel_id is null then raise exception 'Hotel not found'; end if;
      if v_actor=v_invite.inviter_user_id or v_actor=v_hotel.owner_id then
        raise exception 'A hotel owner or inviter cannot accept this team invitation';
      end if;
      if v_hotel.owner_id<>v_invite.inviter_user_id then
        select coalesce(member.capabilities,array[]::text[]) into v_inviter_caps
        from public.hotel_team_members member
        where member.hotel_id=v_hotel.hotel_id
          and member.member_user_id=v_invite.inviter_user_id
          and member.status='active'
        for update;
        if not coalesce('hotel.team.manage'=any(v_inviter_caps),false) then
          raise exception 'The inviter no longer has hotel team-management access';
        end if;
      end if;
      v_role:=case when v_invite.role_key='hotel_manager' then 'manager' else 'front_desk' end;
      v_caps:=public.hotel_default_capabilities(v_role);
      if v_hotel.owner_id<>v_invite.inviter_user_id and not(v_caps<@v_inviter_caps) then
        raise exception 'The inviter no longer has permission to grant this hotel role';
      end if;

      select * into v_membership from public.hotel_team_members member
        where member.hotel_id=v_hotel.hotel_id and member.member_user_id=v_actor
        for update;
      if v_membership.id is not null and v_membership.status='active' then
        raise exception 'This account already has active hotel access';
      end if;
      insert into public.hotel_team_members(
        hotel_id,member_user_id,hotel_role,status,invited_by,capabilities,
        updated_at,revoked_at,responded_at
      ) values(
        v_hotel.hotel_id,v_actor,v_role,'active',v_invite.inviter_user_id,
        v_caps,now(),null,now()
      ) on conflict(hotel_id,member_user_id) do update set
        hotel_role=excluded.hotel_role,status='active',invited_by=v_invite.inviter_user_id,
        capabilities=excluded.capabilities,updated_at=now(),revoked_at=null,
        responded_at=now()
      where public.hotel_team_members.status<>'active'
        and not exists(select 1 from public.hotels h
          where h.hotel_id=excluded.hotel_id and h.owner_id=excluded.member_user_id)
      returning * into v_membership;
      if v_membership.id is null then
        raise exception 'Hotel access changed; ask the owner to send a new invitation';
      end if;
    end if;
  else
    if v_invite.resource_type='property' and v_invite.subject_assignment_id is not null then
      update public.property_host_assignments
        set status='declined',revoked_at=now(),updated_at=now()
        where assignment_id=v_invite.subject_assignment_id and status='invited';
    elsif v_invite.resource_type='hotel' and v_invite.subject_assignment_id is not null then
      update public.hotel_team_members
        set status='declined',responded_at=now(),updated_at=now()
        where id=v_invite.subject_assignment_id and status='invited';
    end if;
  end if;

  update public.resource_invitations
  set status=case when p_accept then 'accepted' else 'declined' end,
      accepted_user_id=case when p_accept then v_actor else null end,
      accepted_at=case when p_accept then now() else null end,
      responded_at=now(),updated_at=now()
  where invitation_id=v_invite.invitation_id;

  insert into public.notifications(
    recipient_id,type,title,message,related_id,source_type,source_id,
    destination_route,destination_params,event_key,workspace_scope
  ) values(
    v_invite.inviter_user_id,'resource_invitation_response',
    case when p_accept then 'Invitation accepted' else 'Invitation declined' end,
    (select coalesce(p.full_name,p.username,'A WeHouse member')
       from public.profiles p where p.user_id=v_actor)
      ||case when p_accept then ' accepted your invitation.' else ' declined your invitation.' end,
    v_invite.invitation_id::text,'resource_invitation',v_invite.invitation_id::text,
    case when v_invite.resource_type='hotel' then 'property-owner' else 'property_partner' end,
    jsonb_build_object('invitation_id',v_invite.invitation_id,
      'resource_type',v_invite.resource_type,'resource_id',v_invite.resource_id),
    'resource-invite-response:'||v_invite.invitation_id::text||':'
      ||case when p_accept then 'accepted' else 'declined' end,
    'property_partner'
  );
  return jsonb_build_object('invitation_id',v_invite.invitation_id,
    'accepted',p_accept,'resource_type',v_invite.resource_type,
    'resource_id',v_invite.resource_id);
end
$$;
revoke all on function public.respond_to_resource_invitation(uuid,boolean,text) from public,anon;
grant execute on function public.respond_to_resource_invitation(uuid,boolean,text) to authenticated,service_role;

-- A co-host gets Help only for currently assigned properties. It is a read-only
-- projection and deliberately returns no payment, payout, guest-code or owner data.
create or replace function public.get_my_hosting_help_targets()
returns jsonb language plpgsql stable security definer
set search_path='pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_account jsonb; v_properties jsonb;
begin
  if v_actor is null or not exists(select 1 from public.profiles p
    where p.user_id=v_actor and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
    raise exception 'Active account required';
  end if;
  if not exists(select 1 from jsonb_array_elements(
      public.get_my_workspace_access()->'privileged_workspaces') role_row
      where role_row->>'role'='hosting') then
    raise exception 'Hosting workspace access required';
  end if;
  select source->'account' into v_account from (select public.get_my_account_help_targets() source) row;
  select coalesce(jsonb_agg(jsonb_build_object(
      'subject_type','listing','subject_id',listing.id::text,
      'context_type','property_listing','label',coalesce(listing.title,'Property'),
      'detail','Assigned hosting','status',listing.status,
      'updated_at',listing.updated_at
    ) order by listing.updated_at desc),'[]'::jsonb)
  into v_properties
  from public.listings listing
  where listing.deleted_at is null and listing.approved_at is not null
    and exists(select 1 from public.property_host_assignments assignment
      where assignment.listing_id=listing.id and assignment.user_id=v_actor
        and assignment.assignment_role='manager' and assignment.status='active')
    and public.current_actor_property_host_access_level(listing.id) is not null;
  return jsonb_build_object('account',v_account,'properties',v_properties,'payment_targets','[]'::jsonb);
end
$$;
revoke all on function public.get_my_hosting_help_targets() from public,anon;
grant execute on function public.get_my_hosting_help_targets() to authenticated,service_role;

-- Preserve property-inquiry behavior while authorizing Hosting inquiries against
-- the exact current co-host assignment. Public customers keep their existing path.
create or replace function public.open_property_operations_conversation(
  p_subject_type text,p_subject_id text,p_snapshot jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_thread public.canonical_threads;
  v_conversation public.partner_support_conversations;
  v_snapshot jsonb;
  v_title text;
  v_state text;
  v_allowed boolean:=false;
  v_owns boolean:=false;
  v_hotel_staff boolean:=false;
  v_host_manager boolean:=false;
  v_default_workspace text;
  v_workspace text;
  v_thread_key text;
  v_access jsonb;
begin
  if p_subject_type not in('listing','hotel_property')
     or nullif(btrim(coalesce(p_subject_id,'')),'') is null then
    raise exception 'Property conversation subject is invalid';
  end if;
  select * into v_actor from public.profiles
    where auth_id=(select auth.uid())::text
      and not coalesce(deleted,false) and not coalesce(suspended,false)
      and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active Personal account required'; end if;

  if p_subject_type='listing' then
    select coalesce(l.title,'Property'),l.state,
      l.deleted_at is null and ((l.status='available' and l.approved_at is not null)
        or v_actor.user_id in(l.owner_id,l.partner_id)
        or exists(select 1 from public.property_host_assignments assignment
          where assignment.listing_id=l.id and assignment.user_id=v_actor.user_id
            and assignment.assignment_role='manager' and assignment.status='active'
            and public.current_actor_property_host_access_level(l.id) is not null)),
      coalesce(v_actor.user_id in(l.owner_id,l.partner_id),false),
      exists(select 1 from public.property_host_assignments assignment
        where assignment.listing_id=l.id and assignment.user_id=v_actor.user_id
          and assignment.assignment_role='manager' and assignment.status='active'
          and public.current_actor_property_host_access_level(l.id) is not null)
    into v_title,v_state,v_allowed,v_owns,v_host_manager
    from public.listings l
    where l.id::text=p_subject_id or l.listing_id=p_subject_id limit 1;
  else
    select coalesce(h.name,'Hotel'),h.state,
      (h.status='active' and h.approved_at is not null)
        or h.owner_id=v_actor.user_id
        or public.hotel_actor_has_capability(h.hotel_id,'stay.read'),
      coalesce(h.owner_id=v_actor.user_id,false),
      public.hotel_actor_has_capability(h.hotel_id,'stay.read')
    into v_title,v_state,v_allowed,v_owns,v_hotel_staff
    from public.hotels h where h.hotel_id::text=p_subject_id limit 1;
  end if;
  if not coalesce(v_allowed,false) then raise exception 'This property is not available to this account'; end if;

  v_default_workspace:=case when v_owns then 'property_partner'
    when v_hotel_staff then 'hotel' else 'personal' end;
  v_workspace:=coalesce(nullif(p_snapshot->>'requester_workspace',''),v_default_workspace);
  if v_workspace not in ('personal','worker','property_partner','hosting','hotel') then
    raise exception 'Unsupported workspace';
  end if;
  if v_workspace='hosting' and (p_subject_type<>'listing' or not v_host_manager) then
    raise exception 'Active Hosting assignment is required for this property';
  end if;
  v_access:=public.get_my_workspace_access();
  if v_workspace<>'personal' and not exists(
      select 1 from jsonb_array_elements(v_access->'privileged_workspaces') item
      where item->>'role'=v_workspace) then raise exception 'Workspace access required'; end if;

  select t.thread_key into v_thread_key
  from public.canonical_threads t
  join public.partner_support_conversations c on c.canonical_thread_id=t.thread_id
  where t.thread_type='property_inquiry' and t.subject_type=p_subject_type
    and t.subject_id=p_subject_id and c.partner_id=v_actor.user_id
    and coalesce(nullif(c.context_snapshot->>'requester_workspace',''),v_default_workspace)=v_workspace
  order by c.created_at limit 1;
  v_thread_key:=coalesce(v_thread_key,p_subject_type||':'||p_subject_id
    ||':requester:'||v_actor.user_id||':workspace:'||v_workspace);
  v_snapshot:=coalesce(p_snapshot,'{}'::jsonb)
    -'booking_code'-'check_in_code'-'access_code'-'verification_code'
    -'handover_code'-'recovery_code';
  v_snapshot:=v_snapshot||jsonb_build_object(
    'source_type',p_subject_type,'source_id',p_subject_id,
    'owning_domain','property_operations','state_scope',v_state,
    'requester_workspace',v_workspace,
    case when p_subject_type='listing' then 'listing_title' else 'hotel_name' end,v_title);

  insert into public.canonical_threads(thread_type,thread_key,subject_type,subject_id,state,created_at,updated_at)
  values('property_inquiry',v_thread_key,p_subject_type,p_subject_id,'open',now(),now())
  on conflict(thread_type,thread_key) do update set
    state=case when canonical_threads.state='closed' then 'open' else canonical_threads.state end,
    updated_at=now() returning * into v_thread;
  insert into public.canonical_thread_participants(thread_id,user_id,participant_role,can_message,can_view_obligation)
  values(v_thread.thread_id,v_actor.user_id,'requester',true,true)
  on conflict(thread_id,user_id) do update set left_at=null,can_message=true,can_view_obligation=true;
  insert into public.partner_support_conversations(
    partner_id,requester_role,subject,status,category,context_type,context_id,
    context_snapshot,priority,channel_kind,canonical_thread_id,created_at,updated_at
  ) values(
    v_actor.user_id,v_actor.role,v_title,'open','property_inquiry',
    case when p_subject_type='listing' then 'property_listing' else 'hotel_operations' end,
    p_subject_id,v_snapshot,'normal','property_operations',v_thread.thread_id,now(),now()
  ) on conflict(canonical_thread_id) where canonical_thread_id is not null
  do update set subject=excluded.subject,context_snapshot=excluded.context_snapshot,
    status=case when partner_support_conversations.status='closed' then 'open'
      else partner_support_conversations.status end,updated_at=now()
  returning * into v_conversation;
  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,attachment_types,
    action_type,action_metadata,is_read,visibility,created_at
  ) select v_conversation.id,v_actor.user_id,'system',
    'Property conversation linked to this record.',array[]::text[],array[]::text[],
    'request_received',jsonb_build_object('thread_type','property_inquiry','owning_domain','property_operations'),false,'customer',now()
  where not exists(select 1 from public.partner_support_messages m where m.conversation_id=v_conversation.id);
  return jsonb_build_object('conversation_id',v_conversation.id,
    'canonical_thread_id',v_thread.thread_id,'owning_domain','property_operations','case_started',false);
end
$$;
revoke all on function public.open_property_operations_conversation(text,text,jsonb) from public,anon;
grant execute on function public.open_property_operations_conversation(text,text,jsonb) to authenticated,service_role;

-- Route Hosting support to the authenticated Hosting workspace, and require a
-- live assignment whenever the linked subject is a property listing.
create or replace function public.get_my_workspace_inbox(p_workspace text,p_kind text)
returns jsonb language plpgsql stable security definer
set search_path='pg_catalog','public'
as $$
declare actor text; result jsonb; access jsonb;
begin
  select user_id into actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false);
  if actor is null then raise exception 'Authentication required'; end if;
  if p_workspace is null or p_workspace not in ('personal','worker','property_partner','hosting','hotel') then
    raise exception 'Unsupported workspace';
  end if;
  access:=public.get_my_workspace_access();
  if p_workspace<>'personal' and not exists(
    select 1 from jsonb_array_elements(access->'privileged_workspaces') item
    where item->>'role'=p_workspace
  ) then raise exception 'Workspace access required'; end if;

  if p_kind='service' and p_workspace in ('personal','worker') then
    select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc),'[]'::jsonb) into result
    from public.get_my_booking_conversations_v3(actor) row
    join public.booking_conversations thread on thread.id=row.conversation_id
    where (p_workspace='personal' and thread.user_id=actor)
       or (p_workspace='worker' and thread.worker_id=actor);
  elsif p_kind='hotel' and p_workspace in ('personal','property_partner','hotel') then
    select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc),'[]'::jsonb) into result
    from public.get_my_hotel_booking_conversations() row
    where (p_workspace='personal' and row.guest_user_id=actor)
       or (p_workspace<>'personal' and row.guest_user_id<>actor);
  elsif p_kind='wehouse' then
    select coalesce(jsonb_agg(to_jsonb(row) order by coalesce(row.last_message_time,row.created_at) desc),'[]'::jsonb) into result
    from public.get_my_support_conversations() row
    join public.partner_support_conversations thread on thread.id=row.conversation_id
    where thread.partner_id=actor and (case
      when thread.context_type in ('apartment_reservation','reservation','apartment_payment','hotel_booking') then 'personal'
      when thread.context_type in ('worker_booking','worker_job')
        or thread.context_snapshot->>'subject_type'='worker_job'
        or thread.context_snapshot->>'source_type'='worker_job'
        or thread.context_snapshot->>'reason_code'='worker_job_issue' then
        case when exists(select 1 from public.worker_bookings booking
          where booking.id::text=coalesce(thread.context_snapshot->>'source_id',thread.context_id)
            and booking.worker_id=actor) then 'worker' else 'personal' end
      when thread.context_snapshot->>'requester_workspace'='hosting' then
        case when exists(select 1 from public.property_host_assignments assignment
          join public.listings listing on listing.id=assignment.listing_id
          where assignment.user_id=actor and assignment.assignment_role='manager'
            and assignment.status='active'
            and public.current_actor_property_host_access_level(listing.id) is not null
            and (thread.context_type not in ('property_listing','listing')
              or listing.id::text=thread.context_id or listing.listing_id=thread.context_id))
          then 'hosting' else 'restricted' end
      when thread.context_snapshot->>'requester_workspace' in ('personal','worker','property_partner','hotel') then
        thread.context_snapshot->>'requester_workspace'
      when thread.context_type='property_inspection' then 'property_partner'
      when thread.context_type in ('property_listing','listing') then
        case when exists(select 1 from public.listings listing
          where (listing.id::text=thread.context_id or listing.listing_id=thread.context_id)
            and actor in (listing.owner_id,listing.partner_id))
          then 'property_partner' else 'personal' end
      when thread.context_type in ('hotel_property','hotel_operations') then
        case when exists(select 1 from public.hotels hotel
          where hotel.hotel_id::text=thread.context_id and hotel.owner_id=actor)
          then 'property_partner'
        when exists(select 1 from public.hotels hotel where hotel.hotel_id::text=thread.context_id
            and public.hotel_actor_has_capability(hotel.hotel_id,'stay.read'))
          then 'hotel' else 'personal' end
      when coalesce(thread.requester_role,'user')='user' then 'personal'
      when thread.requester_role='hotel_staff' then 'hotel'
      else thread.requester_role end)=p_workspace;
  else raise exception 'Unsupported inbox';
  end if;
  return result;
end
$$;
revoke all on function public.get_my_workspace_inbox(text,text) from public,anon;
grant execute on function public.get_my_workspace_inbox(text,text) to authenticated,service_role;

-- Capacity is a hard admission limit. Serialize entries into the same market
-- bucket, including verification and Worker workspace reactivation.
create or replace function public.enforce_worker_market_capacity()
returns trigger language plpgsql security definer
set search_path='pg_catalog','public'
as $$
declare
  v_old_public boolean:=coalesce(old.worker_status='verified' and old.worker_verified=true
    and not coalesce(old.deleted,false) and not coalesce(old.suspended,false)
    and not coalesce(old.banned,false) and public.user_has_active_workspace(old.user_id,'worker'),false);
  v_new_public boolean:=coalesce(new.worker_status='verified' and new.worker_verified=true
    and not coalesce(new.deleted,false) and not coalesce(new.suspended,false)
    and not coalesce(new.banned,false) and public.user_has_active_workspace(new.user_id,'worker'),false);
  v_old_state text:=public.wehouse_state_key(old.state);
  v_new_state text:=public.wehouse_state_key(new.state);
  v_old_lga text:=public.worker_market_text_key(coalesce(nullif(old.local_government,''),old.city));
  v_new_lga text:=public.worker_market_text_key(coalesce(nullif(new.local_government,''),new.city));
  v_old_occupation text:=public.worker_market_text_key(old.worker_occupation);
  v_new_occupation text:=public.worker_market_text_key(new.worker_occupation);
  v_rule public.worker_market_capacity;
  v_live bigint:=0;
begin
  if not v_new_public then return new; end if;
  if v_old_public and v_old_state=v_new_state and v_old_lga=v_new_lga
      and v_old_occupation=v_new_occupation then return new; end if;
  perform pg_advisory_xact_lock(hashtext(v_new_state),hashtext(v_new_lga||':'||v_new_occupation));
  select * into v_rule from public.worker_market_capacity rule
    where rule.state_key=v_new_state and rule.lga_key=v_new_lga
      and rule.occupation_key=v_new_occupation for update;
  if v_rule.capacity_id is null then return new; end if;
  if v_rule.approvals_paused then
    raise exception 'New % approvals are paused in %, %',v_rule.occupation_name,v_rule.lga_name,v_rule.state_name;
  end if;
  if v_rule.hard_limit is not null then
    select count(*) into v_live from public.profiles other
    where other.user_id<>new.user_id and other.worker_status='verified'
      and other.worker_verified=true and not coalesce(other.deleted,false)
      and not coalesce(other.suspended,false) and not coalesce(other.banned,false)
      and public.user_has_active_workspace(other.user_id,'worker')
      and public.wehouse_state_key(other.state)=v_rule.state_key
      and public.worker_market_text_key(coalesce(nullif(other.local_government,''),other.city))=v_rule.lga_key
      and public.worker_market_text_key(other.worker_occupation)=v_rule.occupation_key;
    if v_live>=v_rule.hard_limit then
      raise exception '% capacity is full in %, % (% of % verified)',
        v_rule.occupation_name,v_rule.lga_name,v_rule.state_name,v_live,v_rule.hard_limit;
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.enforce_worker_market_capacity() from public,anon,authenticated;
drop trigger if exists profiles_worker_market_capacity_guard on public.profiles;
create trigger profiles_worker_market_capacity_guard
before update of worker_status,worker_verified,state,local_government,city,worker_occupation,deleted,suspended,banned
on public.profiles for each row execute function public.enforce_worker_market_capacity();

create or replace function public.enforce_worker_workspace_capacity()
returns trigger language plpgsql security definer
set search_path='pg_catalog','public'
as $$
declare v_worker public.profiles; v_rule public.worker_market_capacity; v_live bigint:=0;
  v_state text; v_lga text; v_occupation text;
begin
  if new.workspace_role<>'worker' or new.status<>'active' then return new; end if;
  select * into v_worker from public.profiles where user_id=new.user_id;
  if v_worker.user_id is null or v_worker.worker_status<>'verified' or v_worker.worker_verified is distinct from true
     or coalesce(v_worker.deleted,false) or coalesce(v_worker.suspended,false) or coalesce(v_worker.banned,false) then
    return new;
  end if;
  v_state:=public.wehouse_state_key(v_worker.state);
  v_lga:=public.worker_market_text_key(coalesce(nullif(v_worker.local_government,''),v_worker.city));
  v_occupation:=public.worker_market_text_key(v_worker.worker_occupation);
  perform pg_advisory_xact_lock(hashtext(v_state),hashtext(v_lga||':'||v_occupation));
  select * into v_rule from public.worker_market_capacity rule
    where rule.state_key=v_state and rule.lga_key=v_lga and rule.occupation_key=v_occupation for update;
  if v_rule.capacity_id is null then return new; end if;
  if v_rule.approvals_paused then raise exception 'New % approvals are paused in %, %',v_rule.occupation_name,v_rule.lga_name,v_rule.state_name; end if;
  if v_rule.hard_limit is null then return new; end if;
  select count(*) into v_live from public.profiles other
    where other.user_id<>new.user_id and other.worker_status='verified' and other.worker_verified=true
      and not coalesce(other.deleted,false) and not coalesce(other.suspended,false) and not coalesce(other.banned,false)
      and public.user_has_active_workspace(other.user_id,'worker')
      and public.wehouse_state_key(other.state)=v_rule.state_key
      and public.worker_market_text_key(coalesce(nullif(other.local_government,''),other.city))=v_rule.lga_key
      and public.worker_market_text_key(other.worker_occupation)=v_rule.occupation_key;
  if v_live>=v_rule.hard_limit then
    raise exception '% capacity is full in %, % (% of % verified)',v_rule.occupation_name,v_rule.lga_name,v_rule.state_name,v_live,v_rule.hard_limit;
  end if;
  return new;
end
$$;
revoke all on function public.enforce_worker_workspace_capacity() from public,anon,authenticated;
drop trigger if exists worker_workspace_market_capacity_guard on public.workspace_role_assignments;
create trigger worker_workspace_market_capacity_guard
before insert or update of workspace_role,status on public.workspace_role_assignments
for each row execute function public.enforce_worker_workspace_capacity();

create or replace function public.creator_set_worker_market_capacity(
  p_state text,p_lga text,p_occupation text,p_target_count integer,p_hard_limit integer,
  p_approvals_paused boolean,p_note text,p_creator_elevation_id uuid
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_state_key text:=public.wehouse_state_key(p_state);
  v_lga_key text:=public.worker_market_text_key(p_lga);
  v_occupation_key text:=public.worker_market_text_key(p_occupation);
  v_row public.worker_market_capacity;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then raise exception 'Recent Creator authentication required'; end if;
  if nullif(v_state_key,'') is null or nullif(v_lga_key,'') is null or nullif(v_occupation_key,'') is null then raise exception 'State, LGA and occupation are required'; end if;
  if p_target_count is not null and p_target_count<0 then raise exception 'Target cannot be negative'; end if;
  if p_hard_limit is not null and p_hard_limit<0 then raise exception 'Hard limit cannot be negative'; end if;
  if p_target_count is not null and p_hard_limit is not null and p_target_count>p_hard_limit then raise exception 'Target cannot be greater than the hard limit'; end if;
  perform pg_advisory_xact_lock(hashtext(v_state_key),hashtext(v_lga_key||':'||v_occupation_key));
  insert into public.worker_market_capacity(
    state_name,state_key,lga_name,lga_key,occupation_name,occupation_key,target_count,hard_limit,
    approvals_paused,note,updated_by,created_at,updated_at
  ) values(btrim(p_state),v_state_key,btrim(p_lga),v_lga_key,btrim(p_occupation),v_occupation_key,
    p_target_count,p_hard_limit,coalesce(p_approvals_paused,false),nullif(btrim(coalesce(p_note,'')),''),v_actor,now(),now())
  on conflict(state_key,lga_key,occupation_key) do update set
    state_name=excluded.state_name,lga_name=excluded.lga_name,occupation_name=excluded.occupation_name,
    target_count=excluded.target_count,hard_limit=excluded.hard_limit,approvals_paused=excluded.approvals_paused,
    note=excluded.note,updated_by=v_actor,updated_at=now()
  returning * into v_row;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'worker_market_capacity_updated','worker_market_capacity',v_row.capacity_id::text,
    jsonb_build_object('state',v_row.state_name,'lga',v_row.lga_name,'occupation',v_row.occupation_name,
      'target_count',v_row.target_count,'hard_limit',v_row.hard_limit,'approvals_paused',v_row.approvals_paused)::text,now());
  return to_jsonb(v_row);
end
$$;
revoke all on function public.creator_set_worker_market_capacity(text,text,text,integer,integer,boolean,text,uuid) from public,anon;
grant execute on function public.creator_set_worker_market_capacity(text,text,text,integer,integer,boolean,text,uuid) to authenticated,service_role;

create or replace function public.creator_remove_worker_market_capacity(p_capacity_id uuid,p_creator_elevation_id uuid)
returns boolean language plpgsql security definer
set search_path='pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_row public.worker_market_capacity;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'staff_authority') then raise exception 'Recent Creator authentication required'; end if;
  select * into v_row from public.worker_market_capacity where capacity_id=p_capacity_id;
  if v_row.capacity_id is null then raise exception 'Capacity rule not found'; end if;
  perform pg_advisory_xact_lock(hashtext(v_row.state_key),hashtext(v_row.lga_key||':'||v_row.occupation_key));
  delete from public.worker_market_capacity where capacity_id=p_capacity_id returning * into v_row;
  if v_row.capacity_id is null then raise exception 'Capacity rule changed; refresh and try again'; end if;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(v_actor,'worker_market_capacity_removed','worker_market_capacity',p_capacity_id::text,
    jsonb_build_object('state',v_row.state_name,'lga',v_row.lga_name,'occupation',v_row.occupation_name)::text,now());
  return true;
end
$$;
revoke all on function public.creator_remove_worker_market_capacity(uuid,uuid) from public,anon;
grant execute on function public.creator_remove_worker_market_capacity(uuid,uuid) to authenticated,service_role;

-- This RPC is only for the caller's own capacity state; Creator sees only an
-- authenticated, explicit oversight request.
create or replace function public.worker_market_capacity_status(p_worker_id text)
returns jsonb language plpgsql stable security definer
set search_path='pg_catalog','public'
as $$
declare v_worker public.profiles; v_rule public.worker_market_capacity; v_live bigint:=0;
  v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null or (p_worker_id<>v_actor and not public.current_actor_has_workspace('creator',null)) then
    raise exception 'Worker capacity status is available only to that Worker or Creator';
  end if;
  select * into v_worker from public.profiles
    where user_id=p_worker_id and public.user_has_active_workspace(user_id,'worker') and not coalesce(deleted,false);
  if v_worker.user_id is null then return jsonb_build_object('configured',false,'eligible',false,'reason','Worker not found'); end if;
  select * into v_rule from public.worker_market_capacity rule
    where rule.state_key=public.wehouse_state_key(v_worker.state)
      and rule.lga_key=public.worker_market_text_key(coalesce(nullif(v_worker.local_government,''),v_worker.city))
      and rule.occupation_key=public.worker_market_text_key(v_worker.worker_occupation) limit 1;
  if v_rule.capacity_id is null then return jsonb_build_object('configured',false,'eligible',true,
      'state',v_worker.state,'lga',coalesce(nullif(v_worker.local_government,''),v_worker.city),
      'occupation',v_worker.worker_occupation); end if;
  select count(*) into v_live from public.profiles other
    where other.user_id<>v_worker.user_id and other.worker_status='verified' and other.worker_verified=true
      and not coalesce(other.deleted,false) and not coalesce(other.suspended,false) and not coalesce(other.banned,false)
      and public.user_has_active_workspace(other.user_id,'worker')
      and public.wehouse_state_key(other.state)=v_rule.state_key
      and public.worker_market_text_key(coalesce(nullif(other.local_government,''),other.city))=v_rule.lga_key
      and public.worker_market_text_key(other.worker_occupation)=v_rule.occupation_key;
  return jsonb_build_object('configured',true,
    'eligible',not v_rule.approvals_paused and (v_rule.hard_limit is null or v_live<v_rule.hard_limit),
    'state',v_rule.state_name,'lga',v_rule.lga_name,'occupation',v_rule.occupation_name,
    'target_count',v_rule.target_count,'hard_limit',v_rule.hard_limit,
    'approvals_paused',v_rule.approvals_paused,'live_count',v_live,
    'remaining',case when v_rule.hard_limit is null then null else greatest(v_rule.hard_limit-v_live,0) end);
end
$$;
revoke all on function public.worker_market_capacity_status(text) from public,anon;
grant execute on function public.worker_market_capacity_status(text) to authenticated,service_role;

commit;
