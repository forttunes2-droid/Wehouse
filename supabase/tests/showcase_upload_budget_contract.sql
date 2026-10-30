\set ON_ERROR_STOP on
-- Transaction-only metadata fixtures. No actual Storage asset is uploaded or deleted.
begin;
create function pg_temp.expect(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',msg;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated;
set local session_replication_role=replica;
insert into public.profiles(auth_id,user_id,email,role,account_kind,profile_complete,worker_status,worker_verified) values
('99100000-0000-4000-8000-000000000001','media-provider','media-provider@example.invalid','user','consumer',true,'verified',true),
('99100000-0000-4000-8000-000000000002','media-other','media-other@example.invalid','user','consumer',true,'verified',true),
('99100000-0000-4000-8000-000000000003','media-viewer','media-viewer@example.invalid','user','consumer',true,null,false);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values('media-provider','worker','global','active'),('media-other','worker','global','active'),('media-other','property_partner','global','active');
insert into public.worker_identity_checks(worker_id,account_role,status,captured_at,consent_at,attempt_count,challenge_result)
values('media-provider','worker','passed',now(),now(),1,'{}'),('media-other','worker','passed',now(),now(),1,'{}');
insert into storage.objects(bucket_id,name,metadata)
select 'worker-showcase','media-provider/base-'||n||case when n<=3 then '.mp4' else '.jpg' end,
jsonb_build_object('size',case when n<=3 then 13000000 else 2000000 end,'mimetype',case when n<=3 then 'video/mp4' else 'image/jpeg' end)
from generate_series(1,11) n;
insert into public.worker_showcase_posts(worker_id,kind,media_type,storage_path)
select 'media-provider','work_post',case when n<=3 then 'video' else 'image' end,
'media-provider/base-'||n||case when n<=3 then '.mp4' else '.jpg' end from generate_series(1,11)n;
insert into storage.objects(bucket_id,name,metadata) values
('worker-showcase','media-provider/oversize.jpg','{"size":2000001,"mimetype":"image/jpeg"}'),
('worker-showcase','media-provider/wrong.jpg','{"size":10,"mimetype":"text/html"}'),
('worker-showcase','media-provider/final.jpg','{"size":2000000,"mimetype":"image/jpeg"}'),
('worker-showcase','media-provider/fourth.mp4','{"size":13000000,"mimetype":"video/mp4"}');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"99100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.get_my_worker_showcase_capacity()->>'posts')::integer=11,'all current samples count toward allowance');
select pg_temp.expect((public.get_my_worker_showcase_capacity()->>'videos')::integer=3,'videos have a separate count');
select pg_temp.expect(pg_temp.rejects($$select public.create_my_worker_showcase_post('work_post','image','media-provider/oversize.jpg')$$),'oversized photo cannot bypass browser compression');
select pg_temp.expect(pg_temp.rejects($$select public.create_my_worker_showcase_post('work_post','image','media-provider/wrong.jpg')$$),'wrong stored media type refused');
select pg_temp.expect(pg_temp.rejects($$select public.create_my_worker_showcase_post('work_post','video','media-provider/fourth.mp4')$$),'fourth video refused while photo slot remains');
select set_config('test.media_post',(public.create_my_worker_showcase_post('work_post','image','media-provider/final.jpg')).id::text,true);
select pg_temp.expect((public.create_my_worker_showcase_post('work_post','image','media-provider/final.jpg')).id::text=current_setting('test.media_post'),'same upload retry returns original receipt even when full');
select pg_temp.expect((public.get_my_worker_showcase_capacity()->>'posts')::integer=12,'retry does not consume another slot');
select pg_temp.expect(pg_temp.rejects($$select public.create_my_worker_showcase_post('work_post','image','media-provider/oversize.jpg')$$),'thirteenth sample refused');
select set_config('request.jwt.claims','{"sub":"99100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.get_my_worker_showcase_capacity()$$),'customer cannot access provider allowance');
select set_config('request.jwt.claims','{"sub":"99100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.create_my_worker_showcase_post('work_post','image','media-provider/final.jpg')$$),'another provider cannot reuse owned media');
select set_config('test.upload_ticket',(public.reserve_my_media_upload('worker-showcase','media-other/new.jpg')->>'id'),true);
select pg_temp.expect(public.reserve_my_media_upload('worker-showcase','media-other/new.jpg')->>'id'=current_setting('test.upload_ticket'),'retry reuses one durable allocation');
select pg_temp.expect(not public.complete_my_media_upload(current_setting('test.upload_ticket')::uuid),'a missing Storage object cannot complete an allocation');
savepoint storage_permission_probe;
select pg_temp.expect(private.storage_upload_within_budget('worker-showcase',gen_random_uuid(),'media-other/new.jpg','{"size":100,"mimetype":"image/jpeg"}'),'small owned upload has headroom');
rollback to storage_permission_probe;
select pg_temp.expect(public.reserve_my_media_upload('worker-showcase','media-other/new.jpg')->>'id'=current_setting('test.upload_ticket'),'Storage probe rollback leaves the allocation intact');
select pg_temp.expect(pg_temp.rejects($$select public.reserve_my_media_upload('avatars','someone-else/avatar.jpg')$$),'unowned avatar paths cannot hold project capacity');
select pg_temp.expect(pg_temp.rejects($$select public.reserve_my_media_upload('listing-images','test/photo.jpg')$$),'unapproved property destinations cannot reserve capacity');
select public.reserve_my_media_upload('listing-candidates','partner/media-other/photo.jpg');
select pg_temp.expect(pg_temp.rejects($$select private.storage_upload_within_budget('listing-candidates',gen_random_uuid(),'partner/media-other/photo.jpg','{"size":2000001,"mimetype":"image/jpeg"}')$$),'property image size is enforced at Storage admission');
reset role;
update private.media_upload_policy set project_bytes=1;
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.reserve_my_media_upload('avatars','99100000-0000-4000-8000-000000000002/avatar.jpg')$$),'global budget protects other buckets too');
reset role;
update private.media_upload_policy set project_bytes=800000000,showcase_bytes=1;
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.reserve_my_media_upload('worker-showcase','media-other/second.jpg')$$),'provider byte allowance cannot be bypassed with no published posts');
reset role;
select pg_temp.expect(not exists(select 1 from private.media_upload_reservations where object_name in('someone-else/avatar.jpg','test/photo.jpg')),'unauthorized requests consume no capacity');
-- Exercise the same gallery trigger without creating any production listings.
create temporary table gallery_fixture(id integer primary key,images text[]);
insert into gallery_fixture values(1,array_fill('legacy-photo'::text,array[13]));
create trigger gallery_limit before insert or update of images on gallery_fixture for each row execute function private.limit_property_gallery();
insert into gallery_fixture values(2,array_fill('photo'::text,array[12]));
update gallery_fixture set images=images where id=1;
select pg_temp.expect(pg_temp.rejects($$insert into gallery_fixture values(3,array_fill('photo'::text,array[13]))$$),'new galleries above 12 are refused');
select pg_temp.expect(pg_temp.rejects($$update gallery_fixture set images=array_fill('different'::text,array[13]) where id=1$$),'changing a legacy gallery must meet current limits');
select pg_temp.expect((select count(*)=3 from pg_trigger where tgname in('property_gallery_limit','hotel_gallery_limit','hotel_room_gallery_limit') and not tgisinternal),'all three published gallery authorities have the cap');
select pg_temp.expect(not has_function_privilege('anon','public.get_my_worker_showcase_capacity()','execute'),'anonymous allowance access denied');
select pg_temp.expect(not has_table_privilege('authenticated','private.media_upload_policy','update'),'clients cannot enlarge their limits');
select pg_temp.expect((select count(*)=2 from pg_policies where schemaname='storage' and tablename='objects' and policyname in('wehouse_upload_budget_insert','wehouse_upload_budget_update') and permissive='RESTRICTIVE'),'budget gates add to existing ownership policies for inserts and replacements');
select pg_temp.expect(not has_table_privilege('authenticated','private.media_upload_reservations','update'),'clients cannot release or edit reserved capacity');
select pg_temp.expect(not has_function_privilege('anon','public.reserve_my_media_upload(text,text)','execute'),'anonymous clients cannot reserve space');
select 'showcase_upload_budget_contract_ok';
rollback;
