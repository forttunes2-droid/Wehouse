begin;
-- Real Auth sessions and trusted devices; constraints and triggers stay enabled.
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('79666666-0000-4000-8000-000000000001','authenticated','authenticated','refund-owner@example.invalid',now(),now()),
('79666666-0000-4000-8000-000000000002','authenticated','authenticated','refund-guest@example.invalid',now(),now()),
('79666666-0000-4000-8000-000000000003','authenticated','authenticated','refund-other@example.invalid',now(),now());
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('79666666-0000-4000-8000-000000000001','refund-owner@example.invalid','refund-owner','user',true),
('79666666-0000-4000-8000-000000000002','refund-guest@example.invalid','refund-guest','user',true),
('79666666-0000-4000-8000-000000000003','refund-other@example.invalid','refund-other','user',true);
insert into auth.sessions(id,user_id,created_at,updated_at)
select replace(auth_id::text,'-0000-','-2000-')::uuid,auth_id::uuid,now(),now()
from public.profiles where user_id in('refund-owner','refund-guest','refund-other');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,replace(auth_id::text,'-0000-','-2000-'),'refund-'||user_id,'Browser',true,'trusted'
from public.profiles where user_id in('refund-owner','refund-guest','refund-other');
create function pg_temp.sign_in(p_auth uuid) returns void language sql as $$
select set_config('request.jwt.claims',jsonb_build_object('sub',p_auth,'session_id',replace(p_auth::text,'-0000-','-2000-'),'role','authenticated')::text,true)::text is not null;
$$;
grant execute on function pg_temp.sign_in(uuid) to authenticated;
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values('refund-owner','property_partner','global'),('refund-other','creator','global');
-- Reviewed publication is fixture setup; the guest cancellation is exercised below under its own JWT.
insert into public.inspection_requests(id,request_code,owner_id,owner_email,property_type,property_address,property_city,property_state,status,field_photo_urls)
values('79666666-3000-4000-8000-000000000001','REFUND-HOTEL-CONTRACT','refund-owner','refund-owner@example.invalid','hotel','Contract address','Lafia','Nasarawa','completed',array['field-1','field-2','field-3','field-4']);
select pg_temp.sign_in('79666666-0000-4000-8000-000000000003');
set local role authenticated;
select public.configure_property_document_requirements('79666666-3000-4000-8000-000000000001',0,
public.get_property_document_review('79666666-3000-4000-8000-000000000001')->'requirements','Rollback-only accepted Hotel operator and jurisdiction evidence.');
select pg_temp.sign_in('79666666-0000-4000-8000-000000000001');
do $$declare rule jsonb; doc jsonb; begin
 for rule in select value from jsonb_array_elements(public.get_property_document_review('79666666-3000-4000-8000-000000000001')->'requirements') loop
  doc:=public.begin_property_document_upload('79666666-3000-4000-8000-000000000001',rule->>'code',gen_random_uuid(),'application/pdf',12,'contract-evidence.pdf');
  insert into storage.objects(bucket_id,name,metadata) values('property-documents',doc->>'object_path','{"size":12,"mimetype":"application/pdf"}'::jsonb);
  perform public.finish_property_document_upload((doc->>'id')::uuid,false);
 end loop;
end $$;
select pg_temp.sign_in('79666666-0000-4000-8000-000000000003');
do $$declare doc jsonb; begin
 for doc in select value from jsonb_array_elements(public.get_property_document_review('79666666-3000-4000-8000-000000000001')->'documents') loop
  perform public.review_property_document((doc->>'id')::uuid,'approved','Rollback-only independent accepted Hotel evidence.',now()+interval '1 year');
 end loop;
end $$;
reset role;
insert into public.hotels(hotel_id,name,state,city,owner_id,status,inspection_request_id,approved_by,approved_at)
values(-7966,'Refund Hotel','Nasarawa','Lafia','refund-owner','active','79666666-3000-4000-8000-000000000001','refund-other',now());
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values(-7966,-7966,'Standard',20000,1);

