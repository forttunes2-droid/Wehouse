-- Synthetic public catalogue only. Every record and setting change rolls back.
begin;
create function pg_temp.expect(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',msg;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,country,state,city,local_government,worker_occupation,worker_skills,worker_status,worker_verified,available,rating,review_count)
select ('94000000-0000-4000-8000-'||lpad(n::text,12,'0')),'provider-search-'||n||'@example.invalid','search-provider-'||lpad(n::text,3,'0'),'user',true,'consumer','Campus cleaner '||n,
 case when n=31 then 'GB' else 'Nigeria' end,'Nasarawa','Lafia','Lafia','Cleaner','["Fixture cleaning"]','verified',true,true,4.5,3 from generate_series(1,38)n;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name)
 values('94000000-0000-4000-8000-000000000090','provider-search-customer@example.invalid','search-customer','user',true,'consumer','Synthetic search customer');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
 select user_id,'worker','global','active' from public.profiles where user_id like 'search-provider-%';
insert into public.worker_service_coverage(worker_id,state,lga,areas)
 select user_id,case when user_id='search-provider-036' then 'Lagos' when user_id='search-provider-038' then 'Abuja FCT' else 'Nasarawa' end,
 case when user_id='search-provider-036' then 'Ikeja' when user_id='search-provider-037' then 'Lafia' when user_id='search-provider-038' then 'Abaji' else 'Keffi' end,array['University area']
 from public.profiles where user_id like 'search-provider-%';
insert into public.worker_services(worker_id,service_name,price,price_type)
 select user_id,'Fixture cleaning',15000,'per_job' from public.profiles where user_id like 'search-provider-%';
insert into public.worker_verifications(worker_id,status,credential_requirements,credential_revision,credential_context)
 select user_id,'verified','[]'::jsonb,1,private.worker_credential_context(user_id) from public.profiles where user_id like 'search-provider-%';
insert into public.service_categories(id,name,is_active,sort_order) values('94100000-0000-4000-8000-000000000001','Fixture home care',true,1000),('94100000-0000-4000-8000-000000000002','Fixture repairs',true,1001);
insert into public.service_subcategories(id,category_id,name,is_active,sort_order) values('94100000-0000-4000-8000-000000000003','94100000-0000-4000-8000-000000000001','Fixture cleaning',true,1),('94100000-0000-4000-8000-000000000004','94100000-0000-4000-8000-000000000002','Fixture plumbing',true,1);
update public.profiles set suspended=true where user_id='search-provider-032';
update public.profiles set worker_verified=false where user_id='search-provider-033';
update public.profiles set available=false where user_id='search-provider-034';
insert into public.worker_user_blocks(blocker_user_id,blocked_user_id) values('search-customer','search-provider-035');
update public.platform_settings set value=case when key='worker_identity_checks_enabled' then 'false' else 'true' end,is_active=true where key in('worker_identity_checks_enabled','worker_marketplace_launch_enabled');
update public.platform_countries set enabled=true where country_code='NG';
insert into public.platform_countries(country_code,name,currency_code,currency_symbol,time_zone,phone_prefix,locale,enabled,is_default)
 values('GB','United Kingdom','GBP','£','Europe/London','+44','en-GB',true,false) on conflict(country_code) do update set enabled=true;
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000090","role":"authenticated"}',true);
set local role authenticated;
do $$declare first_page jsonb;second_page jsonb;item jsonb;cursor jsonb;begin
 first_page:=public.search_service_providers('NG','Keffi campus cleaner','Fixture home care','Fixture cleaning','Nasarawa','Keffi');
 perform pg_temp.expect(jsonb_array_length(first_page->'items')=24 and (first_page->>'has_more')::boolean,'search is bounded after all text/category/service/coverage/country filters');
 cursor:=first_page->'next_cursor';
 second_page:=public.search_service_providers('NG','Keffi campus cleaner','Fixture home care','Fixture cleaning','Nasarawa','Keffi',(cursor->>'rating')::numeric,(cursor->>'reviews')::integer,cursor->>'id');
 perform pg_temp.expect(jsonb_array_length(second_page->'items')=6 and not (second_page->>'has_more')::boolean,'equal ratings have a stable identity cursor and all thirty results are reachable');
 perform pg_temp.expect(not exists(select 1 from jsonb_array_elements(first_page->'items') a join jsonb_array_elements(second_page->'items') b on a->>'user_id'=b->>'user_id'),'pages do not repeat Provider identities');
 for item in select value from jsonb_array_elements((first_page->'items')||(second_page->'items')) loop
  perform pg_temp.expect(not (item ?| array['email','phone','auth_id','worker_gov_id_url','credential_context','operational_latitude']),'search preserves the safe public projection');
 end loop;
 perform pg_temp.expect(jsonb_array_length(public.search_service_providers('GB')->'items')=1,'country filters do not mix identically named regions');
 perform pg_temp.expect(jsonb_array_length(public.search_service_providers('NG',p_state=>'FCT',p_city=>'Abaji')->'items')=1,'existing canonical region aliases still match');
 perform pg_temp.expect(jsonb_array_length(public.search_service_providers('NG',p_query=>'_%')->'items')=0,'typed punctuation is literal text rather than SQL wildcard syntax');
 perform pg_temp.expect(pg_temp.rejects($q$select public.search_service_providers('NG',p_city=>'Keffi')$q$),'local area cannot remain attached to an empty region');
 perform pg_temp.expect(pg_temp.rejects($q$select public.search_service_providers('NG',p_category=>'Fixture repairs',p_specialty=>'Fixture cleaning')$q$),'a stale specialty cannot silently conflict with a new category');
 perform pg_temp.expect(pg_temp.rejects($q$select public.search_service_providers('NG',p_after_id=>'search-provider-006')$q$),'partial cursors are rejected');
 perform pg_temp.expect(jsonb_array_length(public.get_discoverable_service_providers(array['search-provider-030','search-provider-031','search-provider-035']))=2,'shared links and Sponsored reads are independent of pages but still enforce customer blocks');
 perform pg_temp.expect(pg_temp.rejects($q$select public.get_discoverable_service_providers(array_fill('provider',array[13]))$q$),'direct lookups have a small fixed bound');
 perform pg_temp.expect(not has_function_privilege('anon','public.search_service_providers(text,text,text,text,text,text,numeric,integer,text)','EXECUTE'),'personalized service search cannot be anonymously cached');
 perform pg_temp.expect(not has_function_privilege('authenticated','private.service_provider_rows(text,text,text,text,text,text,text,numeric,integer,text,integer,text[])','EXECUTE'),'clients cannot bypass the bounded commands');
 perform pg_temp.expect(exists(select 1 from public.get_public_workers('Nasarawa','Keffi',null) where user_id='search-provider-030'),'existing saved/operational public readers keep the same projection');
end $$;
reset role;
update public.profiles set country='GB' where user_id='search-provider-001';
set local role authenticated;
select pg_temp.expect(public.get_discoverable_service_providers(array['search-provider-001'])='[]'::jsonb,'a changed operating country requires current credential review, rather than reusing approval from another country');
reset role;
update public.workspace_role_assignments set status='revoked' where user_id='search-provider-030' and workspace_role='worker';
set local role authenticated;
select pg_temp.expect(public.get_discoverable_service_providers(array['search-provider-030'])='[]'::jsonb,'workspace restrictions apply equally to direct links');
reset role;
rollback;
select 'Bounded Provider search, combined filters, paging, country boundaries and private-account exclusions passed; all fixtures rolled back' as result;
