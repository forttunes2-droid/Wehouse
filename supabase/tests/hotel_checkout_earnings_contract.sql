begin;
-- Real Auth sessions and trusted devices; constraints and triggers stay enabled.
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('79676666-0000-4000-8000-000000000001','authenticated','authenticated','fee-owner@example.invalid',now(),now()),
('79676666-0000-4000-8000-000000000002','authenticated','authenticated','fee-guest@example.invalid',now(),now()),
('79676666-0000-4000-8000-000000000003','authenticated','authenticated','fee-other@example.invalid',now(),now());
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('79676666-0000-4000-8000-000000000001','fee-owner@example.invalid','fee-owner','user',true),
('79676666-0000-4000-8000-000000000002','fee-guest@example.invalid','fee-guest','user',true),
('79676666-0000-4000-8000-000000000003','fee-other@example.invalid','fee-other','user',true);
insert into auth.sessions(id,user_id,created_at,updated_at)
select replace(auth_id::text,'-0000-','-2000-')::uuid,auth_id::uuid,now(),now()
from public.profiles where user_id in('fee-owner','fee-guest','fee-other');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,replace(auth_id::text,'-0000-','-2000-'),'fee-'||user_id,'Browser',true,'trusted'
from public.profiles where user_id in('fee-owner','fee-guest','fee-other');
create function pg_temp.sign_in(p_auth uuid) returns void language sql as $$
select set_config('request.jwt.claims',jsonb_build_object('sub',p_auth,'session_id',replace(p_auth::text,'-0000-','-2000-'),'role','authenticated')::text,true)::text is not null;
$$;
grant execute on function pg_temp.sign_in(uuid) to authenticated;
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values('fee-owner','property_partner','global'),('fee-other','creator','global');
-- Reviewed publication is fixture setup; the guest cancellation is exercised below under its own JWT.
insert into public.inspection_requests(id,request_code,owner_id,owner_email,property_type,property_address,property_city,property_state,status,field_photo_urls)
values('79676666-3000-4000-8000-000000000001','REFUND-HOTEL-CONTRACT','fee-owner','fee-owner@example.invalid','hotel','Contract address','Lafia','Nasarawa','completed',array['field-1','field-2','field-3','field-4']);
select pg_temp.sign_in('79676666-0000-4000-8000-000000000003');
set local role authenticated;
select public.configure_property_document_requirements('79676666-3000-4000-8000-000000000001',0,
public.get_property_document_review('79676666-3000-4000-8000-000000000001')->'requirements','Rollback-only accepted Hotel operator and jurisdiction evidence.');
select pg_temp.sign_in('79676666-0000-4000-8000-000000000001');
do $$declare rule jsonb; doc jsonb; begin
 for rule in select value from jsonb_array_elements(public.get_property_document_review('79676666-3000-4000-8000-000000000001')->'requirements') loop
  doc:=public.begin_property_document_upload('79676666-3000-4000-8000-000000000001',rule->>'code',gen_random_uuid(),'application/pdf',12,'contract-evidence.pdf');
  perform public.reserve_my_media_upload('property-documents',doc->>'object_path');
  insert into storage.objects(bucket_id,name,metadata,version) values('property-documents',doc->>'object_path','{"size":12,"mimetype":"application/pdf"}'::jsonb,gen_random_uuid()::text);
  perform public.finish_property_document_upload((doc->>'id')::uuid,false);
 end loop;
end $$;
select pg_temp.sign_in('79676666-0000-4000-8000-000000000003');
do $$declare doc jsonb; begin
 for doc in select value from jsonb_array_elements(public.get_property_document_review('79676666-3000-4000-8000-000000000001')->'documents') loop
  perform public.review_property_document((doc->>'id')::uuid,'approved','Rollback-only independent accepted Hotel evidence.',now()+interval '1 year');
 end loop;
end $$;
reset role;
insert into public.hotels(hotel_id,name,state,city,owner_id,status,inspection_request_id,approved_by,approved_at)
values(-7967,'Fee Hotel','Nasarawa','Lafia','fee-owner','active','79676666-3000-4000-8000-000000000001','fee-other',now());
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values(-7967,-7967,'Standard',20000,1);

-- A paused synthetic connection must retain cancellation delivery without blocking the guest.
insert into public.hotel_pms_providers(provider_key,display_name) values('rollback-pms-contract','Rollback-only PMS fixture');
insert into public.hotel_integrations(integration_id,hotel_id,provider,connection_name,status,scopes,authoritative_domains)
values('79676666-4000-4000-8000-000000000001',-7967,'rollback-pms-contract','Rollback-only connection','requested',array['reservations.read','reservations.ack','reservations.receive'],array[]::text[]);
insert into public.hotel_room_units(unit_id,hotel_id,room_id,unit_label,status)
overriding system value values(-7967,-7967,-7967,'101','ready');
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,price_per_night,refundable,cancellation_template,cancellation_hours)
overriding system value values(-7967,-7967,-7967,'Fee contract rate',20000,true,'standard',24);
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
select 'accommodation_arrival_issue_window',99003,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}'::jsonb,
 'active',now()-interval '1 minute','reviewed','Rollback-only cancellation fixture','hotel-fee-contract'
where not exists(select 1 from public.creator_policy_versions where policy_key='accommodation_arrival_issue_window' and scope_type='global' and scope_key='*' and status='active');
update public.hotels set published_at=now(),timezone='Africa/Lagos',check_in_time='14:00' where hotel_id=-7967;
select pg_temp.sign_in('79676666-0000-4000-8000-000000000002');
set local role authenticated;

