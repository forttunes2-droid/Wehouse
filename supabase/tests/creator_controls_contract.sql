\set ON_ERROR_STOP on
begin;
-- All identities and changes in this contract are synthetic and rolled back.
set local session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at,aud,role)
values ('88888888-1111-4111-8111-888888888888','creator-control-a@example.invalid',now(),'authenticated','authenticated'),
('88888888-2222-4222-8222-888888888888','creator-control-b@example.invalid',now(),'authenticated','authenticated');
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind)
values ('88888888-1111-4111-8111-888888888888','creator-control-a@example.invalid','creator-control-a','user',false,'consumer'),
('88888888-2222-4222-8222-888888888888','creator-control-b@example.invalid','creator-control-b','user',false,'consumer');
insert into public.platform_settings(key,value,category,label,data_type,is_active) values('registration_open','true','platform','Registration open','boolean',true),('maintenance_mode','false','platform','Maintenance mode','boolean',true)
on conflict(key) do update set value=excluded.value,is_active=true;
set local session_replication_role=origin;

select set_config('request.jwt.claims','{"sub":"88888888-2222-4222-8222-888888888888","role":"authenticated"}',true);
set local role authenticated;
do $$ declare affected integer; begin
  if has_function_privilege(current_user,'public.bootstrap_first_creator_from_service(uuid,text,text)','execute')
    or has_function_privilege(current_user,'public.get_signup_availability()','execute') then
    raise exception 'Server-only Creator/signup controls exposed to a normal user';
  end if;
  update public.platform_settings set value='false' where key='registration_open';
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'A regular user changed registration'; end if;
end $$;
reset role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ begin
  begin
    perform public.bootstrap_first_creator_from_service('88888888-1111-4111-8111-888888888888','wrong@example.invalid','Rollback-only bootstrap contract');
    raise exception 'FAIL: mismatched identity was accepted';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm not like '%do not match%' then raise; end if; end;
  perform public.bootstrap_first_creator_from_service('88888888-1111-4111-8111-888888888888','creator-control-a@example.invalid','Rollback-only bootstrap contract');
  perform public.bootstrap_first_creator_from_service('88888888-1111-4111-8111-888888888888','creator-control-a@example.invalid','Rollback-only repeat bootstrap contract');
  if (select count(*) from public.workspace_role_assignments where user_id='creator-control-a' and workspace_role='creator' and status='active')<>1 then
    raise exception 'Repeat bootstrap duplicated Creator authority';
  end if;
  if (select account_kind from public.profiles where user_id='creator-control-a')<>'consumer' then raise exception 'Personal identity was lost'; end if;
  begin
    perform public.bootstrap_first_creator_from_service('88888888-2222-4222-8222-888888888888','creator-control-b@example.invalid','Rollback-only second Creator contract');
    raise exception 'FAIL: second Creator was accepted';
  exception when others then if sqlerrm like 'FAIL:%' or sqlerrm not like '%different active Creator%' then raise; end if; end;
  if (select count(*) from public.admin_audit_log where action='FIRST_CREATOR_BOOTSTRAPPED' and target_id='creator-control-a')<>2 then raise exception 'Bootstrap attempts were not audited'; end if;
end $$;
reset role;

select set_config('request.jwt.claims','{"sub":"88888888-1111-4111-8111-888888888888","role":"authenticated"}',true);
set local role authenticated;
update public.platform_settings set value='false' where key='registration_open';
reset role;
do $$ begin
  if public.require_reviewed_legal_signup('{"user":{}}')#>>'{error,message}' <> 'New registrations are currently closed.' then
    raise exception 'Closed registration was not enforced before Auth identity creation';
  end if;
  if not exists(select 1 from public.audit_logs where target_type='platform_settings' and target_id='registration_open' and admin_id='creator-control-a') then
    raise exception 'Creator setting change was not audited';
  end if;
  if not has_function_privilege('supabase_auth_admin','public.get_signup_availability()','execute')
    or has_function_privilege('anon','public.get_signup_availability()','execute') then raise exception 'Signup access reader grants are incorrect'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"88888888-1111-4111-8111-888888888888","role":"authenticated"}',true);
set local role authenticated;
update public.platform_settings set value='true' where key in('registration_open','maintenance_mode');
reset role;
do $$ begin
  if public.require_reviewed_legal_signup('{"user":{}}')#>>'{error,message}' not like '%under maintenance%' then raise exception 'Maintenance did not block new registration'; end if;
end $$;
rollback;
