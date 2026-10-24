CREATE OR REPLACE FUNCTION public.create_property_cohost_invitation(p_listing_id uuid, p_identifier text DEFAULT NULL::text, p_delivery text DEFAULT 'direct'::text, p_access_level text DEFAULT 'operations'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_actor text:=public.current_profile_user_id();
  v_listing public.listings;
  v_target public.profiles;
  v_assignment public.property_host_assignments;
  v_invite public.resource_invitations;
  v_token text;
  v_identifier text:=btrim(regexp_replace(coalesce(p_identifier,''),'^@','','g'));
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  if not public.user_has_active_workspace(v_actor,'property_partner') then raise exception 'Active Property Partner access required'; end if;
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
    if exists(select 1 from public.property_host_assignments a
      where a.listing_id=p_listing_id and a.user_id=v_target.user_id
        and a.status='active') then
      raise exception 'This person is already an active co-host. Manage their existing assignment.';
    end if;
    select i.* into v_invite from public.resource_invitations i
      join public.property_host_assignments a on a.assignment_id=i.subject_assignment_id
      where i.resource_type='property' and i.resource_id=p_listing_id::text
        and i.role_key='property_cohost' and i.delivery='direct'
        and i.intended_user_id=v_target.user_id and i.status='pending' and i.expires_at>now()
        and i.permission_profile=p_access_level and a.status='invited'
        and a.access_level=p_access_level
      order by i.created_at desc limit 1;
    if v_invite.invitation_id is not null then
      return jsonb_build_object('invitation_id',v_invite.invitation_id,'delivery','direct',
        'recipient_user_id',v_target.user_id,
        'recipient_name',coalesce(v_target.full_name,v_target.username,'WeHouse member'),
        'status','pending','reused',true);
    end if;


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
$function$
;
