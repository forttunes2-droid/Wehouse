\set ON_ERROR_STOP on
begin;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,state,city,local_government)
values
('77777777-3333-4333-8333-000000000001','identity-partner@example.invalid','identity-partner','user',true,'consumer','Nasarawa','Lafia','Lafia'),
('77777777-3333-4333-8333-000000000002','identity-workerops@example.invalid','identity-workerops','staff',true,'consumer','Nasarawa','Lafia','Lafia'),
('77777777-3333-4333-8333-000000000003','identity-propertyops@example.invalid','identity-propertyops','staff',true,'consumer','Nasarawa','Lafia','Lafia'),
('77777777-3333-4333-8333-000000000004','services-worker@example.invalid','services-worker','user',true,'consumer','Nasarawa','Lafia','Lafia');

insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,status)
values
('identity-partner','worker','global',null,null,'active'),
('identity-partner','property_partner','global',null,null,'active'),
('identity-workerops','staff','branch','Nasarawa','Lafia','active'),
('identity-workerops','worker_operations','branch','Nasarawa','Lafia','active'),
('identity-propertyops','staff','branch','Nasarawa','Lafia','active'),
('identity-propertyops','property_operations','branch','Nasarawa','Lafia','active'),
('services-worker','worker','global',null,null,'active');

insert into public.worker_identity_checks(worker_id,account_role,status,pending_reference_photo_path,submitted_at)
values('identity-partner','property_partner','pending_review','identity-partner/pending.jpg',now());

update public.platform_settings
set value='false',is_active=true
where key='worker_identity_checks_enabled';

set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select set_config('request.jwt.claim.sub','77777777-3333-4333-8333-000000000001',true);
do $$
declare result jsonb;
begin
  result:=public.create_my_property_access_challenge();
  if result->>'id' is null then
    raise exception 'Partner gate did not open while identity policy is off';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub','77777777-3333-4333-8333-000000000002',true);
do $$
begin
  if public.current_actor_can_review_account_identity('identity-partner') then
    raise exception 'Worker Operations received a Property Partner identity review';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub','77777777-3333-4333-8333-000000000003',true);
do $$
begin
  if not public.current_actor_can_review_account_identity('identity-partner') then
    raise exception 'Property Operations could not review Property Partner identity';
  end if;
end;
$$;

reset role;
update public.worker_identity_checks
set account_role='worker'
where worker_id='identity-partner';
set local role authenticated;

select set_config('request.jwt.claim.sub','77777777-3333-4333-8333-000000000002',true);
do $$
begin
  if not public.current_actor_can_review_account_identity('identity-partner') then
    raise exception 'Worker Operations could not review Worker identity';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub','77777777-3333-4333-8333-000000000003',true);
do $$
begin
  if public.current_actor_can_review_account_identity('identity-partner') then
    raise exception 'Property Operations received a Worker identity review';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub','77777777-3333-4333-8333-000000000004',true);
do $$
declare result jsonb; n integer; skills jsonb;
begin
  result:=public.set_my_worker_services(
    '[
      {"category":"Home repairs","name":"Electrical installation","price":5000,"price_type":"starting_from"},
      {"category":"Home repairs","name":"Socket repair","price":3000,"price_type":"starting_from"},
      {"category":"Technology","name":"CCTV installation","price":8000,"price_type":"starting_from"}
    ]'::jsonb
  );
  if (result->>'count')::integer<>3 then
    raise exception 'Worker service count is wrong';
  end if;
  select count(*) into n
  from public.worker_services
  where worker_id='services-worker';
  if n<>3 then
    raise exception 'Canonical Worker services were not saved';
  end if;
  select worker_skills into skills
  from public.profiles
  where user_id='services-worker';
  if not (skills ? 'Electrical installation' and skills ? 'CCTV installation') then
    raise exception 'Worker search metadata was not synchronized';
  end if;
end;
$$;

rollback;
