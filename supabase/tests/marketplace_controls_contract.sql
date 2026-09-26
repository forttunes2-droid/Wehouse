\set ON_ERROR_STOP on
begin;

-- Test-invitation, hosting-help and market-capacity changes with isolated rows.
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,username,role,profile_complete,full_name,account_kind,
  worker_status,worker_verified,state,local_government,worker_occupation)
values
 ('f6100000-0000-4000-8000-000000000001','mkt-owner@example.invalid','mkt-owner','market-owner','user',true,'Market Owner','consumer',null,false,'Lagos','Ikeja',''),
 ('f6100000-0000-4000-8000-000000000002','mkt-host@example.invalid','mkt-host','market-host','user',true,'Market Host','consumer',null,false,'Lagos','Ikeja',''),
 ('f6100000-0000-4000-8000-000000000003','mkt-guest@example.invalid','mkt-guest','market-guest','user',true,'Market Guest','consumer',null,false,'Lagos','Ikeja',''),
 ('f6100000-0000-4000-8000-000000000004','mkt-former-owner@example.invalid','mkt-former-owner','former-owner','user',true,'Former Owner','consumer',null,false,'Lagos','Ikeja',''),
 ('f6100000-0000-4000-8000-000000000005','mkt-hotel-owner@example.invalid','mkt-hotel-owner','market-hotel-owner','user',true,'Hotel Owner','consumer',null,false,'Lagos','Ikeja',''),
 ('f6100000-0000-4000-8000-000000000006','mkt-hotel-manager@example.invalid','mkt-hotel-manager','market-hotel-manager','user',true,'Hotel Manager','consumer',null,false,'Lagos','Ikeja',''),
 ('f6100000-0000-4000-8000-000000000007','mkt-hotel-target@example.invalid','mkt-hotel-target','hotel-target','user',true,'Hotel Target','consumer',null,false,'Lagos','Ikeja',''),
 ('f6100000-0000-4000-8000-000000000008','mkt-worker-a@example.invalid','mkt-worker-a','worker-a','user',true,'Worker A','consumer','verified',true,'Lagos','Ikeja','Plumber'),
 ('f6100000-0000-4000-8000-000000000009','mkt-worker-b@example.invalid','mkt-worker-b','worker-b','user',true,'Worker B','consumer','profile_under_review',false,'Lagos','Ikeja','Plumber');

insert into public.listings(
  id,listing_id,title,sub_type,state,city,status,availability_status,approved_at,
  owner_id,partner_id,management_mode,wehouse_management_status,management_updated_at,
  management_host_user_id
) values
 ('f6100000-1000-4000-8000-000000000001','mkt-hosted-home','Hosted home','short_let','Lagos','Ikeja','available','available',now(),
  'mkt-owner','mkt-owner','host','not_required',now(),'mkt-host'),
 ('f6100000-1000-4000-8000-000000000002','mkt-unassigned-home','Public home','short_let','Lagos','Ikeja','available','available',now(),
  'mkt-owner','mkt-owner','host','not_required',now(),'mkt-host');
insert into public.property_host_assignments(
  assignment_id,listing_id,user_id,assignment_role,status,invited_by,accepted_at,access_level
) values
 ('f6100000-2000-4000-8000-000000000001','f6100000-1000-4000-8000-000000000001','mkt-owner','owner','active','mkt-owner',now(),'full_hosting'),
 ('f6100000-2000-4000-8000-000000000002','f6100000-1000-4000-8000-000000000001','mkt-host','manager','active','mkt-owner',now(),'operations');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values('mkt-worker-a','worker','global','active'),('mkt-worker-b','worker','global','active');
insert into public.hotels(hotel_id,name,state,city,owner_id,status,approved_at)
values(-76101,'Market Hotel','Lagos','Ikeja','mkt-hotel-owner','active',now());
insert into public.hotel_team_members(hotel_id,member_user_id,hotel_role,status,capabilities,invited_by,revoked_at)
values(-76101,'mkt-hotel-manager','manager','revoked',array['hotel.team.manage','stay.read'],'mkt-hotel-owner',now());
insert into public.resource_invitations(
  invitation_id,resource_type,resource_id,role_key,permission_profile,delivery,
  inviter_user_id,intended_user_id,token_hash,status,expires_at
) values
 ('f6100000-3000-4000-8000-000000000001','property','f6100000-1000-4000-8000-000000000001',
  'property_cohost','operations','direct','mkt-owner','mkt-owner',null,'pending',now()+interval '1 day'),
 ('f6100000-3000-4000-8000-000000000002','property','f6100000-1000-4000-8000-000000000001',
  'property_cohost','operations','direct','mkt-host','mkt-guest',null,'pending',now()+interval '1 day'),
 ('f6100000-3000-4000-8000-000000000003','hotel','-76101',
  'hotel_manager','manager','direct','mkt-hotel-manager','mkt-hotel-target',null,'pending',now()+interval '1 day'),
 ('f6100000-3000-4000-8000-000000000004','property','f6100000-1000-4000-8000-000000000001',
  'property_cohost','operations','link','mkt-owner',null,public._invitation_token_hash('market-preview-token'),'pending',now()+interval '1 day');

