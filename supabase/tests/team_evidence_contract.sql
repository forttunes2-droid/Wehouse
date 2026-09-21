\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,assigned_state,assigned_lga,state,city,local_government) values
('77777777-0000-4000-8000-000000000001','team-creator@example.invalid','team-creator','creator',true,null,null,'Nasarawa','Lafia','Lafia'),
('77777777-0000-4000-8000-000000000002','team-admin@example.invalid','team-admin','admin',true,'Nasarawa','Lafia','Nasarawa','Lafia','Lafia'),
('77777777-0000-4000-8000-000000000003','team-staff@example.invalid','team-staff','staff',true,'Nasarawa','Lafia','Nasarawa','Lafia','Lafia'),
('77777777-0000-4000-8000-000000000004','team-outside@example.invalid','team-outside','staff',true,'Nasarawa','Keffi','Nasarawa','Keffi','Keffi'),
('77777777-0000-4000-8000-000000000005','team-revoked@example.invalid','team-revoked','staff',true,'Nasarawa','Lafia','Nasarawa','Lafia','Lafia'),
('77777777-0000-4000-8000-000000000006','team-user@example.invalid','team-user','user',true,null,null,'Nasarawa','Lafia','Lafia'),
('77777777-0000-4000-8000-000000000007','team-partner@example.invalid','team-partner','property_partner',true,null,null,'Nasarawa','Lafia','Lafia');
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city,local_government,worker_status,worker_verified,available) values
('77777777-0000-4000-8000-000000000008','team-worker@example.invalid','team-worker','user',true,'Nasarawa','Lafia','Lafia','verified',true,true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,status) values
('team-creator','creator','global',null,null,'active'),
('team-admin','admin','branch','Nasarawa','Lafia','active'),
('team-staff','staff','branch','Nasarawa','Lafia','active'),
('team-staff','property_operations','branch','Nasarawa','Lafia','active'),
('team-outside','staff','branch','Nasarawa','Keffi','active'),
('team-revoked','staff','branch','Nasarawa','Lafia','revoked'),
('team-partner','property_partner','global',null,null,'active'),
('team-worker','worker','global',null,null,'active');
insert into public.admin_team_authority(admin_user_id,can_manage_staff,created_by,updated_by)
values('team-admin',true,'team-creator','team-creator')
on conflict(admin_user_id) do update set can_manage_staff=true,updated_by='team-creator',updated_at=now();
insert into public.admin_operation_limits(admin_user_id,operation,max_active,created_by,updated_by)
values
('team-admin','property_operations',2,'team-creator','team-creator'),
('team-admin','finance_operations',2,'team-creator','team-creator')
on conflict(admin_user_id,operation) do update set max_active=excluded.max_active,updated_by='team-creator',updated_at=now();
insert into public.staff_permissions(staff_id,permission,is_active,granted_by) values('team-staff','property_operations',true,'team-creator');
insert into public.worker_identity_checks(worker_id,account_role,status,pending_reference_photo_path) values
('team-partner','property_partner','pending_review','team-partner/review.jpg');
insert into storage.objects(bucket_id,name) values('worker-identity-private','team-partner/review.jpg');
insert into public.announcements(id,title,content,sender_id,sender_role,target_type) values
(-920001,'Creator test','Rollback-only fixture','team-creator','creator','all_users'),
(-920002,'Admin test','Rollback-only fixture','team-admin','admin','all_users');
insert into public.announcement_recipients(announcement_id,user_id) values
(-920001,'team-user'),(-920002,'team-partner');
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$ declare rows jsonb; n integer; begin
  perform set_config('request.jwt.claim.sub','77777777-0000-4000-8000-000000000001',true);
  select count(*) into n from public.announcements where id in (-920001,-920002);
  if n<>2 then raise exception 'Active Creator cannot read announcement history'; end if;
  select count(*) into n from public.announcement_recipients where announcement_id in (-920001,-920002);
  if n<>2 then raise exception 'Active Creator cannot read delivery history'; end if;
  rows:=public.get_my_managed_team();
  select (public.creator_get_dashboard_summary()->>'team')::integer into n;
  if n<>2 then raise exception 'Creator team summary counted unassigned or revoked Staff'; end if;
  select count(*) into n from public.get_public_workers(null,null,null) where user_id='team-worker';
  if n<>1 then raise exception 'Creator cannot preview eligible Worker while public marketplace is gated'; end if;
  if not rows @> '[{"user_id":"team-staff","work_areas":["property_operations"]},{"user_id":"team-admin"},{"user_id":"team-outside"}]'::jsonb
    or rows @> '[{"user_id":"team-revoked"}]'::jsonb or rows @> '[{"user_id":"team-user"}]'::jsonb then
    raise exception 'Team list does not reflect active grants';
  end if;
  select count(*) into n from storage.objects where bucket_id='worker-identity-private' and name='team-partner/review.jpg';
  if n<>1 then raise exception 'Creator cannot read assigned private review reference'; end if;
  perform set_config('request.jwt.claim.sub','77777777-0000-4000-8000-000000000002',true);
  select count(*) into n from public.announcements where id in (-920001,-920002);
  if n<>1 or not exists(select 1 from public.announcements where id=-920002) then raise exception 'Admin history escaped own sends'; end if;
  select count(*) into n from public.announcement_recipients where announcement_id in (-920001,-920002);
  if n<>1 then raise exception 'Admin delivery history escaped own sends'; end if;
  rows:=public.get_my_managed_team();
  if not rows @> '[{"user_id":"team-staff"}]'::jsonb or rows @> '[{"user_id":"team-outside"}]'::jsonb or rows @> '[{"user_id":"team-admin"}]'::jsonb then raise exception 'Admin team list escapes branch'; end if;
  begin perform public.manage_staff_permission('team-outside','finance',true,null::uuid);
    raise exception 'Admin changed another branch';
  exception when raise_exception then if sqlerrm<>'Admin cannot change Staff outside the granted coverage' then raise; end if; end;
  perform public.manage_staff_permission('team-staff','finance',true,null::uuid);
  rows:=public.get_my_managed_team();
  if not rows @> '[{"user_id":"team-staff","work_areas":["finance_operations"]}]'::jsonb or rows @> '[{"user_id":"team-staff","work_areas":["property_operations"]}]'::jsonb then raise exception 'Work area replacement was not atomic'; end if;
  perform set_config('request.jwt.claim.sub','77777777-0000-4000-8000-000000000006',true);
  if public.get_my_workspace_access()->'privileged_workspaces'<>'[]'::jsonb then raise exception 'Personal account sees team access'; end if;
  select count(*) into n from public.get_public_workers(null,null,null) where user_id='team-worker';
  if n<>0 then raise exception 'Ordinary account bypassed the public Worker marketplace gate'; end if;
  select count(*) into n from public.announcements where id in (-920001,-920002);
  if n<>1 or not exists(select 1 from public.announcements where id=-920001) then raise exception 'Personal announcement visibility escaped recipient'; end if;
  select count(*) into n from public.announcement_recipients where announcement_id in (-920001,-920002);
  if n<>1 then raise exception 'Personal account sees another delivery'; end if;
  select count(*) into n from storage.objects where bucket_id='worker-identity-private' and name='team-partner/review.jpg';
  if n<>0 then raise exception 'Ordinary account sees private evidence'; end if;
  begin perform public.get_my_managed_team();raise exception 'Ordinary account manages team';
  exception when raise_exception then if sqlerrm<>'Active team management access required' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','77777777-0000-4000-8000-000000000005',true);
  if public.get_my_workspace_access()->'privileged_workspaces'<>'[]'::jsonb then raise exception 'Revoked account sees team access'; end if;
end $$;
reset role;
update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id='team-creator';
set local role authenticated;
do $$ declare n integer; begin
  perform set_config('request.jwt.claim.sub','77777777-0000-4000-8000-000000000001',true);
  select count(*) into n from storage.objects where bucket_id='worker-identity-private' and name='team-partner/review.jpg';
  if n<>0 then raise exception 'Revoked Creator retained evidence access'; end if;
  select count(*) into n from public.announcements where id in (-920001,-920002);
  if n<>0 then raise exception 'Revoked Creator retained announcement history access'; end if;
  select count(*) into n from public.announcement_recipients where announcement_id in (-920001,-920002);
  if n<>0 then raise exception 'Revoked Creator retained recipient access'; end if;
  begin perform public.get_my_managed_team();raise exception 'Revoked Creator manages team';
  exception when raise_exception then if sqlerrm<>'Active team management access required' then raise; end if; end;
end $$;
reset role;
rollback;
