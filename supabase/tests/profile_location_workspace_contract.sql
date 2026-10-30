begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon;
set local session_replication_role=replica;
insert into auth.users(id,email) values('c5300000-0000-4000-8000-000000000001','profile-contract@example.invalid');
insert into public.profiles(user_id,auth_id,email,username,full_name,role,account_kind,profile_complete,country,state,city,local_government)
values('profile-contract','c5300000-0000-4000-8000-000000000001','profile-contract@example.invalid','profile_contract','Before save','user','consumer',true,'Ghana',null,null,null);
insert into auth.sessions(id,user_id,created_at,updated_at) values('c5300000-0000-4000-8000-000000000001','c5300000-0000-4000-8000-000000000001',now(),now());
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
values('profile-contract','c5300000-0000-4000-8000-000000000001','c5300000-0000-4000-8000-000000000001','profile-contract-browser','Synthetic trusted browser',true,'trusted');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values('profile-contract','worker','global');
insert into public.service_categories(id,name,is_active) values('c5300000-0000-4000-8000-000000000010','Profile contract services',true);
insert into public.service_subcategories(id,category_id,name,is_active) values('c5300000-0000-4000-8000-000000000011','c5300000-0000-4000-8000-000000000010','Contract repairs',true);
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"c5300000-0000-4000-8000-000000000001","session_id":"c5300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.update_my_profile('{"full_name":"Personal remains usable"}');
select pg_temp.expect((select full_name='Personal remains usable' and worker_occupation is null and country='Ghana' and state is null from public.profiles where user_id='profile-contract'),'starting a Worker workspace does not force professional setup or a personal region');
select pg_temp.expect(public.get_my_worker_service_coverage() is null,'visiting a draft workspace does not manufacture service coverage');
do $$begin
 begin
  perform public.update_my_profile_with_location('{"full_name":"Must roll back"}',1000,7,'Invalid test address',10);
  raise exception 'FAIL: invalid location was accepted';
 exception when raise_exception then if sqlerrm<>'Invalid coordinates' then raise;end if;end;
end$$;
select pg_temp.expect((select full_name='Personal remains usable' and precise_address is null from public.profiles where user_id='profile-contract'),'a rejected private address rolls back the preceding profile update');
select public.update_my_profile_with_location('{"full_name":"Confirmed personal name","state":"Greater Accra","city":"Accra"}',5.6,-0.1,'Synthetic private address',12);
select pg_temp.expect((select full_name='Confirmed personal name' and country='Ghana' and state='Greater Accra' and precise_address='Synthetic private address' from public.profiles where user_id='profile-contract'),'profile and private location commit together for the saved country');

select public.save_my_worker_profile('[{"category":"Profile contract services","name":"Contract repairs","price":0,"price_type":"negotiable"}]',
 '{"worker_occupation":"Repair professional","worker_experience":"Practical repair experience","worker_bio":"Synthetic professional profile","country":"Nigeria","state":"Nasarawa","city":"Lafia","area":"Test service area","profile_complete":true}');
select pg_temp.expect(public.get_my_worker_service_coverage()->>'country_code'='NG' and public.get_my_worker_service_coverage()->>'state'='Nasarawa' and public.get_my_worker_service_coverage()->>'city'='Lafia','professional coverage has its own country, region and local area');
select pg_temp.expect((select role='user' and country='Ghana' and state='Greater Accra' and city='Accra' and precise_address='Synthetic private address' from public.profiles where user_id='profile-contract'),'professional coverage never overwrites the same identity private country, region or address');
reset role;
select pg_temp.expect(public.worker_professional_profile_ready('profile-contract'),'professional readiness uses service coverage');
set local role authenticated;
do $$begin
 begin
  perform public.save_my_worker_profile('[{"category":"Profile contract services","name":"Contract repairs","price":3000,"price_type":"starting_from"}]',
   '{"worker_occupation":"Must roll back","country":"Unconfigured test country","state":"Test region","city":"Test town"}');
  raise exception 'FAIL: unsupported professional market accepted';
 exception when raise_exception then if sqlerrm<>'Choose an available service country' then raise;end if;end;
end$$;
select pg_temp.expect((select worker_occupation='Repair professional' from public.profiles where user_id='profile-contract') and
 (select count(*)=1 and max(price)=0 from public.worker_services where worker_id='profile-contract'),'a failed professional profile save also rolls back service changes');
select public.update_my_profile('{"state":"Ashanti","city":"Kumasi","full_name":"Updated private identity"}');
select pg_temp.expect(public.get_my_worker_service_coverage()->>'state'='Nasarawa' and public.get_my_worker_service_coverage()->>'city'='Lafia','editing personal location does not change where the provider works');
select pg_temp.expect((select country='Ghana' and state='Ashanti' and local_government='Kumasi' from public.profiles where user_id='profile-contract'),'existing account personal location remains editable');
select public.update_my_profile('{"country":null,"state":"Nasarawa","city":"Lafia"}');
select public.update_my_profile('{"country":"Nigeria"}');
select pg_temp.expect((select country='Nigeria' and state='Nasarawa' and local_government='Lafia' from public.profiles where user_id='profile-contract'),'an older account can explicitly confirm its country while preserving the agreed region');
select pg_temp.expect(public.get_my_worker_service_coverage()->>'country_code'='NG' and public.get_my_worker_service_coverage()->>'city'='Lafia','personal country confirmation never moves professional coverage');
reset role;
select pg_temp.expect((select count(*)=1 from public.profiles where auth_id='c5300000-0000-4000-8000-000000000001'),'one person remains one identity');
select pg_temp.expect(not has_table_privilege('authenticated','private.worker_operating_profiles','select')
 and not has_function_privilege('authenticated','private.worker_operating_profile(text)','execute')
 and not has_function_privilege('authenticated','private.assert_worker_market_capacity(public.profiles)','execute'),'work projections and capacity helpers are private to existing authorized commands');
select pg_temp.expect(not has_function_privilege('anon','public.update_my_profile_with_location(jsonb,numeric,numeric,text,numeric)','execute')
 and not has_function_privilege('anon','public.save_my_worker_profile(jsonb,jsonb)','execute'),'anonymous callers cannot invoke profile corrections');
update public.user_sessions set is_active=false where user_id='profile-contract';
set local role authenticated;
do $$begin
 begin perform public.update_my_profile('{"full_name":"Stale session"}');raise exception 'FAIL: ended session updated profile';
 exception when insufficient_privilege then null;end;
 begin perform public.update_my_precise_location(5.7,-0.2,'Stale private address',1);raise exception 'FAIL: ended session updated location';
 exception when insufficient_privilege then null;end;
 begin perform public.get_my_worker_service_coverage();raise exception 'FAIL: ended session read professional setup';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
select 'Actual profile/location atomicity, optional personal region, one identity, independent professional coverage, failed-save rollback and revoked-session denial passed; fixtures rolled back' as result;
rollback;
