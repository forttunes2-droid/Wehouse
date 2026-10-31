begin;
-- Real Auth sessions and trusted devices. All exercised commands keep triggers
-- enabled; the one historical-date fixture projection is explicitly isolated.
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('79706666-0000-4000-8000-000000000001','authenticated','authenticated','share-owner@example.invalid',now(),now()),
('79706666-0000-4000-8000-000000000002','authenticated','authenticated','share-guest@example.invalid',now(),now()),
('79706666-0000-4000-8000-000000000003','authenticated','authenticated','share-reviewer@example.invalid',now(),now());
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('79706666-0000-4000-8000-000000000001','share-owner@example.invalid','share-owner','user',true),
('79706666-0000-4000-8000-000000000002','share-guest@example.invalid','share-guest','user',true),
('79706666-0000-4000-8000-000000000003','share-reviewer@example.invalid','share-reviewer','user',true);
insert into auth.sessions(id,user_id,created_at,updated_at)
select replace(auth_id::text,'-0000-','-2000-')::uuid,auth_id::uuid,now(),now()
from public.profiles where user_id in('share-owner','share-guest','share-reviewer');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,replace(auth_id::text,'-0000-','-2000-'),'fee-'||user_id,'Browser',true,'trusted'
from public.profiles where user_id in('share-owner','share-guest','share-reviewer');
create function pg_temp.sign_in(p_auth uuid) returns void language sql as $$
select set_config('request.jwt.claims',jsonb_build_object('sub',p_auth,'session_id',replace(p_auth::text,'-0000-','-2000-'),'role','authenticated')::text,true)::text is not null;
$$;
grant execute on function pg_temp.sign_in(uuid) to authenticated;
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values('share-owner','property_partner','global'),('share-reviewer','creator','global');
-- Reviewed publication is fixture setup; the guest cancellation is exercised below under its own JWT.
insert into public.inspection_requests(id,request_code,owner_id,owner_email,property_type,property_address,property_city,property_state,status,field_photo_urls)
values('79706666-3000-4000-8000-000000000001','REFUND-HOTEL-CONTRACT','share-owner','share-owner@example.invalid','hotel','Contract address','Lafia','Nasarawa','completed',array['field-1','field-2','field-3','field-4']);
select pg_temp.sign_in('79706666-0000-4000-8000-000000000003');
set local role authenticated;
select public.configure_property_document_requirements('79706666-3000-4000-8000-000000000001',0,
public.get_property_document_review('79706666-3000-4000-8000-000000000001')->'requirements','Rollback-only accepted Hotel operator and jurisdiction evidence.');
select pg_temp.sign_in('79706666-0000-4000-8000-000000000001');
do $$declare rule jsonb; doc jsonb; begin
 for rule in select value from jsonb_array_elements(public.get_property_document_review('79706666-3000-4000-8000-000000000001')->'requirements') loop
  doc:=public.begin_property_document_upload('79706666-3000-4000-8000-000000000001',rule->>'code',gen_random_uuid(),'application/pdf',12,'contract-evidence.pdf');
  perform public.reserve_my_media_upload('property-documents',doc->>'object_path');
  insert into storage.objects(bucket_id,name,metadata,version) values('property-documents',doc->>'object_path','{"size":12,"mimetype":"application/pdf"}'::jsonb,gen_random_uuid()::text);
  perform public.finish_property_document_upload((doc->>'id')::uuid,false);
 end loop;
end $$;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000003');
do $$declare doc jsonb; begin
 for doc in select value from jsonb_array_elements(public.get_property_document_review('79706666-3000-4000-8000-000000000001')->'documents') loop
  perform public.review_property_document((doc->>'id')::uuid,'approved','Rollback-only independent accepted Hotel evidence.',now()+interval '1 year');
 end loop;
end $$;
reset role;
insert into public.hotels(hotel_id,name,state,city,owner_id,status,inspection_request_id,approved_by,approved_at)
values(-7970,'Fee Hotel','Nasarawa','Lafia','share-owner','active','79706666-3000-4000-8000-000000000001','share-reviewer',now());
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values(-7970,-7970,'Standard',20000,1);

-- A paused synthetic connection must retain cancellation delivery without blocking the guest.
insert into public.hotel_pms_providers(provider_key,display_name) values('rollback-pms-contract','Rollback-only PMS fixture');
insert into public.hotel_integrations(integration_id,hotel_id,provider,connection_name,status,scopes,authoritative_domains)
values('79706666-4000-4000-8000-000000000001',-7970,'rollback-pms-contract','Rollback-only connection','requested',array['reservations.read','reservations.ack','reservations.receive'],array[]::text[]);
insert into public.hotel_room_units(unit_id,hotel_id,room_id,unit_label,status)
overriding system value values(-7970,-7970,-7970,'101','ready');
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,price_per_night,refundable,cancellation_template,cancellation_hours)
overriding system value values(-7970,-7970,-7970,'Fee contract rate',20000,true,'standard',24);
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
select 'accommodation_arrival_issue_window',99003,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}'::jsonb,
 'active',now()-interval '1 minute','reviewed','Rollback-only cancellation fixture','hotel-fee-contract'
