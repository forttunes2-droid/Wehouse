begin;
set local search_path='';

-- Keep acceptance and revocation in the same Hotel -> membership lock order.
-- Revoking an invitation also withdraws its canonical pending receipt.
create or replace function public.owner_revoke_hotel_team_member(p_membership_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); member public.hotel_team_members;
 hotel public.hotels; actor_caps text[]:=array[]::text[];
begin
 if actor is null then raise exception 'Active Personal account required';end if;
 select h.* into hotel from public.hotels h join public.hotel_team_members m on m.hotel_id=h.hotel_id
 where m.id=p_membership_id for update of h;
 select * into member from public.hotel_team_members where id=p_membership_id for update;
 if member.id is null or hotel.hotel_id is null then raise exception 'Hotel membership not found';end if;
 if hotel.owner_id<>actor then
  actor_caps:=public.current_actor_hotel_capabilities(hotel.hotel_id);
  if not coalesce('hotel.team.manage'=any(actor_caps),false) then raise exception 'Hotel team management access required';end if;
  if member.member_user_id=actor then raise exception 'Delegated managers cannot revoke their own access';end if;
  if not(member.capabilities<@actor_caps) then raise exception 'You cannot revoke a membership above your own hotel access';end if;
 end if;
 update public.resource_invitations set status='revoked',revoked_at=now(),updated_at=now()
 where resource_type='hotel' and resource_id=hotel.hotel_id::text and status='pending'
 and (subject_assignment_id=member.id or intended_user_id=member.member_user_id);
 update public.hotel_team_members set status='revoked',revoked_at=now(),updated_at=now() where id=member.id;
 return true;
end $$;
revoke all on function public.owner_revoke_hotel_team_member(uuid) from public,anon;
grant execute on function public.owner_revoke_hotel_team_member(uuid) to authenticated,service_role;

-- A readable old membership id is not a fresh invitation. All responses now
-- pass through the tracked invitation's expiry, recipient and inviter checks.
create or replace function public.respond_to_hotel_team_invitation(p_membership_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); invitation uuid;
begin
 if actor is null then raise exception 'Active Personal account required';end if;
 select invitation_id into invitation from public.resource_invitations
 where resource_type='hotel' and subject_assignment_id=p_membership_id
 and intended_user_id=actor and status='pending' order by created_at desc limit 1;
 if invitation is null then raise exception 'This invitation is no longer available. Ask the owner to send a new invitation';end if;
 return public.respond_to_resource_invitation(invitation,p_accept,null);
end $$;
revoke all on function public.respond_to_hotel_team_invitation(uuid,boolean) from public,anon;
grant execute on function public.respond_to_hotel_team_invitation(uuid,boolean) to authenticated,service_role;

