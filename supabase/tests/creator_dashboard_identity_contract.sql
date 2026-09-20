\set ON_ERROR_STOP on
begin;
-- Test-only identities. No authentication accounts, photos or money are created.
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,state,city,local_government)
select '77777777-2222-4222-8222-'||lpad(n::text,12,'0'),
  'creator-dashboard-'||name||'@example.invalid','creator-dashboard-'||name,
  'user',true,'consumer','Nasarawa','Lafia','Lafia'
from (values(1,'owner'),(2,'provider'),(3,'team'),(4,'outsider'),(5,'other-lga')) f(n,name);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values('creator-dashboard-owner','creator','global','active'),
  ('creator-dashboard-provider','worker','global','active'),
  ('creator-dashboard-provider','property_partner','global','active'),
  ('creator-dashboard-team','staff','global','active'),
  ('creator-dashboard-team','admin','branch','active'),
  ('creator-dashboard-other-lga','worker','global','active'),
  ('creator-dashboard-owner','worker','global','active');
update public.workspace_role_assignments set scope_state='Nasarawa',scope_lga='Lafia'
where user_id='creator-dashboard-team';
update public.profiles set city='Keffi',local_government='Keffi' where user_id='creator-dashboard-other-lga';
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','77777777-2222-4222-8222-000000000001',true);
set local role authenticated;
do $$
declare summary jsonb; people jsonb; policy jsonb;
begin
  summary:=public.creator_get_dashboard_summary();
  if (summary->>'workers')::int<1 or (summary->>'partners')::int<1 or (summary->>'team')::int<1 then
    raise exception 'Additive workspaces missing from Creator summary';
  end if;
  perform set_config('test.creator_team_count',summary->>'team',true);
  people:=public.creator_get_people('worker');
  if not exists(select 1 from jsonb_array_elements(people) p where p->>'user_id'='creator-dashboard-provider') then
    raise exception 'Provider with Personal base role missing';
  end if;
  if exists(select 1 from jsonb_array_elements(people) p where p ? 'auth_id' or p ? 'creator_auth_password' or p ? 'worker_gov_id_url') then
    raise exception 'Private authentication/ID fields exposed';
  end if;
  people:=public.creator_get_people('property_partner');
  if not exists(select 1 from jsonb_array_elements(people) p where p->>'user_id'='creator-dashboard-provider') then
    raise exception 'Partner grant hidden by Personal base role';
  end if;
  policy:=public.get_staff_worker_identity_check('creator-dashboard-provider');
  if policy->>'identity_required'<>'false' or policy->>'identity_gate_satisfied'<>'true'
    or policy->>'identity_current'<>'false' then
    raise exception 'Disabled face policy blocked review or invented a passed face check';
  end if;
  if public.current_actor_can_review_account_identity('creator-dashboard-owner') then
    raise exception 'Creator could review their own identity';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub','77777777-2222-4222-8222-000000000003',true);
do $$
begin
  if not public.current_actor_can_review_account_identity('creator-dashboard-provider') then
    raise exception 'Branch Admin could not review their assigned LGA';
  end if;
  if public.current_actor_can_review_account_identity('creator-dashboard-other-lga') then
    raise exception 'Branch Admin reviewed another LGA';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub','77777777-2222-4222-8222-000000000001',true);
reset role;
update public.workspace_role_assignments set status='revoked',revoked_at=now()
where user_id='creator-dashboard-team' and workspace_role='staff';
set local role authenticated;
do $$
begin
  if public.creator_get_dashboard_summary()->>'team'<>current_setting('test.creator_team_count') then
    raise exception 'A dual-grant team member was double counted';
  end if;
end;
$$;
reset role;
update public.workspace_role_assignments set status='revoked',revoked_at=now()
where user_id='creator-dashboard-provider' and workspace_role='worker';
set local role authenticated;
do $$
begin
  if exists(select 1 from jsonb_array_elements(public.creator_get_people('worker')) p where p->>'user_id'='creator-dashboard-provider') then
    raise exception 'Revoked provider still listed';
  end if;
end;
$$;
-- An ordinary account must never read Creator counts or personal records.
select set_config('request.jwt.claim.sub','77777777-2222-4222-8222-000000000004',true);
do $$
declare denied boolean:=false;
begin
  begin perform public.creator_get_dashboard_summary(); exception when others then denied:=sqlerrm='Active Creator workspace required'; end;
  if not denied then raise exception 'Ordinary user read Creator summary'; end if;
  denied:=false;
  begin perform public.creator_get_people(); exception when others then denied:=sqlerrm='Active Creator workspace required'; end;
  if not denied then raise exception 'Ordinary user read Creator people'; end if;
  denied:=false;
  begin perform public.get_staff_worker_identity_check('creator-dashboard-provider'); exception when others then denied:=sqlerrm='Identity review is outside your authority'; end;
  if not denied then raise exception 'Ordinary user read private identity evidence'; end if;
end;
$$;
reset role;
update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id='creator-dashboard-owner';
select set_config('request.jwt.claim.sub','77777777-2222-4222-8222-000000000001',true);
set local role authenticated;
do $$
declare denied boolean:=false;
begin
  begin perform public.creator_get_dashboard_summary(); exception when others then denied:=sqlerrm='Active Creator workspace required'; end;
  if not denied then raise exception 'Revoked Creator kept dashboard access'; end if;
  if public.current_actor_can_review_account_identity('creator-dashboard-provider') then
    raise exception 'Revoked Creator retained private review authority';
  end if;
end;
$$;
reset role;
do $$
begin
  if has_function_privilege('anon','public.creator_get_dashboard_summary()','EXECUTE')
    or has_function_privilege('anon','public.creator_get_people(text)','EXECUTE') then
    raise exception 'Anonymous Creator API access';
  end if;
end;
$$;
rollback;