insert into public.worker_market_capacity(
  state_name,state_key,lga_name,lga_key,occupation_name,occupation_key,
  target_count,hard_limit,approvals_paused,updated_by
) values('Lagos',public.wehouse_state_key('Lagos'),'Ikeja',public.worker_market_text_key('Ikeja'),
  'Plumber',public.worker_market_text_key('Plumber'),1,1,false,'mkt-owner');
set local session_replication_role=origin;

-- Owners and existing co-hosts cannot be converted to pending assignments.
do $$ begin
  begin
    update public.property_host_assignments set assignment_role='manager',status='invited'
    where assignment_id='f6100000-2000-4000-8000-000000000001';
    raise exception 'Owner assignment downgrade unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm not like 'A property owner assignment cannot be replaced%' then raise; end if;
  end;
  begin
    update public.property_host_assignments set status='invited'
    where assignment_id='f6100000-2000-4000-8000-000000000002';
    raise exception 'Active co-host downgrade unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm not like 'An active co-host must be revoked%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
  begin
    perform public.respond_to_resource_invitation('f6100000-3000-4000-8000-000000000001',true,null);
    raise exception 'Owner self-acceptance unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm not like 'A property owner cannot accept a co-host invitation%' then raise; end if;
  end;
  begin
    perform public.create_property_cohost_invitation(
      'f6100000-1000-4000-8000-000000000001','market-host','direct','operations');
    raise exception 'Re-inviting an active co-host unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm not like 'An active co-host must be revoked%' then raise; end if;
  end;
  if (select assignment_role from public.property_host_assignments
      where assignment_id='f6100000-2000-4000-8000-000000000001')<>'owner'
    or (select status from public.property_host_assignments
      where assignment_id='f6100000-2000-4000-8000-000000000002')<>'active' then
    raise exception 'A guarded invitation changed an existing assignment';
  end if;
end $$;
reset role;

-- Only the currently assigned Host sees their property target; the same person
-- cannot open Hosting support on another public listing.
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare help jsonb; begin
  help:=public.get_my_hosting_help_targets();
  if jsonb_array_length(help->'properties')<>1
     or help->'properties'->0->>'subject_id'<>'f6100000-1000-4000-8000-000000000001'
     or jsonb_array_length(help->'payment_targets')<>0 then
    raise exception 'Hosting Help projection crossed assignment or finance scope';
  end if;
  begin
    perform public.open_property_operations_conversation('listing',
      'f6100000-1000-4000-8000-000000000002',
      jsonb_build_object('requester_workspace','hosting'));
    raise exception 'Hosting Help opened an unassigned public property';
  exception when raise_exception then
    if sqlerrm not like 'Active Hosting assignment is required%' then raise; end if;
  end;
  if public.get_my_workspace_inbox('hosting','wehouse') is null then
    raise exception 'Hosting Inbox projection returned null';
  end if;
end $$;
reset role;

-- The inviter's hotel authority is rechecked at response time.
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000007',true);
set local role authenticated;
do $$ begin
  begin
    perform public.respond_to_resource_invitation('f6100000-3000-4000-8000-000000000003',true,null);
    raise exception 'A removed hotel manager invitation was accepted';
  exception when raise_exception then
    if sqlerrm not like 'The inviter no longer has hotel team-management access%' then raise; end if;
  end;
end $$;
reset role;

-- Token previews are public only through their high-entropy link token and
-- disclose a small resource card. Revoked links stop resolving immediately.
set local role anon;
do $$ declare preview jsonb; begin
  preview:=public.preview_resource_invitation('market-preview-token');
  if preview->>'valid'<>'true' or preview ?| array['owner_id','payment_reference','booking_code','token_hash'] then
    raise exception 'Invitation preview leaked private fields or rejected a valid token';
  end if;
end $$;
reset role;
update public.resource_invitations set status='revoked',revoked_at=now()
  where invitation_id='f6100000-3000-4000-8000-000000000004';
set local role anon;
do $$ declare preview jsonb; begin
  preview:=public.preview_resource_invitation('market-preview-token');
  if preview<>jsonb_build_object('valid',false) then raise exception 'Revoked preview token remained usable'; end if;
end $$;
reset role;

-- A hard cap blocks both verification and already-verified Workspace reactivation.
do $$ begin
  begin
    update public.profiles set worker_status='verified',worker_verified=true where user_id='mkt-worker-b';
    raise exception 'Worker verification exceeded the hard market cap';
  exception when raise_exception then
    if sqlerrm not like '%capacity is full%' then raise; end if;
  end;
  insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,account_kind,
    worker_status,worker_verified,state,local_government,worker_occupation)
  values('f6100000-0000-4000-8000-000000000010','mkt-worker-c@example.invalid','mkt-worker-c',
    'user',true,'Worker C','consumer','verified',true,'Lagos','Ikeja','Plumber');
  begin
    insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
    values('mkt-worker-c','worker','global','active');
    raise exception 'Worker reactivation exceeded the hard market cap';
  exception when raise_exception then
    if sqlerrm not like '%capacity is full%' then raise; end if;
  end;
end $$;

-- Capacity status cannot be used by a different account to inspect a Worker.
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000009',true);
set local role authenticated;
do $$ begin
  begin
    perform public.worker_market_capacity_status('mkt-worker-a');
    raise exception 'Cross-account capacity status unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm not like 'Worker capacity status is available only to that Worker or Creator%' then raise; end if;
  end;
end $$;
reset role;

rollback;