-- Also close direct calls to the canonical response API, including old links
-- created before a membership was revoked, declined or re-invited.
do $patch$
declare definition text; needle text:=$before$      if v_membership.id is not null and v_membership.status='active' then$before$;
begin
 definition:=replace(pg_catalog.pg_get_functiondef('public.respond_to_resource_invitation(uuid,boolean,text)'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,needle)=0 then raise exception 'Inspect Hotel invitation acceptance authority';end if;
 definition:=replace(definition,needle,$after$      if v_invite.delivery='direct' and (
        v_membership.id is null or v_membership.id is distinct from v_invite.subject_assignment_id
        or v_membership.status<>'invited'
      ) then raise exception 'Hotel access changed; ask the owner to send a new invitation';end if;
      if v_invite.delivery='link' and v_membership.id is not null
         and v_membership.updated_at>v_invite.created_at then
        raise exception 'Hotel access changed; ask the owner to send a new invitation';end if;
$after$||needle);
 execute definition;
end $patch$;

-- Geographic permission is checked against the actual resource in the path,
-- including field-inspection and final-publication paths. Existing Partner and
-- Field permissions remain the other branches of the same Storage policies.
create function private.admin_can_mutate_listing_media(p_bucket text,p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); parts text[]:=string_to_array(p_name,'/');
 key text; resource_id uuid; resource_state text; resource_lga text;
begin
 if actor is null or not public.current_actor_has_workspace('admin',null) then return false;end if;
 if public.user_workspace_covers(actor,'admin',null,null) then return true;end if;
 if p_bucket<>all(array['listing-images','listing-videos','listings']) then return false;end if;
 key:=parts[2];
 if parts[1]='hotels' and key ~ '^[0-9]{1,9}$' then
  select state,city into resource_state,resource_lga from public.hotels where hotel_id=key::integer;
 elsif parts[1]='listings' then
  if key ~ '^(final-|field-inspection-)[0-9a-fA-F-]{36}$' then
   begin resource_id:=regexp_replace(key,'^(final-|field-inspection-)','')::uuid;
   exception when invalid_text_representation then return false;end;
   select property_state,property_city into resource_state,resource_lga from public.inspection_requests where id=resource_id;
  elsif key ~ '^[0-9a-fA-F-]{36}$' then
   begin resource_id:=key::uuid;exception when invalid_text_representation then return false;end;
   select state,city into resource_state,resource_lga from public.listings where id=resource_id;
  else
   select state,city into resource_state,resource_lga from public.listings where listing_id=key;
  end if;
 end if;
 return coalesce(public.user_workspace_covers(actor,'admin',resource_state,resource_lga),false);
end $$;
revoke all on function private.admin_can_mutate_listing_media(text,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_can_mutate_listing_media(text,text) to authenticated;

do $policies$
declare policy record; expression text; replacement text:='private.admin_can_mutate_listing_media(bucket_id,name)';
 needle text:='public.current_actor_has_workspace(''admin''::text, NULL::text)';
begin
 for policy in select * from pg_catalog.pg_policy where polrelid='storage.objects'::regclass
 and polname in('listing_media_insert_authorized','listing_media_update_owner','listing_media_delete_owner_or_creator') loop
  if policy.polqual is not null then
   expression:=pg_catalog.pg_get_expr(policy.polqual,policy.polrelid);
   if strpos(expression,needle)=0 then raise exception 'Inspect listing media read/delete authority';end if;
   execute pg_catalog.format('alter policy %I on storage.objects using (%s)',policy.polname,replace(expression,needle,replacement));
  end if;
  if policy.polwithcheck is not null then
   expression:=pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid);
   if strpos(expression,needle)=0 then raise exception 'Inspect listing media write authority';end if;
   execute pg_catalog.format('alter policy %I on storage.objects with check (%s)',policy.polname,replace(expression,needle,replacement));
  end if;
 end loop;
end $policies$;

-- Refresh the existing compiled INSERT authority after changing its policy.
do $authority$
declare permissive text; restrictive text; signature text; definition text;
begin
 select string_agg('('||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid)||')',' or ' order by polname) filter(where polpermissive),
 string_agg('('||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid)||')',' and ' order by polname) filter(where not polpermissive),
 md5(string_agg(polname||':'||polpermissive::text||':'||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid),E'\n' order by polname))
 into permissive,restrictive,signature from pg_catalog.pg_policy
 where polrelid='storage.objects'::regclass and polcmd in('a','*') and polname<>'wehouse_upload_budget_insert'
 and (polroles @> array[0::oid] or polroles @> array['authenticated'::regrole::oid]);
 if permissive is null then raise exception 'Storage upload authority is missing';end if;
 definition:=pg_catalog.format($fn$
 create or replace function private.can_reserve_storage_upload(p_bucket text,p_name text)
 returns boolean language plpgsql stable security definer set search_path='' as $body$
 declare current_signature text; permitted boolean;
 begin
 select md5(string_agg(polname||':'||polpermissive::text||':'||pg_catalog.pg_get_expr(coalesce(polwithcheck,polqual),polrelid),E'\n' order by polname))
 into current_signature from pg_catalog.pg_policy where polrelid='storage.objects'::regclass and polcmd in('a','*')
 and polname<>'wehouse_upload_budget_insert' and (polroles @> array[0::oid] or polroles @> array['authenticated'::regrole::oid]);
 if current_signature is distinct from %L then raise exception 'Upload permissions need a configuration refresh. Contact support';end if;
 select coalesce(((%s) and (%s)),false) into permitted from (select p_bucket as bucket_id,p_name as name,auth.uid()::text as owner_id) objects;
 return permitted;
 end $body$;
 $fn$,signature,permissive,coalesce(restrictive,'true'));
 execute definition;
