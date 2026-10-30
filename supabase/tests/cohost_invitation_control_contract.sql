begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,username,role,profile_complete) values
('f7440000-0000-4000-8000-000000000001','cohost-owner@example.invalid','cohost-owner','cohost-owner','user',true),
('f7440000-0000-4000-8000-000000000002','cohost-active@example.invalid','cohost-active','cohost-active','user',true),
('f7440000-0000-4000-8000-000000000003','cohost-target@example.invalid','cohost-target','cohost-target','user',true),
('f7440000-0000-4000-8000-000000000004','cohost-other@example.invalid','cohost-other','cohost-other','user',true);
insert into auth.sessions(id,user_id,created_at,updated_at) values
('f7440000-1000-4000-8000-000000000001','f7440000-0000-4000-8000-000000000001',now(),now()),
('f7440000-1000-4000-8000-000000000004','f7440000-0000-4000-8000-000000000004',now(),now());
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select p.user_id,p.auth_id,s.id::text,'cohost-contract-'||p.user_id,'Synthetic contract browser',true,'trusted'
from public.profiles p join auth.sessions s on s.user_id::text=p.auth_id
where p.user_id in('cohost-owner','cohost-other');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values('cohost-owner','property_partner','global','active'),
 ('cohost-other','property_partner','global','active');
insert into public.listings(id,listing_id,title,sub_type,state,city,status,availability_status,owner_id,partner_id,approved_at,management_mode,management_updated_at,management_host_user_id)
values('f7440000-2000-4000-8000-000000000001','cohost-control-home','Co-host control home','short_let','Lagos','Ikeja','available','available','cohost-owner','cohost-owner',now(),'host',now(),'cohost-owner');
insert into public.property_host_assignments(assignment_id,listing_id,user_id,assignment_role,status,invited_by,accepted_at,access_level) values
('f7440000-3000-4000-8000-000000000001','f7440000-2000-4000-8000-000000000001','cohost-owner','owner','active','cohost-owner',now(),'full_hosting'),
('f7440000-3000-4000-8000-000000000002','f7440000-2000-4000-8000-000000000001','cohost-active','manager','active','cohost-owner',now(),'operations');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','f7440000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"f7440000-0000-4000-8000-000000000001","session_id":"f7440000-1000-4000-8000-000000000001"}',true);
set local role authenticated;
do $$ declare first_invite jsonb; second_invite jsonb; changed_invite jsonb;
begin
  begin
    perform public.create_property_cohost_invitation('f7440000-2000-4000-8000-000000000001','cohost-active','direct','full_hosting');
    raise exception 'FAIL: active co-host was reinvited';
  exception when others then
    if sqlerrm not like 'This person is already an active co-host.%' then raise; end if;
  end;
  first_invite:=public.create_property_cohost_invitation('f7440000-2000-4000-8000-000000000001','cohost-target','direct','operations');
  second_invite:=public.create_property_cohost_invitation('f7440000-2000-4000-8000-000000000001','cohost-target','direct','operations');
  if first_invite->>'invitation_id' is null or first_invite->>'invitation_id' is distinct from second_invite->>'invitation_id'
    or second_invite->>'status' is distinct from 'pending' or second_invite->>'reused' is distinct from 'true' then
    raise exception 'FAIL: repeated direct invitation did not reuse its receipt';
  end if;
  perform set_config('test.cohost_first_invite',first_invite->>'invitation_id',true);
  changed_invite:=public.create_property_cohost_invitation('f7440000-2000-4000-8000-000000000001','cohost-target','direct','full_hosting');
  if changed_invite->>'invitation_id' is null or changed_invite->>'invitation_id'=first_invite->>'invitation_id' then
    raise exception 'FAIL: changed pending permission did not create a replacement invitation';
  end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.property_host_assignments where assignment_id='f7440000-3000-4000-8000-000000000002'
    and status='active' and access_level='operations' and accepted_at is not null) then raise exception 'FAIL: active access changed'; end if;
  if (select count(*) from public.resource_invitations where resource_id='f7440000-2000-4000-8000-000000000001' and intended_user_id='cohost-target')<>2 then raise exception 'FAIL: repeated request duplicated invitations'; end if;
  if (select count(*) from public.resource_invitations where resource_id='f7440000-2000-4000-8000-000000000001' and intended_user_id='cohost-target' and status='pending')<>1 then raise exception 'FAIL: replacement left competing pending invitations'; end if;
  if (select count(*) from public.notifications where event_key='resource-invite:'||current_setting('test.cohost_first_invite'))<>1 then raise exception 'FAIL: repeated request duplicated notification'; end if;
end $$;
select set_config('request.jwt.claim.sub','f7440000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"f7440000-0000-4000-8000-000000000004","session_id":"f7440000-1000-4000-8000-000000000004"}',true);
set local role authenticated;
do $$ begin
  begin
    perform public.create_property_cohost_invitation('f7440000-2000-4000-8000-000000000001','cohost-target','direct','operations');
    raise exception 'FAIL: outsider created a co-host invitation';
  exception when others then
    if sqlerrm not like 'Only the property owner can invite a co-host%' then raise; end if;
  end;
end $$;
reset role;
rollback;
