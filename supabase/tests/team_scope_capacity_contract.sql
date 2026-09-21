\set ON_ERROR_STOP on
begin;

-- Synthetic Personal identities only. Every row rolls back.
set local session_replication_role=replica;

insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,account_kind,state,city,local_government
) values
('77777777-6000-4000-8000-000000000001','team-scope-state-admin@example.invalid','team-scope-state-admin','user',true,'consumer','Nasarawa','Lafia','Lafia'),
('77777777-6000-4000-8000-000000000002','team-scope-lga-admin@example.invalid','team-scope-lga-admin','user',true,'consumer','Nasarawa','Lafia','Lafia'),
('77777777-6000-4000-8000-000000000003','team-scope-disabled-admin@example.invalid','team-scope-disabled-admin','user',true,'consumer','Nasarawa','Lafia','Lafia'),
('77777777-6000-4000-8000-000000000011','team-scope-staff-a@example.invalid','team-scope-staff-a','user',true,'consumer','Nasarawa','Lafia','Lafia'),
('77777777-6000-4000-8000-000000000012','team-scope-staff-b@example.invalid','team-scope-staff-b','user',true,'consumer','Nasarawa','Keffi','Keffi'),
('77777777-6000-4000-8000-000000000013','team-scope-staff-c@example.invalid','team-scope-staff-c','user',true,'consumer','Nasarawa','Keffi','Keffi');

insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,scope_state,scope_lga,status
) values
('team-scope-state-admin','admin','state','Nasarawa',null,'active'),
('team-scope-lga-admin','admin','branch','Nasarawa','Lafia','active'),
('team-scope-disabled-admin','admin','state','Nasarawa',null,'active');

insert into public.admin_team_authority(admin_user_id,can_manage_staff)
values
('team-scope-state-admin',true),
('team-scope-lga-admin',true),
('team-scope-disabled-admin',false);

insert into public.admin_operation_limits(admin_user_id,operation,max_active)
values
('team-scope-state-admin','property_operations',1),
('team-scope-state-admin','worker_operations',2),
('team-scope-lga-admin','property_operations',2),
('team-scope-disabled-admin','property_operations',10);

set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

-- State Admin may grant State or narrower LGA Staff coverage.
select set_config('request.jwt.claim.sub','77777777-6000-4000-8000-000000000001',true);
do $$
declare authority jsonb; result jsonb;
begin
  authority:=public.get_admin_team_authority();
  if authority->>'scope_type'<>'state'
     or authority->>'state'<>'Nasarawa'
     or authority->>'lga' is not null
     or not (authority->>'can_manage_staff')::boolean then
    raise exception 'State Admin authority projection is wrong';
  end if;

  result:=public.admin_appoint_staff(
    'team-scope-staff-a','property_operations','state','Nasarawa',null
  );
  if result->>'scope_type'<>'state' then
    raise exception 'State Staff grant was reduced to one LGA';
  end if;

  begin
    perform public.admin_appoint_staff(
      'team-scope-staff-b','property_operations','branch','Nasarawa','Keffi'
    );
    raise exception 'Operation capacity was bypassed';
  exception when raise_exception then
    if sqlerrm not like 'Operation capacity reached%' then raise; end if;
  end;

  result:=public.admin_appoint_staff(
    'team-scope-staff-b','worker_operations','branch','Nasarawa','Keffi'
  );
  if result->>'lga'<>'Keffi' then
    raise exception 'State Admin could not delegate one LGA';
  end if;

  perform public.manage_staff_permission(
    'team-scope-staff-a','worker_operations',true,null::uuid
  );
end
$$;

-- Branch Admin cannot widen itself or a child assignment beyond Lafia.
select set_config('request.jwt.claim.sub','77777777-6000-4000-8000-000000000002',true);
do $$
begin
  begin
    perform public.admin_appoint_staff(
      'team-scope-staff-c','property_operations','branch','Nasarawa','Keffi'
    );
    raise exception 'LGA Admin escaped into another LGA';
  exception when raise_exception then
    if sqlerrm<>'Admin cannot assign Staff outside the granted coverage' then raise; end if;
  end;

  begin
    perform public.admin_appoint_staff(
      'team-scope-staff-c','property_operations','state','Nasarawa',null
    );
    raise exception 'LGA Admin widened Staff to State';
  exception when raise_exception then
    if sqlerrm<>'Admin cannot assign Staff outside the granted coverage' then raise; end if;
  end;

  begin
    perform public.admin_update_role('team-scope-staff-c','admin');
    raise exception 'Admin used legacy role mutation';
  exception when raise_exception then
    if sqlerrm<>'Internal access is managed with workspace grants, not profile roles' then raise; end if;
  end;
end
$$;

-- Team management is opt-in. An Admin grant alone is not enough.
select set_config('request.jwt.claim.sub','77777777-6000-4000-8000-000000000003',true);
do $$
begin
  begin
    perform public.admin_appoint_staff(
      'team-scope-staff-c','property_operations','state','Nasarawa',null
    );
    raise exception 'Admin without delegation added Staff';
  exception when raise_exception then
    if sqlerrm<>'Creator has not granted Team management to this Admin' then raise; end if;
  end;

  begin
    insert into public.admin_operation_limits(admin_user_id,operation,max_active)
    values('team-scope-disabled-admin','worker_operations',999);
    raise exception 'Admin directly changed its own capacity table';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

do $$
declare n integer;
begin
  if not public.user_workspace_covers(
    'team-scope-staff-a','worker_operations','Nasarawa','Keffi'
  ) then
    raise exception 'Whole-State Staff does not cover another LGA in the State';
  end if;

  if public.user_has_active_workspace('team-scope-staff-a','property_operations')
     or not public.user_has_active_workspace('team-scope-staff-a','worker_operations') then
    raise exception 'Changing Operation did not atomically replace the previous Operation';
  end if;

  if not public.user_workspace_covers(
    'team-scope-staff-b','worker_operations','Nasarawa','Keffi'
  ) or public.user_workspace_covers(
    'team-scope-staff-b','worker_operations','Nasarawa','Lafia'
  ) then
    raise exception 'One-LGA Staff coverage is not exact';
  end if;

  select count(*) into n
  from public.profiles
  where user_id in(
    'team-scope-state-admin','team-scope-lga-admin','team-scope-disabled-admin',
    'team-scope-staff-a','team-scope-staff-b','team-scope-staff-c'
  )
    and role='user';
  if n<>6 then
    raise exception 'Workspace grants rewrote Personal profile roles';
  end if;
end
$$;

rollback;
