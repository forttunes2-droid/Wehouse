\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;

insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,account_kind,
  assigned_state,assigned_lga,state,city,local_government,
  worker_status,worker_verified,available
) values
('77777777-6666-4666-8666-000000000001','review-cap-creator@example.invalid','review-cap-creator','creator',true,'consumer',null,null,'Nasarawa','Lafia','Lafia',null,false,false),
('77777777-6666-4666-8666-000000000002','review-cap-reviewer@example.invalid','review-cap-reviewer','staff',true,'consumer','Nasarawa','Lafia','Nasarawa','Lafia','Lafia',null,false,false),
('77777777-6666-4666-8666-000000000003','review-cap-property@example.invalid','review-cap-property','staff',true,'consumer','Nasarawa','Lafia','Nasarawa','Lafia','Lafia',null,false,false),
('77777777-6666-4666-8666-000000000004','review-cap-worker@example.invalid','review-cap-worker','user',true,'consumer',null,null,'Nasarawa','Lafia','Lafia','profile_under_review',false,true);

insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,scope_state,scope_lga,status
) values
('review-cap-creator','creator','global',null,null,'active'),
('review-cap-reviewer','staff','branch','Nasarawa','Lafia','active'),
('review-cap-property','staff','branch','Nasarawa','Lafia','active'),
('review-cap-property','property_operations','branch','Nasarawa','Lafia','active'),
('review-cap-worker','worker','global',null,null,'active'),
('review-cap-worker','property_partner','global',null,null,'active');

insert into public.staff_permissions(
  staff_id,permission,granted_by,granted_at,is_active
) values
('review-cap-reviewer','worker_review','review-cap-creator',now(),true),
('review-cap-property','property_operations','review-cap-creator',now(),true);

insert into public.worker_identity_checks(
  worker_id,account_role,status,pending_reference_photo_path,submitted_at
) values(
  'review-cap-worker','worker','pending_review','review-cap-worker/pending.jpg',now()
);

set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select set_config('request.jwt.claim.sub','77777777-6666-4666-8666-000000000002',true);
do $$
declare n integer;
begin
  if not public.current_staff_has_permission('worker_review') then
    raise exception 'Worker Review capability was not recognized';
  end if;
  if exists(
    select 1 from public.workspace_role_assignments
    where user_id='review-cap-reviewer'
      and workspace_role='worker_operations'
      and status='active'
  ) then
    raise exception 'Worker Review incorrectly requires a Worker Operations workspace';
  end if;
  if not public.current_staff_can_review_worker('review-cap-worker') then
    raise exception 'Worker reviewer could not review canonical Worker workspace';
  end if;
  select count(*) into n
  from public.get_my_staff_worker_reviews('profile_under_review') worker
  where worker.user_id='review-cap-worker';
  if n<>1 then
    raise exception 'Worker with Personal base role was missing from review queue';
  end if;
  if not public.current_actor_can_review_account_identity('review-cap-worker') then
    raise exception 'Worker Review capability could not consume Worker identity review';
  end if;
end $$;

select set_config('request.jwt.claim.sub','77777777-6666-4666-8666-000000000003',true);
do $$
begin
  if public.current_actor_can_review_account_identity('review-cap-worker') then
    raise exception 'Property Operations consumed a Worker identity review';
  end if;
end $$;

reset role;
update public.worker_identity_checks
set account_role='property_partner'
where worker_id='review-cap-worker';
set local role authenticated;

select set_config('request.jwt.claim.sub','77777777-6666-4666-8666-000000000002',true);
do $$
begin
  if public.current_actor_can_review_account_identity('review-cap-worker') then
    raise exception 'Worker Review consumed a Property Partner identity review';
  end if;
end $$;

select set_config('request.jwt.claim.sub','77777777-6666-4666-8666-000000000003',true);
do $$
begin
  if not public.current_actor_can_review_account_identity('review-cap-worker') then
    raise exception 'Property Operations could not consume Property Partner identity review';
  end if;
end $$;

select set_config('request.jwt.claim.sub','77777777-6666-4666-8666-000000000001',true);
do $$
declare team jsonb;
begin
  team:=public.get_my_managed_team();
  if not team @> '[{"user_id":"review-cap-reviewer","work_areas":["worker_review"]}]'::jsonb then
    raise exception 'Creator team projection did not expose Worker Review capability';
  end if;
end $$;

rollback;