-- A paused synthetic connection must retain cancellation delivery without blocking the guest.
insert into public.hotel_pms_providers(provider_key,display_name) values('rollback-pms-contract','Rollback-only PMS fixture');
insert into public.hotel_integrations(integration_id,hotel_id,provider,connection_name,status,scopes,authoritative_domains)
values('79666666-4000-4000-8000-000000000001',-7966,'rollback-pms-contract','Rollback-only connection','requested',array['reservations.read','reservations.ack','reservations.receive'],array[]::text[]);
insert into public.hotel_room_units(unit_id,hotel_id,room_id,unit_label,status)
overriding system value values(-7966,-7966,-7966,'101','ready');
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,price_per_night,refundable,cancellation_template,cancellation_hours)
overriding system value values(-7966,-7966,-7966,'Refund contract rate',20000,true,'standard',24);
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
select 'accommodation_arrival_issue_window',99003,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}'::jsonb,
 'active',now()-interval '1 minute','reviewed','Rollback-only cancellation fixture','hotel-refund-contract'
where not exists(select 1 from public.creator_policy_versions where policy_key='accommodation_arrival_issue_window' and scope_type='global' and scope_key='*' and status='active');
update public.hotels set published_at=now(),timezone='Africa/Lagos',check_in_time='14:00' where hotel_id=-7966;
select pg_temp.sign_in('79666666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare q jsonb;booking public.hotel_bookings;expected timestamptz;begin
 q:=public.quote_hotel_room_rate(-7966,-7966,-7966,current_date+3,current_date+5);
 expected:=((current_date+2+time '14:00') at time zone 'Africa/Lagos');
 if (q->>'cancellation_deadline')::timestamptz is distinct from expected then raise exception 'Hotel-local quote deadline is wrong';end if;
 booking:=public.create_my_hotel_booking_with_rate(-7966,-7966,-7966,current_date+3,current_date+5,1,'Refund guest','08000000000',null);
 if booking.total_price<>40000 or (booking.cancellation_snapshot->>'deadline')::timestamptz is distinct from expected or (booking.cancellation_snapshot->>'refund_amount_ngn')::numeric<>40000 then raise exception 'Real booking did not save its exact refund and local deadline';end if;
 perform set_config('test.hotel_booking_id',booking.booking_id::text,true);
end$$;
reset role;
-- Seed a verified protected charge at the provider boundary; this is not actual PSP money movement.
insert into public.payment_protection_transactions(id,booking_type,payer_user_id,payee_user_id,amount_total,amount_commission,amount_payee,commission_rate,status,protection_state,subject_type,subject_id,paystack_reference)
values('79666666-1000-4000-8000-000000000001','hotel_stay','refund-guest','refund-owner',40000,4800,35200,12,'protected','protected','hotel_stay',current_setting('test.hotel_booking_id'),'TEST-HOTEL-REFUND');
update public.hotel_bookings set integration_id='79666666-4000-4000-8000-000000000001',status='confirmed',canonical_state='confirmed',payment_status='paid',payment_reference='TEST-HOTEL-REFUND',payment_protection_id='79666666-1000-4000-8000-000000000001',paid_at=now()
where booking_id=current_setting('test.hotel_booking_id')::integer;
insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,hotel_booking_id,amount,amount_total,verified_amount,currency,status,purpose,verified_at,paid_at,paystack_transaction_id)
values('TEST-HOTEL-REFUND','TEST-HOTEL-REFUND','refund-guest','refund-guest',current_setting('test.hotel_booking_id')::integer,40000,40000,40000,'NGN','paid','hotel_booking',now(),now(),'TEST-TRANSACTION');
-- A Protection insert may schedule a release. Retire that fixture action before testing cancellation.
delete from public.financial_action_outbox where payment_protection_id='79666666-1000-4000-8000-000000000001';
select pg_temp.sign_in('79666666-0000-4000-8000-000000000003');
set local role authenticated;
do $$begin
 begin perform public.cancel_my_hotel_booking(current_setting('test.hotel_booking_id')::integer);raise exception 'FAIL: another guest cancelled';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end$$;
