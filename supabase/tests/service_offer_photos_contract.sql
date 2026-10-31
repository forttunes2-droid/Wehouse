\set ON_ERROR_STOP on
begin;
\ir private_message_fixture_helpers.sql
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
create function pg_temp.denied(statement text,fragment text) returns boolean language plpgsql as $$
begin execute statement;return false;exception when others then
 if strpos(sqlerrm,fragment)=0 then raise exception 'Unexpected denial: %',sqlerrm;end if;return true;end $$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.denied(text,text) to authenticated;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,username,role,profile_complete,account_kind,worker_status,worker_verified,available) values
 ('9755d000-0000-4000-8000-000000000001','service-photo-one@example.invalid','photo-one','photo_one','worker',true,'consumer','verified',true,true),
 ('9755d000-0000-4000-8000-000000000002','service-photo-two@example.invalid','photo-two','photo_two','worker',true,'consumer','verified',true,true),
 ('9755d000-0000-4000-8000-000000000003','service-photo-guest@example.invalid','photo-guest','photo_guest','user',true,'consumer',null,false,true);
select pg_temp.prepare_private_message_fixture(array['9755d000']);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values('photo-one','worker','global','active'),('photo-two','worker','global','active');
insert into public.service_categories(id,name,is_active) values('9755d000-4000-4000-8000-000000000001','Synthetic service photo category',true);
insert into public.service_subcategories(id,category_id,name,is_active) values('9755d000-4000-4000-8000-000000000002','9755d000-4000-4000-8000-000000000001','Synthetic photo service',true);
insert into public.worker_services(id,worker_id,service_name,price,price_type) values
 ('9755d000-1000-4000-8000-000000000001','photo-one','Electrical repairs',10000,'starting_from'),
 ('9755d000-1000-4000-8000-000000000002','photo-one','House cleaning',0,'negotiable'),
 ('9755d000-1000-4000-8000-000000000003','photo-two','Electrical repairs',0,'negotiable');
insert into public.worker_bookings(id,user_id,worker_id,booking_code,service_type,scheduled_date,status,agreed_amount,worker_receives)
 values('9755d000-5000-4000-8000-000000000001','photo-guest','photo-one','PHOTO-FIXTURE','Electrical repairs',current_date-2,'approved_released',10000,9000);
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'service-offer-photos','photo-one/9755d000-1000-4000-8000-000000000001/9755d000-2000-4000-8000-000000000001/'||name,
 '9755d000-0000-4000-8000-000000000001',jsonb_build_object('size',case when name='full.jpg' then 500000 else 50000 end,'mimetype','image/jpeg')
 from unnest(array['full.jpg','preview.jpg']) name;