where not exists(select 1 from public.creator_policy_versions where policy_key='accommodation_arrival_issue_window' and scope_type='global' and scope_key='*' and status='active');
update public.hotels set published_at=now(),timezone='Africa/Lagos',check_in_time='14:00' where hotel_id=-7970;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;

reset role;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'FAIL: %',description;end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,service_role;
insert into auth.users(id,aud,role,email,created_at,updated_at) values
('79706666-0000-4000-8000-000000000004','authenticated','authenticated','share-peer@example.invalid',now(),now()),
('79706666-0000-4000-8000-000000000005','authenticated','authenticated','share-outsider@example.invalid',now(),now());
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('79706666-0000-4000-8000-000000000004','share-peer@example.invalid','share-peer','user',true),
('79706666-0000-4000-8000-000000000005','share-outsider@example.invalid','share-outsider','user',true);
insert into auth.sessions(id,user_id,created_at,updated_at)
select replace(auth_id::text,'-0000-','-2000-')::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('share-peer','share-outsider');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,replace(auth_id::text,'-0000-','-2000-'),'share-'||user_id,'Browser',true,'trusted'
from public.profiles where user_id in('share-peer','share-outsider');
insert into public.friends(user_low,user_high,requested_by,status)
values('share-guest','share-peer','share-guest','accepted');
update public.hotel_rooms set max_guests=3 where room_id=-7970;
update public.creator_policy_versions set status='retired' where policy_key='commission_hotel' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('commission_hotel',99101,'{"percent":12}','active',now()-interval '1 minute','reviewed','Rollback-only shared Hotel fee','shared-hotel-fee');
insert into public.hotel_discounts(hotel_id,percent,starts_on,created_by,funded_by)
values(-7970,5,current_date,'share-reviewer','wehouse');
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare b public.hotel_bookings;g jsonb;retry jsonb;begin
 b:=public.create_my_hotel_booking_with_rate('79706666-5000-4000-8000-000000000001',-7970,-7970,-7970,current_date+3,current_date+5,2,'Shared guest','08000000000',null);
 perform set_config('test.hotel_booking_id',b.booking_id::text,true);
 begin perform public.create_my_shared_hotel(b.booking_id,array['share-outsider']);raise exception 'FAIL: non-Friend can contribute';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 begin perform public.create_my_shared_hotel(b.booking_id,array['share-peer','share-peer']);raise exception 'FAIL: duplicate payer accepted';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 g:=public.create_my_shared_hotel(b.booking_id,array['share-peer']);
 retry:=public.create_my_shared_hotel(b.booking_id,array['share-peer']);
 perform pg_temp.expect(g->>'id'=retry->>'id','interrupted creation recovers the original group');
 perform pg_temp.expect(g->>'product_type'='hotel' and (g->>'hotel_booking_id')::integer=b.booking_id and g->>'listing_id' is null,'real Hotel identity, no fabricated Home');
 perform pg_temp.expect((g->>'total_amount')::numeric=38000 and jsonb_array_length(g->'members')=2,'one Hotel total and exactly two payers');
 perform pg_temp.expect(g->>'expires_at'=to_jsonb(b.payment_expires_at)#>>'{}','invitations preserve original room deadline');
 perform set_config('test.hotel_group_id',g->>'id',true);
 begin perform public.create_my_shared_housing_payment((g->>'id')::uuid);raise exception 'FAIL: checkout opened before both guests accepted';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 begin perform public.create_hotel_booking_payment(b.booking_id);raise exception 'FAIL: single-payer payment opened alongside shared costs';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000005');
set local role authenticated;
do $$begin
 begin perform public.get_my_shared_housing_group(current_setting('test.hotel_group_id')::uuid);raise exception 'FAIL: outsider can read participants';
 exception when insufficient_privilege then null;end;
 begin perform public.respond_to_shared_housing_invite(current_setting('test.hotel_group_id')::uuid,true);raise exception 'FAIL: outsider can accept';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000004');
set local role authenticated;
do $$declare g jsonb;p jsonb;begin
 g:=public.respond_to_shared_housing_invite(current_setting('test.hotel_group_id')::uuid,true);
 perform pg_temp.expect(g->>'status'='payment_pending','all accepted opens payer checkout');
 g:=public.respond_to_shared_housing_invite(current_setting('test.hotel_group_id')::uuid,true);
 p:=public.create_my_shared_housing_payment(current_setting('test.hotel_group_id')::uuid);
 perform set_config('test.peer_reference',p->>'reference',true);
 perform pg_temp.expect(p->>'reference'=public.create_my_shared_housing_payment(current_setting('test.hotel_group_id')::uuid)->>'reference','same guest retry reuses reference');
end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare p jsonb;begin
 p:=public.create_my_shared_housing_payment(current_setting('test.hotel_group_id')::uuid);
 perform set_config('test.owner_reference',p->>'reference',true);
end$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare p public.booking_payments;receipt jsonb;begin
 select * into p from public.booking_payments where paystack_reference=current_setting('test.peer_reference');
 perform pg_temp.expect((public.validate_shared_housing_checkout(p.id,'share-peer')->>'valid')::boolean,'peer checkout crosses canonical provider validation');
 perform pg_temp.expect(not (public.validate_shared_housing_checkout(p.id,'share-guest')->>'valid')::boolean,'another payer cannot reuse peer reference');
 receipt:=public.process_verified_paystack_charge('hotel-share-peer','charge.success',p.paystack_reference,repeat('a',64),now(),1900000,'NGN','hotel-peer-transaction');
 perform pg_temp.expect((receipt->>'success')::boolean,'first share is verified');
end$$;
reset role;
select pg_temp.expect((select status='pending' and payment_status<>'paid' from public.hotel_bookings where booking_id=current_setting('test.hotel_booking_id')::integer),'one paid share cannot confirm the room');
select pg_temp.expect(not exists(select 1 from public.activity_events where subject_type='shared_payment'
 and subject_id=current_setting('test.hotel_group_id') and event_type='hotel.stay_confirmed'),'partial funding sends no whole-stay confirmation');
select pg_temp.expect((select title='Shared Hotel invitation' and message like '%Fee Hotel%' from public.notifications
 where recipient_id='share-peer' and type='shared_home_invite' and source_id=current_setting('test.hotel_group_id')),
 'Hotel invitation names the Hotel and never calls a Friend a Roommate');
select pg_temp.sign_in('79706666-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.expect(public.get_my_shared_housing_group(current_setting('test.hotel_group_id')::uuid)->'hotel_arrival'='null'::jsonb,'partially paid group gets no confirmed arrival');
reset role;
-- Changing the active Creator fee after individual checkouts cannot change either share.
update public.creator_policy_versions set status='retired' where policy_key='commission_hotel' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('commission_hotel',99102,'{"percent":20}','active',now(),'reviewed','Rollback-only changed fee','shared-hotel-new-fee');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare receipt jsonb;begin
 receipt:=public.process_verified_paystack_charge('hotel-share-owner','charge.success',current_setting('test.owner_reference'),repeat('b',64),now(),1900000,'NGN','hotel-owner-transaction');
 perform pg_temp.expect((receipt->>'success')::boolean,'last share confirms the room');
 receipt:=public.process_verified_paystack_charge('hotel-share-owner','charge.success',current_setting('test.owner_reference'),repeat('b',64),now(),1900000,'NGN','hotel-owner-transaction');
 perform pg_temp.expect((receipt->>'already_processed')::boolean,'duplicate receipt is idempotent');
end$$;
reset role;
select pg_temp.expect((select status='confirmed' and payment_status='paid' and payment_protection_id is null from public.hotel_bookings where booking_id=current_setting('test.hotel_booking_id')::integer),'one booking confirmed without replacing all payers by a fake primary protection');
select pg_temp.expect((select count(*)=2 and sum(p.amount_total)=38000 and sum(p.amount_commission)=2800 and sum(p.amount_payee)=35200
 from public.shared_payment_protection_components c join public.payment_protection_transactions p on p.id=c.payment_protection_id
 where c.shared_payment_group_id=current_setting('test.hotel_group_id')::uuid and c.component_type='hotel_stay'),'both payer balances conserve Hotel discount and frozen fee');
select pg_temp.expect((select count(*)=2 from public.activity_events e join public.activity_event_audiences a using(activity_event_id)
 where e.subject_type='shared_payment' and e.subject_id=current_setting('test.hotel_group_id') and e.event_type='hotel.stay_confirmed'
 and e.route='my_reservations' and e.route_params->>'booking_id'=current_setting('test.hotel_group_id') and a.workspace='personal'
 and a.recipient_user_id in('share-guest','share-peer')),'both accepted payers receive the final confirmation with a working shared-booking destination');
select pg_temp.expect((select count(*)=1 from public.activity_events e join public.activity_event_audiences a using(activity_event_id)
 where e.subject_type='hotel_booking' and e.subject_id=current_setting('test.hotel_booking_id') and e.event_type='hotel.stay_confirmed'
 and a.recipient_user_id='share-owner' and a.workspace='partner'),'Hotel owner receives one room-booking confirmation');
select pg_temp.expect(not exists(select 1 from public.activity_events e join public.activity_event_audiences a using(activity_event_id)
 where e.subject_type='hotel_booking' and e.subject_id=current_setting('test.hotel_booking_id') and e.event_type='hotel.stay_confirmed'
 and a.workspace='personal'),'shared organiser receives no duplicate single-payer destination');
select pg_temp.sign_in('79706666-0000-4000-8000-000000000004');
set local role authenticated;
do $$declare g jsonb;begin
 g:=public.get_my_shared_housing_group(current_setting('test.hotel_group_id')::uuid);
 perform pg_temp.expect(g->>'status'='paid' and g->'hotel_arrival' is distinct from 'null'::jsonb,'paid guest sees own shared arrival');
 g:=public.get_my_payment_receipts(null,'hotel',current_setting('test.hotel_booking_id'));
 perform pg_temp.expect(jsonb_array_length(g)=1 and g->0->>'reference'=current_setting('test.peer_reference')
  and (g->0->>'amount')::numeric=19000 and (g->0#>>'{cancellation_snapshot,refund_amount_ngn}')::numeric=19000
  and g->0->>'payer_name'<>'Shared guest' and g->0->>'description'='Your Hotel booking share','receipt belongs to this payer and never promises the entire room refund');
 begin perform public.cancel_my_hotel_booking(current_setting('test.hotel_booking_id')::integer);raise exception 'FAIL: invited guest cancels the whole stay';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare q jsonb;begin
 q:=public.get_my_hotel_cancellation_preview(current_setting('test.hotel_booking_id')::integer);
 perform pg_temp.expect(q->>'kind'='full_refund' and (q->>'refund_amount_ngn')::numeric=38000,'organiser sees aggregate refund to original payers');
 perform public.cancel_my_hotel_booking(current_setting('test.hotel_booking_id')::integer);
 perform public.cancel_my_hotel_booking(current_setting('test.hotel_booking_id')::integer);
end$$;
reset role;
select pg_temp.expect((select count(*)=2 and sum(a.amount)=38000 from public.financial_action_outbox a
 join public.shared_payment_protection_components c on c.payment_protection_id=a.payment_protection_id
 where c.shared_payment_group_id=current_setting('test.hotel_group_id')::uuid and a.action_type='refund_shared_checkout'),'cancelling whole stay queues exactly one original-payer refund per paid share');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare action_row record;receipt jsonb;provider_id text;begin
 perform public.claim_financial_actions('hotel-share-refund-fixture',10);
 for action_row in select a.* from public.financial_action_outbox a join public.shared_payment_protection_components c on c.payment_protection_id=a.payment_protection_id
  where c.shared_payment_group_id=current_setting('test.hotel_group_id')::uuid and a.action_type='refund_shared_checkout' loop
  provider_id:='refund-'||action_row.financial_action_id;
  perform public.record_refund_provider_submission(action_row.financial_action_id,provider_id,'pending',repeat('c',64));
  receipt:=public.process_verified_paystack_refund_event('processed-'||provider_id,'refund.processed',
   (select paystack_reference from public.payment_protection_transactions where id=action_row.payment_protection_id),provider_id,provider_id,repeat('d',64),now(),(action_row.amount*100)::bigint,'NGN');
  perform pg_temp.expect((receipt->>'success')::boolean,'verified refund completes each original-payer action');
 end loop;
end$$;
reset role;
select pg_temp.expect((select payment_status='refunded' and status='cancelled' from public.hotel_bookings where booking_id=current_setting('test.hotel_booking_id')::integer),'Hotel refund projection waits for all payer receipts');
select pg_temp.expect((select count(*)=2 from public.shared_payment_members where shared_payment_group_id=current_setting('test.hotel_group_id')::uuid and payment_state='refunded'),'both canonical payer histories retain completed refunds');
select pg_temp.expect((select count(*)=2 from public.shared_payment_members where shared_payment_group_id=current_setting('test.hotel_group_id')::uuid and checkout_accepted_at is not null),'both guests retain dated acceptance of the one saved agreement');
-- Three payers conserve indivisible minor units. A late charge after cancellation
-- must be recorded and refunded, never revive the room or disappear as a failed UI.
insert into public.friends(user_low,user_high,requested_by,status) values('share-guest','share-outsider','share-guest','accepted');
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare b public.hotel_bookings;g jsonb;begin
 b:=public.create_my_hotel_booking_with_rate('79706666-5000-4000-8000-000000000002',-7970,-7970,-7970,current_date+8,current_date+10,2,'Shared guest','08000000000',null);
 begin perform public.create_my_shared_hotel(b.booking_id,array['share-peer','share-outsider']);raise exception 'FAIL: three payers exceeded two declared guests';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 perform public.release_my_hotel_booking_hold(b.booking_id);
 b:=public.create_my_hotel_booking_with_rate('79706666-5000-4000-8000-000000000003',-7970,-7970,-7970,current_date+8,current_date+10,3,'Shared guest','08000000000',null);
 g:=public.create_my_shared_hotel(b.booking_id,array['share-peer','share-outsider']);
 perform set_config('test.three_hotel_booking_id',b.booking_id::text,true);perform set_config('test.three_hotel_group_id',g->>'id',true);
end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000004');
set local role authenticated;
select public.respond_to_shared_housing_invite(current_setting('test.three_hotel_group_id')::uuid,true);
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000005');
set local role authenticated;
select public.respond_to_shared_housing_invite(current_setting('test.three_hotel_group_id')::uuid,true);
select public.create_my_shared_housing_payment(current_setting('test.three_hotel_group_id')::uuid);
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000004');
set local role authenticated;
select public.create_my_shared_housing_payment(current_setting('test.three_hotel_group_id')::uuid);
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
select public.create_my_shared_housing_payment(current_setting('test.three_hotel_group_id')::uuid);
reset role;
select pg_temp.expect((select count(*)=3 and sum(amount_total)=38000 and sum(net_amount)=32000 and sum(amount_commission)=6000
 from public.booking_payments where hotel_booking_id=current_setting('test.three_hotel_booking_id')::integer),'three checkouts conserve every minor unit and the saved Partner net');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare payment public.booking_payments;receipt jsonb;begin
 for payment in select * from public.booking_payments where hotel_booking_id=current_setting('test.three_hotel_booking_id')::integer and user_id<>'share-peer' order by id loop
  perform pg_temp.expect(payment.paystack_reference is not null and payment.amount_total>0,'three-payer checkout has a reference and positive amount');
  receipt:=public.process_verified_paystack_charge('three-'||payment.user_id,'charge.success',payment.paystack_reference,repeat('e',64),now(),(payment.amount_total*100)::bigint,'NGN','three-'||payment.user_id);
  perform pg_temp.expect((receipt->>'success')::boolean,'two of three distinct payer receipts verify');
 end loop;
end$$;
reset role;
select pg_temp.expect((select status='pending' from public.hotel_bookings where booking_id=current_setting('test.three_hotel_booking_id')::integer),'two of three shares cannot confirm a stay');
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
select public.cancel_my_hotel_booking(current_setting('test.three_hotel_booking_id')::integer);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare payment public.booking_payments;receipt jsonb;begin
 select * into payment from public.booking_payments where hotel_booking_id=current_setting('test.three_hotel_booking_id')::integer and user_id='share-peer';
 perform pg_temp.expect(payment.id is not null,'cancelled third payer retains its payment history');
 perform pg_temp.expect(not (public.validate_shared_housing_checkout(payment.id,payment.user_id)->>'valid')::boolean,'cancelled group cannot start another provider checkout');
 receipt:=public.process_verified_paystack_charge('three-late-peer','charge.success',payment.paystack_reference,repeat('f',64),now(),(payment.amount_total*100)::bigint,'NGN','three-late-peer');
 perform pg_temp.expect((receipt->>'success')::boolean and (receipt#>>'{lifecycle_result,refund_required}')::boolean,'a genuine late charge remains recorded and enters original-payer refund recovery');
end$$;
reset role;
select pg_temp.expect((select status='cancelled' and payment_status='refund_pending' from public.hotel_bookings where booking_id=current_setting('test.three_hotel_booking_id')::integer),'late payment never reopens the cancelled room');
select pg_temp.expect((select count(*)=3 and sum(a.amount)=38000 from public.financial_action_outbox a join public.shared_payment_protection_components c on c.payment_protection_id=a.payment_protection_id
 where c.shared_payment_group_id=current_setting('test.three_hotel_group_id')::uuid and a.action_type='refund_shared_checkout'),'exactly three conserved original-payer refund actions, including the late receipt');
-- Arrival uses the actual guest-code command and Partner confirmation. A paid
-- invited guest can report a timely issue; every payer's funds must freeze.
update public.hotels set check_in_time='00:00' where hotel_id=-7970;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('test.arrival_booking_id',(public.create_my_hotel_booking_with_rate('79706666-5000-4000-8000-000000000004',
 -7970,-7970,-7970,current_date+20,current_date+22,2,'Arrival guest','08000000000',null)).booking_id::text,true);
reset role;
-- Historical-date fixture projection before any group agreement or payment.
-- Construction is future-dates-only; a rollback test cannot wait twenty days.
-- Keep the two-night quote. Disable triggers only for this unpaid test record's
-- date projection, restoring them before all acceptance/gateway/arrival calls.
set local session_replication_role=replica;
update public.hotel_bookings set check_in=timezone('Africa/Lagos',now())::date,check_out=timezone('Africa/Lagos',now())::date+2,
 cancellation_snapshot=jsonb_set(cancellation_snapshot,'{deadline}',to_jsonb(now()-interval '24 hours'))
where booking_id=current_setting('test.arrival_booking_id')::integer;
set local session_replication_role=origin;
set local role authenticated;
do $$declare b public.hotel_bookings;g jsonb;begin
 select * into b from public.hotel_bookings where booking_id=current_setting('test.arrival_booking_id')::integer;
 g:=public.create_my_shared_hotel(b.booking_id,array['share-peer']);
 perform set_config('test.arrival_booking_id',b.booking_id::text,true);
 perform set_config('test.arrival_group_id',g->>'id',true);
end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000004');
set local role authenticated;
select public.respond_to_shared_housing_invite(current_setting('test.arrival_group_id')::uuid,true);
select public.create_my_shared_housing_payment(current_setting('test.arrival_group_id')::uuid);
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
select public.create_my_shared_housing_payment(current_setting('test.arrival_group_id')::uuid);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare payment public.booking_payments;receipt jsonb;begin
 for payment in select * from public.booking_payments where hotel_booking_id=current_setting('test.arrival_booking_id')::integer order by id loop
  receipt:=public.process_verified_paystack_charge('arrival-'||payment.user_id,'charge.success',payment.paystack_reference,
   repeat('a',64),now(),(payment.amount_total*100)::bigint,'NGN','arrival-'||payment.user_id);
  perform pg_temp.expect((receipt->>'success')::boolean,'shared arrival is funded by real verified receipts');
 end loop;
end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000005');
set local role authenticated;
do $$begin
 begin perform public.get_my_accommodation_protection('hotel',current_setting('test.arrival_booking_id'));
  raise exception 'FAIL: unrelated account read shared arrival protection';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('test.arrival_code',public.issue_my_hotel_stay_code(current_setting('test.arrival_booking_id')::integer,'checked_in'),true);
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000001');
set local role authenticated;
do $$declare receipt jsonb;begin
 receipt:=public.partner_confirm_hotel_stay_with_code(current_setting('test.arrival_booking_id')::integer,'checked_in',current_setting('test.arrival_code'));
 perform pg_temp.expect((receipt->>'success')::boolean,'Partner verifies organiser presence for one shared room');
end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000004');
set local role authenticated;
do $$declare info jsonb;case_id uuid;begin
 info:=public.get_my_accommodation_protection('hotel',current_setting('test.arrival_booking_id'));
 perform pg_temp.expect((info->>'can_report_arrival_issue')::boolean and (info->>'amount_total')::numeric=19000,
  'invited paid guest sees own protected share and the real arrival window');
 case_id:=public.report_my_accommodation_arrival_issue('hotel',current_setting('test.arrival_booking_id'),'The booked room is unsafe and does not match the accepted listing.');
 perform pg_temp.expect(case_id is not null,'guest arrival problem opens a tracked operational case');
 info:=public.get_my_accommodation_protection('hotel',current_setting('test.arrival_booking_id'));
 perform pg_temp.expect(info->>'protection_state'='disputed' and info->>'arrival_issue_case_id'=case_id::text
  and not (info->>'can_report_arrival_issue')::boolean,'report receipt remains connected to this guest and prevents duplicate submission');
end$$;
reset role;
select pg_temp.expect((select count(*)=2 and bool_and(p.protection_state='disputed' and p.released_amount=0)
 from public.shared_payment_protection_components c join public.payment_protection_transactions p on p.id=c.payment_protection_id
 where c.shared_payment_group_id=current_setting('test.arrival_group_id')::uuid),'timely shared arrival problem freezes every payer, not just its reporter');
select pg_temp.expect(not exists(select 1 from public.financial_action_outbox a join public.shared_payment_protection_components c on c.payment_protection_id=a.payment_protection_id
 where c.shared_payment_group_id=current_setting('test.arrival_group_id')::uuid and a.action_type='release_hotel_stay' and a.status in('pending','processing')),
 'a frozen shared arrival cannot retain an executable Partner release');

-- Abandoned Home invitations must retain the earlier expiry repair too. These
-- rollback-only pending groups represent unpaid historical holds, not new sales.
insert into public.listings(id,listing_id,title,price,property_type,sub_type,status,availability_status,owner_id)
values('79706666-6000-4000-8000-000000000001','shared-expiry-fixture','Unpublished expiry fixture',100000,'apartment','long_stay','pending_approval','pending_approval','share-owner');
do $$declare stage text;gid uuid;mid uuid;person text;begin
 foreach stage in array array['inviting','ready'] loop
  gid:=gen_random_uuid();
  insert into public.shared_housing_groups(id,listing_id,created_by,status,member_limit,total_amount,expires_at,payment_phase,product_type,canonical_group_id)
  values(gid,'79706666-6000-4000-8000-000000000001','share-guest',stage,2,5000,now()-interval '1 minute','reservation_fee','long_let',gid);
  insert into public.shared_payment_groups(shared_payment_group_id,product_type,listing_id,created_by,total_amount,capacity,status,checkout_expires_at,legacy_group_id,payment_phase)
  values(gid,'long_let','79706666-6000-4000-8000-000000000001','share-guest',5000,2,stage,now()-interval '1 minute',gid,'reservation_fee');
  foreach person in array array['share-guest','share-peer'] loop
   mid:=gen_random_uuid();
   insert into public.shared_housing_members(id,group_id,user_id,invitation_status,share_amount,payment_status,canonical_member_id)
   values(mid,gid,person,case when stage='ready' or person='share-guest' then 'accepted' else 'invited' end,2500,'not_started',mid);
   insert into public.shared_payment_members(shared_payment_member_id,shared_payment_group_id,user_id,share_amount,invitation_state,payment_state,legacy_member_id)
   values(mid,gid,person,2500,case when stage='ready' or person='share-guest' then 'accepted' else 'invited' end,'not_started',mid);
  end loop;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.expire_shared_payment_checkout_from_service(gid);
  perform pg_temp.expect((select status='expired' from public.shared_housing_groups where id=gid),'unpaid Home '||stage||' expires');
  perform pg_temp.expect((select status='expired' from public.shared_payment_groups where shared_payment_group_id=gid),'canonical unpaid Home expiry agrees');
 end loop;
end$$;
-- Same-day policy uses the existing Hotel, actual constructors, shared checkout
-- and verified-charge gateway. No financial projection is fabricated here.
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000001');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms,max_guests)
values(-7979,-7970,'Same-day room',20000,3,3);
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,meal_plan,payment_timing,refundable,cancellation_hours,price_per_night,included_features,active,cancellation_template)
values(-7979,-7970,-7979,'Same-day flexible','room_only','pay_now',true,24,20000,array[]::text[],true,'standard');
set local role authenticated;
do $$declare h public.hotels;r public.hotels;revision timestamptz;cutoff time;begin
 select * into h from public.hotels where hotel_id=-7970;revision:=h.updated_at;
 r:=public.partner_update_hotel_stay_policy(-7970,time '14:00',time '12:00',time '23:59',revision);
 perform pg_temp.expect(r.same_day_booking_cutoff=time '23:59','the authorised Hotel manager can enable same-day bookings');
 r:=public.partner_update_hotel_stay_policy(-7970,time '14:00',time '12:00',time '23:59',revision);
 begin perform public.partner_update_hotel_stay_policy(-7970,time '15:00',time '12:00',time '22:00',revision-interval '1 second');raise exception 'FAIL: stale Hotel policy overwritten';exception when serialization_failure then null;end;
 begin perform public.partner_update_hotel_stay_policy(-7970,time '14:00',time '12:00',time '23:59:30',r.updated_at);raise exception 'FAIL: invalid cutoff precision accepted';exception when check_violation then null;end;
 r:=public.partner_update_hotel_stay_policy(-7970,time '14:30',time '12:00');
 perform pg_temp.expect(r.same_day_booking_cutoff=time '23:59','older arrival-time clients retain the configured cutoff');
 cutoff:=case when timezone('Africa/Lagos',now())::time<time '23:54' then (date_trunc('minute',timezone('Africa/Lagos',now()))+interval '5 minutes')::time else time '23:59' end;
 r:=public.partner_update_hotel_stay_policy(-7970,time '00:00',time '12:00',cutoff,r.updated_at);
 perform pg_temp.expect(public.get_public_hotel_detail(-7970)->>'same_day_booking_cutoff'=to_jsonb(cutoff)#>>'{}','the customer projection carries the configured cutoff');
end$$;
reset role;
-- Verify persisted audit effects as the fixture administrator; users retain no raw audit-table access.
select pg_temp.expect((select count(*)=case when (select same_day_booking_cutoff from public.hotels where hotel_id=-7970)=time '23:59' then 1 else 2 end from public.hotel_commercial_change_audit where hotel_id=-7970 and action='same_day_booking_cutoff_updated'),'retried, stale and invalid policy changes add no duplicate audit records');
-- Hotel ownership alone cannot bypass the live trusted-session requirement.
select set_config('request.jwt.claims',jsonb_build_object('sub','79706666-0000-4000-8000-000000000001','session_id','79706666-9999-4000-8000-000000000001','role','authenticated')::text,true);
set local role authenticated;
do $$begin
 begin perform public.partner_update_hotel_stay_policy(-7970,time '00:00',time '12:00',time '23:59',now());raise exception 'FAIL: inactive owner session changed Hotel cutoff';exception when insufficient_privilege then null;end;
end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare h public.hotels;b public.hotel_bookings;retry public.hotel_bookings;q jsonb;g jsonb;today date:=timezone('Africa/Lagos',now())::date;begin
 begin perform public.partner_update_hotel_stay_policy(-7970,time '00:00',time '12:00',time '23:59',now());raise exception 'FAIL: guest changed Hotel cutoff';exception when insufficient_privilege then null;end;
 -- The late-night closed branch is legitimate. Fixed-clock cases separately
 -- prove every boundary; release evidence records the actual open path below.
 if timezone('Africa/Lagos',now())::time>=time '23:59' then
  begin perform public.quote_hotel_room_rate(-7970,-7979,-7979,today,today+2);raise exception 'FAIL: closed same-day quote';exception when invalid_parameter_value then null;end;
  perform set_config('test.same_day_group','closed',true);
 else
  q:=public.quote_hotel_room_rate(-7970,-7979,-7979,today,today+2);
  perform pg_temp.expect((q->>'available')::boolean and (q->>'same_day_booking_cutoff_at')::timestamptz>now(),'same-day quote returns its live Hotel deadline');
  b:=public.create_my_hotel_booking_with_rate('79706666-5000-4000-8000-000000000099',-7970,-7979,-7979,today,today+2,2,'Same-day guest','08000000000',null);
  perform pg_temp.expect(b.payment_expires_at=(q->>'same_day_booking_cutoff_at')::timestamptz and b.payment_expires_at<now()+interval '30 minutes','the actual room hold is clipped to the Hotel cutoff');
  retry:=public.create_my_hotel_booking_with_rate('79706666-5000-4000-8000-000000000099',-7970,-7979,-7979,today,today+2,2,'Same-day guest','08000000000',null);
  perform pg_temp.expect(retry.booking_id=b.booking_id and retry.payment_expires_at=b.payment_expires_at,'retry preserves one same-day room and its original deadline');
  g:=public.create_my_shared_hotel(b.booking_id,array['share-peer']);
  perform pg_temp.expect((g->>'expires_at')::timestamptz=b.payment_expires_at,'every shared payer retains the clipped room deadline');
  perform set_config('test.same_day_group',g->>'id',true);perform set_config('test.same_day_booking',b.booking_id::text,true);
 end if;
end$$;
reset role;
-- Disabling new same-day sales must not cancel or extend a saved room hold.
select pg_temp.sign_in('79706666-0000-4000-8000-000000000001');
set local role authenticated;
do $$declare h public.hotels;begin select * into h from public.hotels where hotel_id=-7970;
 perform public.partner_update_hotel_stay_policy(-7970,time '00:00',time '12:00',null,h.updated_at);end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000004');
set local role authenticated;
do $$declare p jsonb;begin if current_setting('test.same_day_group')<>'closed' then
 perform public.respond_to_shared_housing_invite(current_setting('test.same_day_group')::uuid,true);
 p:=public.create_my_shared_housing_payment(current_setting('test.same_day_group')::uuid);perform set_config('test.same_day_peer_ref',p->>'reference',true);
end if;end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare p jsonb;begin if current_setting('test.same_day_group')<>'closed' then
 p:=public.create_my_shared_housing_payment(current_setting('test.same_day_group')::uuid);perform set_config('test.same_day_guest_ref',p->>'reference',true);
end if;end$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare p public.booking_payments;r jsonb;begin if current_setting('test.same_day_group')<>'closed' then
 for p in select * from public.booking_payments where paystack_reference in(current_setting('test.same_day_peer_ref'),current_setting('test.same_day_guest_ref')) loop
  r:=public.process_verified_paystack_charge('same-day-'||p.id,'charge.success',p.paystack_reference,repeat('e',64),now(),(p.amount*100)::bigint,'NGN','same-day-'||p.id);
  perform pg_temp.expect((r->>'success')::boolean,'a saved same-day shared charge crosses the actual gateway after policy changes');
 end loop;
 perform pg_temp.expect((select status='confirmed' and payment_status='paid' from public.hotel_bookings where booking_id=current_setting('test.same_day_booking')::integer),'both verified shares confirm one same-day Hotel room');
end if;end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000002');
set local role authenticated;
do $$declare code text;begin if current_setting('test.same_day_group')<>'closed' then
 code:=public.issue_my_hotel_stay_code(current_setting('test.same_day_booking')::integer,'checked_in');
 perform pg_temp.expect(code ~ '^\d{8}$','same-day guest receives a private arrival code');
 perform set_config('test.same_day_arrival_code',code,true);
end if;end$$;
reset role;
select pg_temp.sign_in('79706666-0000-4000-8000-000000000001');
set local role authenticated;
do $$begin if current_setting('test.same_day_group')<>'closed' then
 perform public.partner_confirm_hotel_stay_with_code(current_setting('test.same_day_booking')::integer,'checked_in',current_setting('test.same_day_arrival_code'));
 perform pg_temp.expect((public.get_my_hotel_operation_snapshot(-7970)->'bookings') @> jsonb_build_array(jsonb_build_object('booking_id',current_setting('test.same_day_booking')::integer,'status','checked_in')),'Hotel records same-day guest arrival after verified shared payment');
end if;end$$;
reset role;
select 'PASS: Hotel shared payments, same-day quote/hold/gateway/arrival, saved deadlines, late refunds and Home expiry' as result;
rollback;