reset role;
select pg_temp.sign_in('79666666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare preview jsonb;begin
 preview:=public.get_my_hotel_cancellation_preview(current_setting('test.hotel_booking_id')::integer);
 if preview->>'kind'<>'full_refund' or (preview->>'refund_amount_ngn')::numeric<>40000 or not (preview->>'can_cancel')::boolean then raise exception 'Preview did not match the eligible locked cancellation';end if;
end$$;
select public.cancel_my_hotel_booking(current_setting('test.hotel_booking_id')::integer);
select public.cancel_my_hotel_booking(current_setting('test.hotel_booking_id')::integer);
reset role;
do $$begin
 begin execute 'set local role authenticated';perform public.ack_hotel_pms_reservation('79666666-4000-4000-8000-000000000001',current_setting('test.hotel_booking_id')::integer,now(),'cancelled',true,null,null,gen_random_uuid());raise exception 'FAIL: guest invoked server-only PMS acknowledgement';exception when insufficient_privilege then null;end;
 if (public.get_my_hotel_cancellation_preview(current_setting('test.hotel_booking_id')::integer)->>'kind')<>'already_cancelled' then raise exception 'Cancelled booking preview offered another cancellation';end if;
 if (select count(*) from public.financial_action_outbox where idempotency_key='hotel-cancellation:'||current_setting('test.hotel_booking_id'))<>1 then raise exception 'Cancellation created duplicate refund obligations';end if;
 if (select payment_status from public.hotel_bookings where booking_id=current_setting('test.hotel_booking_id')::integer)<>'paid' then raise exception 'Unconfirmed provider refund shown as complete';end if;
 begin update public.hotel_bookings set cancellation_snapshot='{}' where booking_id=current_setting('test.hotel_booking_id')::integer;raise exception 'FAIL: saved agreement changed';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 begin update public.hotel_bookings set check_in=check_in+1 where booking_id=current_setting('test.hotel_booking_id')::integer;raise exception 'FAIL: booked date changed';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end$$;

do $$begin
 if (select pms_sync_status from public.hotel_bookings where booking_id=current_setting('test.hotel_booking_id')::integer)<>'review_required' then raise exception 'Paused connection did not expose required cancellation review';end if;
 if (select count(*) from public.hotel_integration_events where integration_id='79666666-4000-4000-8000-000000000001' and event_type='reservation.cancelled' and external_reference=current_setting('test.hotel_booking_id'))<>1 then raise exception 'Cancellation did not retain exactly one outbound event';end if;
end$$;
-- These approvals/provider records are rollback-only fixtures, not real launch signoff or certification.
insert into public.legal_launch_approvals(gate_key,status,authority,approval_reference,scope,approved_at)
values('hotel_marketplace','approved','Rollback contract','rollback-only','Synthetic database contract',now()-interval '1 minute'),
('hotel_pms_connected_mode','approved','Rollback contract','rollback-only','Synthetic database contract',now()-interval '1 minute')
on conflict(gate_key)do update set status='approved',approved_at=excluded.approved_at,expires_at=null;
update public.hotel_pms_providers set certification_status='certified',adapter_version='fixture-v1',certification_evidence_uri='https://example.invalid/rollback-only',
 contract_reviewed_at=now(),security_reviewed_at=now(),dpa_reviewed_at=now(),mapping_reviewed_at=now(),pilot_approved_at=now(),certified_at=now(),certified_by='refund-other'
where provider_key='rollback-pms-contract';
update public.hotel_integrations set status='active',hotel_authorized_by='refund-owner',hotel_authorized_at=now(),activated_at=now(),activated_by='refund-other',external_hotel_id='rollback-hotel',token_prefix='rollback-only',token_hash=repeat('c',64) where integration_id='79666666-4000-4000-8000-000000000001';

update public.hotel_pms_providers set supported_domains=array['rooms','rates','inventory'] where provider_key='rollback-pms-contract';
update public.hotel_integrations set scopes=scopes||array['catalog.write'],authoritative_domains=array['rooms','rates','inventory'] where integration_id='79666666-4000-4000-8000-000000000001';
insert into public.hotel_integration_events(integration_event_id,integration_id,idempotency_key,direction,event_type,payload_hash,status)
select ('79666666-5000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'79666666-4000-4000-8000-000000000001','rollback-catalog-'||i,'inbound','catalog_sync',repeat('e',64),'pending' from generate_series(2,7)i;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare receipt jsonb;payload jsonb;begin
 payload:=jsonb_build_object('rooms',jsonb_build_array(jsonb_build_object('external_reference','contract-room','room_type','PMS Standard','base_price',25000,'max_guests',2,'total_rooms',2)),
 'rates',jsonb_build_array(jsonb_build_object('external_reference','contract-rate','room_external_reference','contract-room','name','PMS standard rate','price_per_night',26000,'refundable',true,'cancellation_hours',24)),
 'inventory',jsonb_build_array(jsonb_build_object('room_external_reference','contract-room','date',current_date+10,'available_quantity',2)));
 receipt:=public.apply_hotel_pms_catalog('79666666-4000-4000-8000-000000000001','79666666-5000-4000-8000-000000000002',payload);
 if receipt<>jsonb_build_object('rooms',1,'rates',1,'inventory',1) then raise exception 'Atomic catalog receipt is incorrect';end if;
 if (select status from public.hotel_integration_events where integration_event_id='79666666-5000-4000-8000-000000000002')<>'acknowledged' then raise exception 'Atomic catalog did not finish its event';end if;
 receipt:=public.apply_hotel_pms_catalog('79666666-4000-4000-8000-000000000001','79666666-5000-4000-8000-000000000006',payload);
 if receipt<>jsonb_build_object('rooms',1,'rates',1,'inventory',1) then raise exception 'Existing PMS catalog update failed';end if;
 begin perform public.apply_hotel_pms_catalog('79666666-4000-4000-8000-000000000001','79666666-5000-4000-8000-000000000007',jsonb_build_object('currency',null));
  raise exception 'FAIL: unknown currency became NGN';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 payload:=jsonb_set(payload,'{rooms,0,base_price}','30000');
 payload:=jsonb_set(payload,'{rates,0,room_external_reference}','"unknown-room"');
 begin
  perform public.apply_hotel_pms_catalog('79666666-4000-4000-8000-000000000001','79666666-5000-4000-8000-000000000003',payload);
  raise exception 'FAIL: invalid later rate committed a partial catalog';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 if (select price_per_night from public.hotel_rooms where hotel_id=-7966 and external_reference='contract-room')<>25000
  or (select status from public.hotel_integration_events where integration_event_id='79666666-5000-4000-8000-000000000003')<>'pending' then raise exception 'Failed catalog retained partial writes';end if;
 payload:=jsonb_build_object('rooms',jsonb_build_array(jsonb_build_object('external_reference','missing-price','room_type','Invalid price','max_guests',2,'total_rooms',1)));
 begin perform public.apply_hotel_pms_catalog('79666666-4000-4000-8000-000000000001','79666666-5000-4000-8000-000000000004',payload);
  raise exception 'FAIL: missing price became a one-naira room';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 if exists(select 1 from public.hotel_rooms where hotel_id=-7966 and external_reference='missing-price') then raise exception 'Invalid price created a room';end if;
 payload:=jsonb_build_object('inventory',jsonb_build_array(jsonb_build_object('room_external_reference','contract-room','date',current_date+10,'available_quantity',3)));
 begin perform public.apply_hotel_pms_catalog('79666666-4000-4000-8000-000000000001','79666666-5000-4000-8000-000000000005',payload);
  raise exception 'FAIL: availability exceeded physical stock';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end$$;

reset role;
update public.hotel_integrations set scopes=scopes||array['room_status.write'],authoritative_domains=authoritative_domains||array['room_status'] where integration_id='79666666-4000-4000-8000-000000000001';
insert into public.hotel_room_units(hotel_id,room_id,unit_label,status,source_system,external_reference)
select -7966,room_id,'PMS-101','ready','pms:79666666-4000-4000-8000-000000000001','PMSU-1' from public.hotel_rooms where hotel_id=-7966 and external_reference='contract-room';
insert into public.hotel_integration_events(integration_event_id,integration_id,idempotency_key,direction,event_type,payload_hash,status)
select ('79666666-5000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'79666666-4000-4000-8000-000000000001','rollback-unit-'||i,'inbound','room_status',repeat('f',64),'pending' from generate_series(8,10)i;
select set_config('test.pms_rate_id',rate_plan_id::text,true),set_config('test.pms_room_id',room_id::text,true) from public.hotel_rate_plans where hotel_id=-7966 and external_reference='contract-rate';
select pg_temp.sign_in('79666666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare booking public.hotel_bookings;rate integer:=current_setting('test.pms_rate_id')::integer;room integer:=current_setting('test.pms_room_id')::integer;begin
 booking:=public.create_my_hotel_booking_with_rate(-7966,room,rate,current_date+10,current_date+11,1,'Unit hold guest','08000000000',null);
 perform set_config('test.pms_unit_booking',booking.booking_id::text,true);
end$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare receipt jsonb;begin
 receipt:=public.apply_hotel_pms_room_status('79666666-4000-4000-8000-000000000001','79666666-5000-4000-8000-000000000008','contract-room','not-mapped',null,'ready');
 if not(receipt->>'review_required')::boolean then raise exception 'Unknown physical mapping was invented';end if;
 receipt:=public.apply_hotel_pms_room_status('79666666-4000-4000-8000-000000000001','79666666-5000-4000-8000-000000000009','contract-room','PMS-101',null,'cleaning');
 if(receipt->>'review_required')::boolean or receipt->>'status'<>'cleaning' then raise exception 'Atomic room status failed';end if;
end$$;
reset role;
-- Occupied physical-unit projection is fixture setup; arrival/payment verification is outside this PMS status contract.
update public.hotel_room_units set status='occupied',current_booking_id=current_setting('test.pms_unit_booking')::integer where hotel_id=-7966 and unit_label='PMS-101';
set local role service_role;
do $$declare receipt jsonb;begin
 receipt:=public.apply_hotel_pms_room_status('79666666-4000-4000-8000-000000000001','79666666-5000-4000-8000-000000000010','contract-room','PMS-101',null,'ready');
 if not(receipt->>'review_required')::boolean or (select status from public.hotel_room_units where hotel_id=-7966 and unit_label='PMS-101')<>'occupied' then raise exception 'PMS overwrote an assigned physical unit';end if;
end$$;
reset role;
update public.hotel_integrations set authoritative_domains=array[]::text[] where integration_id='79666666-4000-4000-8000-000000000001';
insert into public.hotel_integration_events(integration_event_id,integration_id,idempotency_key,direction,event_type,payload_hash,status)
values('79666666-5000-4000-8000-000000000001','79666666-4000-4000-8000-000000000001','rollback-cancellation-ack','inbound','reservation_ack',repeat('d',64),'pending');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare booked public.hotel_bookings;result jsonb;begin
 select * into booked from public.hotel_bookings where booking_id=current_setting('test.hotel_booking_id')::integer;
 begin
  perform public.ack_hotel_pms_reservation('79666666-4000-4000-8000-000000000001',booked.booking_id,booked.updated_at,'confirmed',true,'PMS-1',null,'79666666-5000-4000-8000-000000000001');
  raise exception 'FAIL: stale confirmation acknowledged a cancellation';
 exception when serialization_failure then null;end;
 if (select status from public.hotel_integration_events where integration_event_id='79666666-5000-4000-8000-000000000001')<>'pending' then raise exception 'Stale acknowledgement changed its event';end if;
 result:=public.ack_hotel_pms_reservation('79666666-4000-4000-8000-000000000001',booked.booking_id,booked.updated_at,'cancelled',true,'PMS-1',null,'79666666-5000-4000-8000-000000000001');
 if result->>'reservation_status'<>'cancelled' or (select pms_sync_status from public.hotel_bookings where booking_id=booked.booking_id)<>'acknowledged' then raise exception 'Current cancellation acknowledgement was not atomic';end if;
 if (select status from public.hotel_integration_events where integration_id='79666666-4000-4000-8000-000000000001' and event_type='reservation.cancelled' and external_reference=booked.booking_id::text)<>'acknowledged' then raise exception 'Cancelled delivery event was not acknowledged';end if;
end$$;
reset role;
update public.financial_action_outbox set status='processing',attempt_count=1 where idempotency_key='hotel-cancellation:'||current_setting('test.hotel_booking_id');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_refund_provider_submission((select financial_action_id from public.financial_action_outbox where idempotency_key='hotel-cancellation:'||current_setting('test.hotel_booking_id')),'refund-1','pending',repeat('c',64));
select public.process_verified_paystack_refund_event('test-hotel-failed','refund.failed','TEST-HOTEL-REFUND','refund-1','refund-1',repeat('f',64),now(),4000000,'NGN');
select public.process_verified_paystack_refund_event('test-hotel-processed','refund.processed','TEST-HOTEL-REFUND','refund-1','refund-1',repeat('a',64),now(),4000000,'NGN');
select public.process_verified_paystack_refund_event('test-hotel-processed','refund.processed','TEST-HOTEL-REFUND','refund-1','refund-1',repeat('a',64),now(),4000000,'NGN');
reset role;
do $$begin
 if (select payment_status from public.hotel_bookings where booking_id=current_setting('test.hotel_booking_id')::integer)<>'refunded' then raise exception 'Verified refund not projected';end if;
 if (select refunded_amount from public.payment_protection_transactions where id='79666666-1000-4000-8000-000000000001')<>40000 then raise exception 'Replay changed refunded money';end if;
 if (select status from public.financial_action_outbox where idempotency_key='hotel-cancellation:'||current_setting('test.hotel_booking_id'))<>'completed' then raise exception 'Refund action not complete';end if;
end$$;
select pg_temp.sign_in('79666666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare receipt jsonb;booked jsonb;begin
 if public.get_my_hotel_cancellation_preview(current_setting('test.hotel_booking_id')::integer)->>'refund_status'<>'completed' then raise exception 'Preview did not show the provider-confirmed refund';end if;
 select value into booked from jsonb_array_elements(public.get_my_hotel_bookings()) where (value->>'booking_id')::integer=current_setting('test.hotel_booking_id')::integer;
 if booked->>'refund_status'<>'completed' or (booked->>'refund_amount_ngn')::numeric<>40000 then raise exception 'Booking detail did not show the canonical refund status';end if;
 receipt:=public.get_my_payment_receipts('TEST-HOTEL-REFUND',null,null)->0;
 if receipt is null or receipt->>'status'<>'refunded' or receipt->>'refund_processed_at' is null or receipt->'cancellation_snapshot'->>'timezone' is distinct from 'Africa/Lagos' then raise exception 'Receipt missing confirmed refund or booked terms';end if;
end$$;
reset role;
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,price_per_night,refundable,cancellation_template,cancellation_hours)
overriding system value values
(-7967,-7966,-7966,'Non-refundable contract rate',19000,false,'non_refundable',0),
(-7968,-7966,-7966,'Earlier deadline contract rate',20000,true,'standard',96);
select pg_temp.sign_in('79666666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare booked public.hotel_bookings;begin
 booked:=public.create_my_hotel_booking_with_rate(-7966,-7966,-7967,current_date+6,current_date+8,1,'Refund guest','08000000000',null);
 perform set_config('test.nonref_id',booked.booking_id::text,true);
 booked:=public.create_my_hotel_booking_with_rate(-7966,-7966,-7968,current_date+2,current_date+3,1,'Refund guest','08000000000',null);
 perform set_config('test.late_id',booked.booking_id::text,true);
end$$;
reset role;
update public.hotel_bookings set status='confirmed',payment_status='paid' where booking_id in(current_setting('test.nonref_id')::integer,current_setting('test.late_id')::integer);
set local role authenticated;
do $$declare id integer;begin
 foreach id in array array[current_setting('test.nonref_id')::integer,current_setting('test.late_id')::integer] loop
  if public.get_my_hotel_cancellation_preview(id)->>'kind'<>'review_required' then raise exception 'Ineligible paid stay offered automatic refund';end if;
  begin perform public.cancel_my_hotel_booking(id);raise exception 'FAIL: ineligible paid stay automatically cancelled';
  exception when others then if sqlerrm<>'This booking requires WeHouse cancellation review' then raise;end if;end;
 end loop;
end$$;
reset role;
rollback;
select 'Normal Auth Hotel quote, booking, immutable terms, cancellation, refund replay and receipt passed; fixtures rolled back. PMS queued cancellation, versioned acknowledgement, atomic catalog rollback and occupied-unit refusal passed. Actual PSP and vendor transport remain external.' result;