end $authority$;

-- A Friendship remains one record and one conversation. Each person's block
-- now has its own timestamp; unblocking cannot withdraw the peer's decision.
alter table public.friends add column user_low_blocked_at timestamptz;
alter table public.friends add column user_high_blocked_at timestamptz;
update public.friends set
 user_low_blocked_at=case when blocked_by=user_low or blocked_by is null then coalesce(updated_at,now()) end,
 user_high_blocked_at=case when blocked_by=user_high or blocked_by is null then coalesce(updated_at,now()) end
where status='blocked';

create or replace function public.block_friend(p_user_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); lo text; hi text; friendship public.friends;
begin
 if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required';end if;
 if p_user_id is null or p_user_id=actor then raise exception 'Choose another person';end if;
 lo:=least(actor,p_user_id);hi:=greatest(actor,p_user_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('friend_bucket:'||lo));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('friend_bucket:'||hi));
 select * into friendship from public.friends where user_low=lo and user_high=hi for update;
 if friendship.id is null then
  insert into public.friends(user_low,user_high,requested_by,status,blocked_by,responded_at,status_before_block,user_low_blocked_at,user_high_blocked_at)
  values(lo,hi,actor,'blocked',actor,now(),'removed',case when actor=lo then now() end,case when actor=hi then now() end);
 else
  update public.friends set
   status_before_block=case when status='blocked' then status_before_block else status end,
   status='blocked',blocked_by=case when status='blocked' then coalesce(blocked_by,actor) else actor end,
   user_low_blocked_at=case when actor=lo then coalesce(user_low_blocked_at,now()) else user_low_blocked_at end,
   user_high_blocked_at=case when actor=hi then coalesce(user_high_blocked_at,now()) else user_high_blocked_at end,
   responded_at=now(),updated_at=now() where id=friendship.id;
 end if;
 return jsonb_build_object('blocked',true);
end $$;

create or replace function public.unblock_friend(p_user_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();lo text;hi text;friendship public.friends;peer_blocks boolean;
begin
 if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Active Personal account required';end if;
 if p_user_id is null or p_user_id=actor then raise exception 'Choose another person';end if;
 lo:=least(actor,p_user_id);hi:=greatest(actor,p_user_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('friend_bucket:'||lo));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('friend_bucket:'||hi));
 select * into friendship from public.friends where user_low=lo and user_high=hi and status='blocked' for update;
 if friendship.id is null or (actor=lo and friendship.user_low_blocked_at is null)
  or (actor=hi and friendship.user_high_blocked_at is null) then return jsonb_build_object('unblocked',false);end if;
 peer_blocks:=case when actor=lo then friendship.user_high_blocked_at is not null else friendship.user_low_blocked_at is not null end;
 update public.friends set
  user_low_blocked_at=case when actor=lo then null else user_low_blocked_at end,
  user_high_blocked_at=case when actor=hi then null else user_high_blocked_at end,
  status=case when peer_blocks then 'blocked' when status_before_block='accepted' then 'accepted' else 'removed' end,
  blocked_by=case when peer_blocks then p_user_id else null end,
  status_before_block=case when peer_blocks then status_before_block else null end,
  responded_at=case when peer_blocks or status_before_block='accepted' then responded_at else null end,
  updated_at=now() where id=friendship.id;
 return jsonb_build_object('unblocked',true,'restored',not peer_blocks and friendship.status_before_block='accepted');
end $$;
revoke all on function public.block_friend(text),public.unblock_friend(text) from public,anon;
grant execute on function public.block_friend(text),public.unblock_friend(text) to authenticated,service_role;

do $list$
declare definition text;needle text:='c.status = ''blocked'' and c.blocked_by = actor';
begin
 definition:=replace(pg_catalog.pg_get_functiondef('public.list_my_friends()'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,needle)=0 then raise exception 'Inspect Friend block-list authority';end if;
 execute replace(definition,needle,'c.status = ''blocked'' and ((c.user_low = actor and c.user_low_blocked_at is not null) or (c.user_high = actor and c.user_high_blocked_at is not null))');
end $list$;
commit;