reset role;
-- A 5% WeHouse offer must leave the Hotel its own price less the saved 12% fee.
update public.creator_policy_versions set status='retired' where policy_key='commission_hotel' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('commission_hotel',99031,'{"percent":12}','active',now()-interval '1 minute','reviewed','Rollback-only fee fixture','hotel-fee-12');
insert into public.hotel_discounts(hotel_id,percent,starts_on,created_by,funded_by)
values(-7967,5,current_date,'fee-other','wehouse');
select pg_temp.sign_in('79676666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare b public.hotel_bookings; q jsonb; again jsonb;begin
 b:=public.create_my_hotel_booking_with_rate('79676666-5000-4000-8000-000000000001',-7967,-7967,-7967,
  current_date+3,current_date+5,1,'Fee guest','08000000000',null);
 if b.total_price<>38000 then raise exception 'Funded discount did not reach the customer quote';end if;
 q:=public.create_hotel_booking_payment(b.booking_id);
 again:=public.create_hotel_booking_payment(b.booking_id);
 if q->>'reference' is distinct from again->>'reference' then raise exception 'Retry created a second checkout';end if;
 perform set_config('test.hotel_booking_id',b.booking_id::text,true);
 perform set_config('test.hotel_reference',q->>'reference',true);
end$$;
reset role;
do $$declare p public.booking_payments;begin
 select * into p from public.booking_payments where paystack_reference=current_setting('test.hotel_reference');
 if p.commission_rate<>12 or p.amount_commission<>2800 or p.net_amount<>35200
  or p.commission_frozen_at is null or p.commission_policy_version_id is null
  or (p.metadata#>>'{hotel_fee_snapshot,partner_basis}')::numeric<>40000 then
  raise exception 'Checkout did not conserve the saved Hotel earnings and funded offer: %',to_jsonb(p);end if;
 begin update public.booking_payments set amount_commission=3000,net_amount=35000 where id=p.id;
  raise exception 'FAIL: changed accepted Hotel earnings';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 begin update public.booking_payments set hotel_booking_id=hotel_booking_id+1 where id=p.id;
  raise exception 'FAIL: moved checkout to another Hotel stay';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 begin update public.booking_payments set metadata=jsonb_set(metadata,'{hotel_fee_snapshot,partner_basis}','39000') where id=p.id;
  raise exception 'FAIL: changed saved funded-offer basis';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end$$;
-- A policy change must affect future checkouts, never this customer's existing reference.
update public.creator_policy_versions set status='retired' where policy_key='commission_hotel' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('commission_hotel',99032,'{"percent":20}','active',now(),'reviewed','Rollback-only changed fee','hotel-fee-20');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare r jsonb;begin
 r:=public.process_verified_paystack_charge('fee-event','charge.success',current_setting('test.hotel_reference'),repeat('a',64),now(),3800000,'NGN','fee-transaction');
 if not coalesce((r->>'success')::boolean,false) then raise exception 'Verified charge failed: %',r;end if;
 r:=public.process_verified_paystack_charge('fee-event','charge.success',current_setting('test.hotel_reference'),repeat('a',64),now(),3800000,'NGN','fee-transaction');
 if not coalesce((r->>'already_processed')::boolean,false) then raise exception 'Repeated provider receipt was not idempotent';end if;
end$$;
reset role;
do $$declare p public.payment_protection_transactions; b public.hotel_bookings;begin
 select * into p from public.payment_protection_transactions where subject_type='hotel_stay' and subject_id=current_setting('test.hotel_booking_id');
 select * into b from public.hotel_bookings where booking_id=current_setting('test.hotel_booking_id')::integer;
 if p.amount_total<>38000 or p.amount_commission<>2800 or p.amount_payee<>35200 or p.commission_rate<>12
  or p.protection_state<>'protected' or p.protected_ledger_transaction_id is null
  or b.payment_status<>'paid' or b.status<>'confirmed' then
  raise exception 'Verified Hotel protection changed the agreed price or Partner net';end if;
 if (select count(*) from public.payment_protection_transactions where paystack_reference=current_setting('test.hotel_reference'))<>1 then
  raise exception 'Repeated receipt created duplicate protection';end if;
end$$;
-- A fee reduction that cannot fund a previously saved offer must stop BEFORE a new provider checkout.
update public.creator_policy_versions set status='retired' where policy_key='commission_hotel' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('commission_hotel',99033,'{"percent":12}','active',now(),'reviewed','Rollback-only restored fee','hotel-fee-12-again');
select pg_temp.sign_in('79676666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare b public.hotel_bookings;begin
 b:=public.create_my_hotel_booking_with_rate('79676666-5000-4000-8000-000000000002',-7967,-7967,-7967,
  current_date+8,current_date+10,1,'Fee guest','08000000000',null);
 perform set_config('test.unfunded_hotel_booking_id',b.booking_id::text,true);
end$$;
reset role;
update public.creator_policy_versions set status='retired' where policy_key='commission_hotel' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('commission_hotel',99034,'{"percent":0}','active',now(),'reviewed','Rollback-only unfundable fee','hotel-fee-0');
select pg_temp.sign_in('79676666-0000-4000-8000-000000000002');
set local role authenticated;
do $$begin
 begin perform public.create_hotel_booking_payment(current_setting('test.unfunded_hotel_booking_id')::integer);
  raise exception 'FAIL: unfunded offer started a checkout';
 exception when others then if sqlerrm not like 'The saved WeHouse offer exceeds%' then raise;end if;end;
end$$;
reset role;
do $$begin
 if exists(select 1 from public.booking_payments where hotel_booking_id=current_setting('test.unfunded_hotel_booking_id')::integer) then
  raise exception 'Failed fee validation left a payable reference';end if;
end$$;
select 'PASS: real Hotel checkout freezes funded discounts, earnings and repeat receipt allocations' as result;
rollback;
