\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at) values
 ('ba290000-0000-4000-8000-000000000001','mfa-boundary-person@example.invalid',now()),
 ('ba290000-0000-4000-8000-000000000002','mfa-boundary-team@example.invalid',now());
insert into public.profiles(auth_id,user_id,email,role,profile_complete) values
 ('ba290000-0000-4000-8000-000000000001','mfa-boundary-person','mfa-boundary-person@example.invalid','user',true),
 ('ba290000-0000-4000-8000-000000000002','mfa-boundary-team','mfa-boundary-team@example.invalid','user',true);
insert into auth.sessions(id,user_id,created_at,updated_at) select id,id,now(),now() from auth.users where email like 'mfa-boundary-%';
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
 ('mfa-boundary-team','admin','global','active'),('mfa-boundary-team','staff','global','active');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"ba290000-0000-4000-8000-000000000001","session_id":"ba290000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","user_metadata":{"role":"creator"}}',true);
set local role authenticated;
do $$begin
 if not public.request_mfa_satisfied() or public.get_my_authentication_requirements()->>'stage'<>'ready' then raise exception 'Optional unenrolled identity blocked or metadata promoted to internal authority';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"ba290000-0000-4000-8000-000000000002","session_id":"ba290000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$begin
 if public.request_mfa_satisfied() or public.get_my_authentication_requirements()->>'stage'<>'setup' then raise exception 'Internal identity accepted without verified authenticator';end if;
 -- Restrictive table policies apply independently of the Data API hook.
 if exists(select 1 from public.profiles where user_id='mfa-boundary-team') then raise exception 'RLS exposed a profile before mandatory setup';end if;
 perform set_config('request.path','/rpc/get_my_authentication_requirements',true);perform public.wehouse_api_request_guard();
 perform set_config('request.path','/rpc/get_my_workspace_access',true);
 begin perform public.wehouse_api_request_guard();raise exception 'API hook allowed missing mandatory factor';exception when sqlstate 'PT403' then null;end;
 begin perform public.auth_session_security_satisfied(auth.uid(),auth.uid(),'aal2');raise exception 'Browser invoked service MFA authority';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local session_replication_role=replica;
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 select id,id,'totp','verified',now(),now() from auth.users where email like 'mfa-boundary-%';
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"ba290000-0000-4000-8000-000000000002","session_id":"ba290000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$begin
 if public.request_mfa_satisfied() or public.get_my_authentication_requirements()->>'stage'<>'challenge' then raise exception 'Verified factor did not require a challenge';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"ba290000-0000-4000-8000-000000000002","session_id":"ba290000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$begin
 if not public.request_mfa_satisfied() or public.get_my_authentication_requirements()->>'stage'<>'ready' then raise exception 'Same verified factor did not satisfy both internal grants';end if;
 perform public.wehouse_api_request_guard();
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"ba290000-0000-4000-8000-000000000001","session_id":"ba290000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$begin if public.request_mfa_satisfied() then raise exception 'Optional enrolled account bypassed its authenticator';end if;end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$begin
 if public.auth_session_security_satisfied('ba290000-0000-4000-8000-000000000002','ba290000-0000-4000-8000-000000000002','aal1') then raise exception 'Service caller accepted primary-only bearer';end if;
 if not public.auth_session_security_satisfied('ba290000-0000-4000-8000-000000000002','ba290000-0000-4000-8000-000000000002','aal2') then raise exception 'Service caller rejected verified factor';end if;
end $$;
reset role;
update auth.sessions set not_after=now()-interval '1 minute' where id='ba290000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"ba290000-0000-4000-8000-000000000002","session_id":"ba290000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
do $$begin begin perform public.get_my_authentication_requirements();raise exception 'Expired session received bootstrap';exception when insufficient_privilege then null;end;end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$begin if not public.request_mfa_satisfied() then raise exception 'Public discovery requires an authenticator';end if;end $$;
reset role;
rollback;