set local session_replication_role=origin;
create temp table photo_receipt(data jsonb);grant all on photo_receipt to authenticated;
select set_config('request.jwt.claims','{"sub":"9755d000-0000-4000-8000-000000000001","session_id":"9755d000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.get_worker_marketplace_trust('photo-one')->>'completed_jobs')::integer=1 and (public.get_worker_marketplace_trust('photo-one')->>'completed_activity_sessions')::integer=0,'actual completion totals distinguish services and activities');
select pg_temp.expect((public.get_worker_marketplace_trust('photo-one')->>'review_count')::integer=0 and (public.get_worker_marketplace_trust('photo-one')->>'rating')::numeric=0,'completed work does not invent a review or star rating');
select public.reserve_my_media_upload('service-offer-photos','photo-one/9755d000-1000-4000-8000-000000000001/9755d000-2000-4000-8000-000000000002/full.jpg');
insert into photo_receipt select public.set_my_service_offer_photos('9755d000-1000-4000-8000-000000000001',
 '[{"id":"9755d000-2000-4000-8000-000000000001","image":"photo-one/9755d000-1000-4000-8000-000000000001/9755d000-2000-4000-8000-000000000001/full.jpg","preview":"photo-one/9755d000-1000-4000-8000-000000000001/9755d000-2000-4000-8000-000000000001/preview.jpg","caption":"Electrical repair work"}]',
 (public.get_my_service_offer_photos('9755d000-1000-4000-8000-000000000001')->>'revision')::uuid);
select pg_temp.expect((select jsonb_array_length(data->'photos')=1 and jsonb_array_length(data->'unused')=0 from photo_receipt),'uploaded photos attach to their own service');
select pg_temp.expect((public.set_my_service_offer_photos('9755d000-1000-4000-8000-000000000001',(select data->'photos' from photo_receipt),gen_random_uuid())->>'revision')=(select data->>'revision' from photo_receipt),'retry of the same gallery is idempotent');
select pg_temp.expect(pg_temp.denied($q$select public.set_my_service_offer_photos('9755d000-1000-4000-8000-000000000001','[]',gen_random_uuid())$q$,'changed'),'stale gallery edits are rejected');
select pg_temp.expect(pg_temp.denied($q$select public.set_my_service_offer_photos('9755d000-1000-4000-8000-000000000002',(select data->'photos' from photo_receipt),(public.get_my_service_offer_photos('9755d000-1000-4000-8000-000000000002')->>'revision')::uuid)$q$,'another service'),'photos cannot be moved to a different service');
select pg_temp.expect(pg_temp.denied($q$update public.worker_services set photos='[]' where id='9755d000-1000-4000-8000-000000000001'$q$,'permission denied'),'direct gallery mutation is unavailable');
select pg_temp.expect(not private.can_cleanup_service_offer_photo('photo-one/9755d000-1000-4000-8000-000000000001/9755d000-2000-4000-8000-000000000001/full.jpg'),'attached bytes cannot be cleaned up');
reset role;
select set_config('storage.allow_delete_query','true',true);
select pg_temp.expect(pg_temp.denied($q$delete from storage.objects where bucket_id='service-offer-photos' and name='photo-one/9755d000-1000-4000-8000-000000000001/9755d000-2000-4000-8000-000000000001/full.jpg'$q$,'Remove this photo'),'final Storage mutation protects attached photos even for privileged callers');
select pg_temp.expect((private.service_offer_card('photo-one',null,'Electrical repairs')->'cover'->>'caption')='Electrical repair work','search card uses the selected service cover');
select pg_temp.expect((private.service_offer_card('photo-one',null,'House cleaning')->'cover')='null'::jsonb,'another service does not borrow that cover');
select set_config('request.jwt.claims','{"sub":"9755d000-0000-4000-8000-000000000002","session_id":"9755d000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.denied($q$select public.get_my_service_offer_photos('9755d000-1000-4000-8000-000000000001')$q$,'not found'),'another Provider cannot edit the gallery');
select pg_temp.expect(not private.can_access_service_offer_photo('photo-one/9755d000-1000-4000-8000-000000000001/9755d000-2000-4000-8000-000000000001/full.jpg',true),'another Provider cannot upload into that service');
reset role;
-- Exercise the actual setter, with an actual active taxonomy entry. Editing
-- prices must retain the service ID, photo revision and gallery.
set local session_replication_role=replica;
update public.worker_services set service_name='Synthetic photo service' where id='9755d000-1000-4000-8000-000000000001';
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"9755d000-0000-4000-8000-000000000001","session_id":"9755d000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.set_my_worker_services((select jsonb_build_array(jsonb_build_object('name',service.service_name,'category',category.name,'price',15000,'price_type','starting_from')) from public.worker_services service join public.service_subcategories sub on sub.name=service.service_name join public.service_categories category on category.id=sub.category_id where service.id='9755d000-1000-4000-8000-000000000001' limit 1));
reset role;
select pg_temp.expect((select price=15000 and jsonb_array_length(photos)=1 and photo_revision=(select (data->>'revision')::uuid from photo_receipt) from public.worker_services where id='9755d000-1000-4000-8000-000000000001'),'service edits retain identity and photos');
rollback;
