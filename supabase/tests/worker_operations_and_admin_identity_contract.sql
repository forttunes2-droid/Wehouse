\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;

insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,account_kind,
  assigned_state,assigned_lga,state,city,local_government,
  worker_status,worker_verified,available
) values
('77777777-7777-4777-8777-000000000001','ops-admin@example.invalid','ops-admin','admin',true,'consumer','Nasarawa','Lafia','Nasarawa','Lafia','Lafia',null,false,false),
('77777777-7777-4777-8777-000000000002','ops-worker@example.invalid','ops-worker','user',true,'consumer',null,null,'Nasarawa','Lafia','Lafia','profile_under_review',false,true),
('77777777-7777-4777-8777-000000000003','ops-staff@example.invalid','ops-staff','staff',true,'consumer','Nasarawa','Lafia','Nasarawa','Lafia','Lafia',null,false,false),
('77777777-7777-4777-8777-000000000004','ops-property@example.invalid','ops-property','staff',true,'consumer','Nasarawa','Lafia','Nasarawa','Lafia','Lafia',null,false,false);

insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,scope_state,scope_lga,status
) values
('ops-admin','admin','branch','Nasarawa','Lafia','active'),
('ops-worker','worker','global',null,null,'active'),
('ops-worker','property_partner','global',null,null,'active'),
('ops-staff','staff','branch','Nasarawa','Lafia','active'),
('ops-staff','worker_operations','branch','Nasarawa','Lafia','active'),
('ops-property','staff','branch','Nasarawa','Lafia','active'),
('ops-property','property_operations','branch','Nasarawa','Lafia','active');

insert into public.staff_permissions(
  staff_id,permission,granted_by,granted_at,is_active
) values
('ops-staff','worker_operations','ops-admin',now(),true),
('ops-property','property_operations','ops-admin',now(),true);

insert into public.worker_identity_checks(
  worker_id,account_role,status,pending_reference_photo_path,submitted_at
) values(
  'ops-worker','worker','pending_review','ops-worker/pending.jpg',now()
);

set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-000000000001',true);
do $$
declare workers jsonb; partners jsonb; users jsonb; stats jsonb;
begin
  workers:=public.admin_get_my_branch_profiles('worker');
  partners:=public.admin_get_my_branch_profiles('property_partner');
  users:=public.admin_get_my_branch_profiles('user');
  stats:=public.admin_get_my_branch_stats();

  if jsonb_array_length(workers)<>1 then
    raise exception 'Admin Worker projection duplicated or missed the canonical Worker';
  end if;
  if workers->0->>'user_id'<>'ops-worker' then
    raise exception 'Admin Worker projection did not use the Worker workspace';
  end if;
  if jsonb_array_length(partners)<>1
     or partners->0->>'user_id'<>'ops-worker' then
    raise exception 'Multi-workspace Property Partner projection is wrong';
  end if;
  if exists(
    select 1 from jsonb_array_elements(users) row
    where row->>'user_id'='ops-worker'
  ) then
    raise exception 'Worker/Partner was duplicated into regular Users';
  end if;
  if (stats->>'workers')::integer<>1 then
    raise exception 'Worker branch count is not distinct by person';
  end if;
end $$;

select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-000000000003',true);
do $$
declare n integer;
begin
  if not public.current_staff_has_permission('worker_operations') then
    raise exception 'Worker Operations assignment was not recognized';
  end if;
  if not public.current_staff_can_review_worker('ops-worker') then
    raise exception 'Worker Operations could not open canonical Worker work';
  end if;
  select count(*) into n
  from public.get_my_staff_worker_reviews('profile_under_review') worker
  where worker.user_id='ops-worker';
  if n<>1 then
    raise exception 'Worker Operations queue duplicated or missed the Worker';
  end if;
  if not public.current_actor_can_review_account_identity('ops-worker') then
    raise exception 'Worker Operations could not review Worker identity';
  end if;
end $$;

select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-000000000004',true);
do $$
begin
  if public.current_actor_can_review_account_identity('ops-worker') then
    raise exception 'Property Operations received a Worker identity review';
  end if;
end $$;

reset role;
update public.worker_identity_checks
set account_role='property_partner'
where worker_id='ops-worker';
set local role authenticated;

select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-000000000003',true);
do $$
begin
  if public.current_actor_can_review_account_identity('ops-worker') then
    raise exception 'Worker Operations received a Property Partner identity review';
  end if;
end $$;

select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-000000000004',true);
do $$
begin
  if not public.current_actor_can_review_account_identity('ops-worker') then
    raise exception 'Property Operations could not review Property Partner identity';
  end if;
end $$;

rollback;
