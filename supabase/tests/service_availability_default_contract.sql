-- Real trusted commands, synthetic identities, no provider calls or data erasure.
begin;
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('99700000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','privacy-'||n||'@example.invalid',now(),now() from generate_series(1,3)n;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city,local_government)
select '99700000-0000-4000-8000-00000000000'||n,'privacy-'||n||'@example.invalid','privacy-'||n,'user',true,'Nasarawa','Lafia','Lafia' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,updated_at)
select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('privacy-1','privacy-2','privacy-3');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,auth_id,'privacy-contract-'||user_id,'Synthetic trusted browser',true,'trusted' from public.profiles where user_id in('privacy-1','privacy-2','privacy-3');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values('privacy-3','creator','global','active');
insert into public.creator_elevation_grants(creator_elevation_id,creator_user_id,auth_user_id,auth_session_id,action_classes,expires_at,verification_method)
values('99700000-9000-4000-8000-000000000001','privacy-3','99700000-0000-4000-8000-000000000003','99700000-0000-4000-8000-000000000003',array['all_sensitive'],now()+interval '5 minutes','password');
set local session_replication_role=origin;

-- Exercise the real migration in both upgrade states, with no persisted change.
update public.platform_settings set value='false',is_active=true where key='worker_marketplace_launch_enabled';
do $$begin if exists(select 1 from public.admin_audit_log where action='creator_worker_marketplace' and target_id='worker_marketplace_launch_enabled') then raise exception 'This fixture requires no pre-existing availability decisions';end if;end $$;
\ir ../migrations/20261030173404_default_reviewed_services_to_available.sql
do $$begin if not exists(select 1 from public.platform_settings where key='worker_marketplace_launch_enabled' and value='true' and is_active) then raise exception 'Seeded startup lock was not removed';end if;end $$;
select set_config('request.jwt.claims','{"sub":"99700000-0000-4000-8000-000000000003","session_id":"99700000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select public.creator_set_worker_marketplace(false,'Synthetic deliberate incident pause','99700000-9000-4000-8000-000000000001');
reset role;
\ir ../migrations/20261030173404_default_reviewed_services_to_available.sql
do $$begin if not exists(select 1 from public.platform_settings where key='worker_marketplace_launch_enabled' and value='false') then raise exception 'Deliberate operational pause was overwritten';end if;end $$;
rollback;
select 'Seeded lock is removed without a Creator launch step; an audited operational pause is preserved; fixtures rolled back' result;

