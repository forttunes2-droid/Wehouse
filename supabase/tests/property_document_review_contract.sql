begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %',description; end if; end $$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end $$;
create function pg_temp.rejects_with(statement text, expected text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return position(expected in sqlerrm)>0;end $$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated,anon;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city) values
('97200000-0000-4000-8000-000000000001','pdr-owner@example.invalid','pdr-owner','user',true,'consumer','Document Owner','Lagos','Ikeja'),
('97200000-0000-4000-8000-000000000002','pdr-reviewer@example.invalid','pdr-reviewer','user',true,'consumer','Document Reviewer','Lagos','Ikeja'),
('97200000-0000-4000-8000-000000000003','pdr-outsider@example.invalid','pdr-outsider','user',true,'consumer','Other Person','Lagos','Ikeja'),
('97200000-0000-4000-8000-000000000004','pdr-wrong@example.invalid','pdr-wrong','user',true,'consumer','Other Admin','Abuja','Garki'),
('97200000-0000-4000-8000-000000000005','pdr-creator@example.invalid','pdr-creator','user',true,'consumer','Creator','Abuja','Garki');
insert into auth.sessions(id,user_id,created_at,updated_at) values
('97210000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000001',now(),now()),
('97210000-0000-4000-8000-000000000002','97200000-0000-4000-8000-000000000002',now(),now()),
('97210000-0000-4000-8000-000000000003','97200000-0000-4000-8000-000000000003',now(),now()),
('97210000-0000-4000-8000-000000000004','97200000-0000-4000-8000-000000000004',now(),now()),
('97210000-0000-4000-8000-000000000005','97200000-0000-4000-8000-000000000005',now(),now());
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga) values
('pdr-owner','property_partner','global',null,null),('pdr-owner','creator','global',null,null),
('pdr-reviewer','admin','branch','Lagos','Ikeja'),('pdr-wrong','admin','state','Abuja',null),('pdr-creator','creator','global',null,null);
insert into public.inspection_requests(id,request_code,owner_id,owner_email,property_address,property_city,property_state,property_type,sub_type,status) values
('97220000-0000-4000-8000-000000000001','PDR-APARTMENT','pdr-owner','pdr-owner@example.invalid','Test address','Ikeja','Lagos','apartment','short_let','completed'),
('97220000-0000-4000-8000-000000000002','PDR-HOTEL','pdr-owner','pdr-owner@example.invalid','Test hotel address','Ikeja','Lagos','hotel',null,'completed');
update public.inspection_requests set final_media_reviewed_at=now(),final_media_reviewed_by='pdr-reviewer',
  field_photo_urls=array['field-1','field-2','field-3','field-4'],field_evidence_review_status='accepted',
  field_evidence_reviewed_by='pdr-reviewer',field_evidence_reviewed_at=now()
  where id in('97220000-0000-4000-8000-000000000001','97220000-0000-4000-8000-000000000002');
insert into public.listings(id,listing_id,title,price,currency,state,city,address,property_type,sub_type,bedrooms,bathrooms,max_guests,amenities,images,status,availability_status,owner_id,partner_id,inspection_request_id,management_mode,management_host_user_id,management_updated_at)
  values('97240000-0000-4000-8000-000000000001','pdr-public-home','Document contract home',25000,'NGN','Lagos','Ikeja','Test address','apartment','short_let',0,1,2,array['Furnished'],array['https://example.invalid/home.jpg'],'pending_approval','pending_approval','pdr-owner','pdr-owner','97220000-0000-4000-8000-000000000001','host','pdr-owner',now());
insert into public.hotels(hotel_id,name,state,city,owner_id,status,inspection_request_id,images)
  values(-97201,'Document contract Hotel','Lagos','Ikeja','pdr-owner','inactive','97220000-0000-4000-8000-000000000002',array['https://example.invalid/hotel.jpg']);
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values(-97201,-97201,'Standard',25000,1);
insert into public.hotel_rate_plans(rate_plan_id,hotel_id,room_id,name,price_per_night,active,refundable,cancellation_template,cancellation_hours)
 values(-97201,-97201,-97201,'Room only',25000,true,true,'standard',24);
insert into public.hotel_room_units(hotel_id,room_id,unit_label,status)
 values(-97201,-97201,'Document contract room','ready');
update public.inspection_requests set draft_listing_id='97240000-0000-4000-8000-000000000001',requested_management_mode='host' where id='97220000-0000-4000-8000-000000000001';
update public.inspection_requests set draft_hotel_id=-97201 where id='97220000-0000-4000-8000-000000000002';
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select p.user_id,p.auth_id,s.id::text,'pdr-device-'||p.user_id,'Contract browser',true,'trusted'
from public.profiles p join auth.sessions s on s.user_id::text=p.auth_id
where p.user_id in ('pdr-owner','pdr-reviewer','pdr-outsider','pdr-wrong','pdr-creator');
-- Booking fixtures use real required policy snapshots, all rolled back below.
do $policies$
declare item record;
begin
 for item in select * from (values
  ('accommodation_arrival_issue_window','{"default_hours":2,"minimum_hours":1,"maximum_hours":6}'::jsonb),
  ('short_let_cancellation','{"standard_full_refund_hours_before_check_in":24,"late_cancellation_requires_review":true,"provider_failure_full_refund":true,"payment_protection_required":true}'::jsonb),
  ('accommodation_non_refundable_rate','{"minimum_discount_percent":5,"maximum_discount_percent":20,"guest_cancellation_refund_percent":0,"no_show_provider_eligible_after_review":true,"security_deposit_full_refund_without_occupancy":true,"provider_failure_overrides_non_refundable":true,"payment_or_listing_mismatch_reviewable":true,"payment_protection_required":true}'::jsonb),
  ('commission_short_let','{"percent":10}'::jsonb),
  ('commission_short_let_wehouse_managed','{"percent":10}'::jsonb)
 ) rules(policy_key,value) loop
  update public.creator_policy_versions p set value=item.value,effective_from=now()-interval '1 minute',effective_until=null,legal_review_state='reviewed'
   where p.policy_key=item.policy_key and scope_type='global' and scope_key='*' and status='active';
  if not found then
   insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
    values(item.policy_key,99722,item.value,'active',now()-interval '1 minute','reviewed','Rollback-only document booking contract','pdr-'||item.policy_key);
  end if;
 end loop;
end $policies$;
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000001","session_id":"97210000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.get_property_document_review('97220000-0000-4000-8000-000000000001')->>'configured')::boolean=false,'requirements start unconfirmed, not a fake approval');
select pg_temp.expect(pg_temp.rejects($$select public.begin_property_document_upload('97220000-0000-4000-8000-000000000001','authority','97230000-0000-4000-8000-000000000001','application/pdf',12,'authority.pdf')$$),'collection waits for accepted requirements');
create temp table pdr_rules as select public.get_property_document_review('97220000-0000-4000-8000-000000000001')->'requirements' as rules;
select pg_temp.expect(pg_temp.rejects($$select public.configure_property_document_requirements('97220000-0000-4000-8000-000000000001',0,(select rules from pdr_rules),'Test jurisdiction evidence basis')$$),'Creator cannot configure their own property review');
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000004","session_id":"97210000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.get_property_document_review('97220000-0000-4000-8000-000000000001')$$),'out-of-state Admin cannot read private documents');
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000002","session_id":"97210000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.configure_property_document_requirements('97220000-0000-4000-8000-000000000001',null,(select rules from pdr_rules),'Test jurisdiction evidence basis')$$),'null optimistic revision cannot bypass concurrency');
select public.configure_property_document_requirements('97220000-0000-4000-8000-000000000001',0,(select rules from pdr_rules),'Test jurisdiction evidence basis');
select pg_temp.expect(pg_temp.rejects($$select public.admin_publish_inspected_listing('97240000-0000-4000-8000-000000000001')$$),'actual apartment publication cannot bypass missing documents');
select pg_temp.expect(pg_temp.rejects($$select public.admin_publish_inspected_hotel(-97201)$$),'actual Hotel publication cannot bypass unconfirmed requirements');
select pg_temp.expect(pg_temp.rejects($$select public.configure_property_document_requirements('97220000-0000-4000-8000-000000000001',0,(select rules from pdr_rules),'Test jurisdiction evidence basis')$$),'stale requirements cannot overwrite a newer revision');
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000001","session_id":"97210000-0000-4000-8000-000000000001","role":"authenticated"}',true);
create temp table pdr_upload as select public.begin_property_document_upload('97220000-0000-4000-8000-000000000001','authority','97230000-0000-4000-8000-000000000001','application/pdf',12,'authority.pdf') as doc;
select pg_temp.expect((public.begin_property_document_upload('97220000-0000-4000-8000-000000000001','authority','97230000-0000-4000-8000-000000000001','application/pdf',12,'authority.pdf')->>'id')=(select doc->>'id' from pdr_upload),'retries return the same document receipt');
select pg_temp.expect(pg_temp.rejects($$select public.begin_property_document_upload('97220000-0000-4000-8000-000000000001','address','97230000-0000-4000-8000-000000000001','application/pdf',12,'authority.pdf')$$),'receipt cannot be reused for another requirement');
select pg_temp.expect(pg_temp.rejects($$select public.finish_property_document_upload((select (doc->>'id')::uuid from pdr_upload),false)$$),'missing file never becomes submitted');
select public.reserve_my_media_upload('property-documents',doc->>'object_path') from pdr_upload;
insert into storage.objects(bucket_id,name,metadata,version) select 'property-documents',doc->>'object_path','{"size":12,"mimetype":"application/pdf"}'::jsonb,gen_random_uuid()::text from pdr_upload;
select public.finish_property_document_upload((select (doc->>'id')::uuid from pdr_upload),false);
select pg_temp.expect((public.finish_property_document_upload((select (doc->>'id')::uuid from pdr_upload),false)->>'status')='submitted','submission receipt is replayable');
select pg_temp.expect(pg_temp.rejects($$update public.property_submission_documents set status='approved' where id=(select (doc->>'id')::uuid from pdr_upload)$$),'owner cannot write approval directly');
select pg_temp.expect(pg_temp.rejects($$select public.review_property_document((select (doc->>'id')::uuid from pdr_upload),'approved','Own approval attempt',null)$$),'Creator cannot approve own document');
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000003","session_id":"97210000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.property_submission_documents where request_id='97220000-0000-4000-8000-000000000001')=0,'unrelated account sees no metadata');
select pg_temp.expect((select count(*) from storage.objects where bucket_id='property-documents' and name=(select doc->>'object_path' from pdr_upload))=0,'unrelated account sees no object');
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000002","session_id":"97210000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select public.review_property_document((select (doc->>'id')::uuid from pdr_upload),'correction_required','Upload the current signed authorization.',null);
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000001","session_id":"97210000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect(public.get_property_document_review('97220000-0000-4000-8000-000000000001')->'documents'->0->>'review_note'='Upload the current signed authorization.','Partner sees a persistent correction reason');
create temp table pdr_replacement as select public.begin_property_document_upload('97220000-0000-4000-8000-000000000001','authority','97230000-0000-4000-8000-000000000002','application/pdf',12,'authority-current.pdf') as doc;
select public.reserve_my_media_upload('property-documents',doc->>'object_path') from pdr_replacement;
insert into storage.objects(bucket_id,name,metadata,version) select 'property-documents',doc->>'object_path','{"size":12,"mimetype":"application/pdf"}'::jsonb,gen_random_uuid()::text from pdr_replacement;
select public.finish_property_document_upload((select (doc->>'id')::uuid from pdr_replacement),false);
do $$declare rule jsonb; d jsonb; begin
  for rule in select value from jsonb_array_elements((select rules from pdr_rules)) where value->>'code'<>'authority' loop
    d:=public.begin_property_document_upload('97220000-0000-4000-8000-000000000001',rule->>'code',gen_random_uuid(),'application/pdf',12,'evidence.pdf');
    perform public.reserve_my_media_upload('property-documents',d->>'object_path');
    insert into storage.objects(bucket_id,name,metadata,version) values('property-documents',d->>'object_path','{"size":12,"mimetype":"application/pdf"}'::jsonb,gen_random_uuid()::text);
    perform public.finish_property_document_upload((d->>'id')::uuid,false);
  end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000002","session_id":"97210000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.review_property_document((select (doc->>'id')::uuid from pdr_upload),'approved','Old version should fail',null)$$),'superseded document cannot be approved');
do $$declare doc jsonb; begin
  for doc in select value from jsonb_array_elements(public.get_property_document_review('97220000-0000-4000-8000-000000000001')->'documents') loop
    perform public.review_property_document((doc->>'id')::uuid,'approved','Reviewed accepted evidence against this property.',now()+interval '1 year');
  end loop;
end $$;
select pg_temp.expect((public.get_property_document_review('97220000-0000-4000-8000-000000000001')->>'ready')::boolean,'all current approved documents satisfy the document gate');
select public.admin_publish_inspected_listing('97240000-0000-4000-8000-000000000001');
select public.admin_publish_inspected_listing('97240000-0000-4000-8000-000000000001');
select public.configure_property_document_requirements('97220000-0000-4000-8000-000000000002',0,
  public.get_property_document_review('97220000-0000-4000-8000-000000000002')->'requirements','Accepted Hotel operator and local operating evidence for this test.');
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000001","session_id":"97210000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.admin_publish_inspected_listing('97240000-0000-4000-8000-000000000001')$$),'an owning Creator cannot grant publication approval');
do $$declare rule jsonb; d jsonb; begin
  for rule in select value from jsonb_array_elements(public.get_property_document_review('97220000-0000-4000-8000-000000000002')->'requirements') loop
    d:=public.begin_property_document_upload('97220000-0000-4000-8000-000000000002',rule->>'code',gen_random_uuid(),'application/pdf',12,'hotel-evidence.pdf');
    perform public.reserve_my_media_upload('property-documents',d->>'object_path');
    insert into storage.objects(bucket_id,name,metadata,version) values('property-documents',d->>'object_path','{"size":12,"mimetype":"application/pdf"}'::jsonb,gen_random_uuid()::text);
    perform public.finish_property_document_upload((d->>'id')::uuid,false);
  end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000005","session_id":"97210000-0000-4000-8000-000000000005","role":"authenticated"}',true);
do $$declare doc jsonb; begin
  for doc in select value from jsonb_array_elements(public.get_property_document_review('97220000-0000-4000-8000-000000000002')->'documents') loop
    perform public.review_property_document((doc->>'id')::uuid,'approved','Reviewed current Hotel operator and property evidence.',now()+interval '1 year');
  end loop;
end $$;
select public.admin_publish_inspected_hotel(-97201);
select public.admin_publish_inspected_hotel(-97201);
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.get_property_document_review('97220000-0000-4000-8000-000000000001')$$),'missing/revoked session cannot read private documents');
reset role;
select pg_temp.expect((select status='available' and bedrooms=0 from public.listings where id='97240000-0000-4000-8000-000000000001'),'additive Admin grant publishes the studio without changing zero bedrooms');
select pg_temp.expect((select status='active' from public.hotels where hotel_id=-97201),'additive Creator grant publishes the reviewed Hotel');
select pg_temp.expect((select count(*) from public.audit_logs where action='PROPERTY_PUBLICATION_APPROVED' and target_id='97240000-0000-4000-8000-000000000001')=1,'repeat publication retains one approval event');
select public._assert_property_documents_ready('97220000-0000-4000-8000-000000000001');
insert into public.reservations(id,listing_id,user_id,status,canonical_state,stay_type,stay_check_in,stay_check_out,stay_nights,stay_rent_total,tenancy_start_date)
 values('pdr-existing-stay','pdr-public-home','pdr-outsider','payment_pending','payment_pending','short_let',current_date+20,current_date+21,1,25000,null);
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,payment_status,guest_count,guest_name,guest_phone)
 values(-97201,-97201,-97201,'pdr-outsider',current_date+20,current_date+21,1,25000,'pending','unpaid',1,'Contract Guest','08000000000');
select pg_temp.expect((select count(*) from public.activity_events where subject_id='97220000-0000-4000-8000-000000000001' and event_type like 'property.document.%.submitted')=3,'submitted evidence reaches canonical operations activity');
select pg_temp.expect(not exists(select 1 from public.activity_event_audiences audience join public.activity_events event using(activity_event_id)
  where event.subject_id='97220000-0000-4000-8000-000000000001' and event.event_type in('property.document.correction_required','property.document.requirements_ready')
  and audience.workspace='property_partner' and audience.resolved_at is null),'completed correction and collection tasks do not stay actionable');
select pg_temp.expect(exists(select 1 from public.activity_event_audiences audience join public.activity_events event using(activity_event_id)
  where event.subject_id='97220000-0000-4000-8000-000000000001' and event.event_type='property.document.approved'
  and audience.workspace='property_partner' and audience.recipient_user_id='pdr-owner'),'Partner receives a private outcome through canonical Inbox');
update public.property_submission_documents set expires_at=now()-interval '1 day' where id=(select (doc->>'id')::uuid from pdr_replacement);
select pg_temp.expect(pg_temp.rejects($$select public._assert_property_documents_ready('97220000-0000-4000-8000-000000000001')$$),'expired evidence blocks new publication');
select pg_temp.expect(pg_temp.rejects_with($$insert into public.reservations(listing_id,user_id) values('pdr-public-home','pdr-outsider')$$,'needs current document approval'),'expired evidence blocks a new apartment reservation before payment');
update public.property_submission_documents set expires_at=now()-interval '1 day' where request_id='97220000-0000-4000-8000-000000000002';
select pg_temp.expect(pg_temp.rejects_with($$insert into public.hotel_bookings(hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price) values(-97201,-97201,'pdr-outsider',current_date+30,current_date+31,1,25000)$$,'needs current document approval'),'expired Hotel evidence blocks a new booking before payment');
select pg_temp.expect(private.expire_property_documents()=2,'expiry maintenance pauses the apartment and Hotel');
select pg_temp.expect(private.expire_property_documents()=0,'property expiry maintenance is idempotent');
select pg_temp.expect((select status='pending_approval' and availability_status='pending_approval' from public.listings where listing_id='pdr-public-home'),'expired apartment leaves discovery');
select pg_temp.expect((select status='inactive' from public.hotels where hotel_id=-97201),'expired Hotel leaves discovery');
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000002","session_id":"97210000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect((select count(*)=2 from jsonb_array_elements(public.get_my_property_pipeline_v2('preparing')) item
 where item->>'id' in ('97220000-0000-4000-8000-000000000001','97220000-0000-4000-8000-000000000002') and item->>'lifecycle_stage'='listing_prepared'),'paused properties return to the existing republication screen');
select pg_temp.expect((select count(*)=0 from jsonb_array_elements(public.get_my_property_pipeline_v2('published')) item
 where item->>'id' in ('97220000-0000-4000-8000-000000000001','97220000-0000-4000-8000-000000000002')),'paused properties are not described as currently public');
select pg_temp.expect((select status='payment_pending' from public.reservations where id='pdr-existing-stay'),'expiry preserves the existing apartment reservation');
select pg_temp.expect((select status='pending' from public.hotel_bookings where booking_id=-97201),'expiry preserves the existing Hotel booking');
update public.reservations set updated_at=now() where id='pdr-existing-stay';
update public.hotel_bookings set updated_at=now() where booking_id=-97201;
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000002","session_id":"97210000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $renewal$
declare document_id uuid;
begin
 for document_id in select id from public.property_submission_documents where request_id in
  ('97220000-0000-4000-8000-000000000001','97220000-0000-4000-8000-000000000002') and status='approved' and expires_at<=now()
 loop
  perform public.review_property_document(document_id,'approved','Current replacement approval reviewed for this rollback contract.',now()+interval '1 year');
 end loop;
end $renewal$;
select pg_temp.expect(not exists(select 1 from public.activity_event_audiences a join public.activity_events e using(activity_event_id)
 where e.subject_id in ('97220000-0000-4000-8000-000000000001','97220000-0000-4000-8000-000000000002')
  and e.event_type in ('property.document.expired','property.document.expiry_review') and a.resolved_at is null),'renewed approval resolves Partner and operations expiry tasks');
select pg_temp.expect((select status='pending_approval' from public.listings where listing_id='pdr-public-home'),'renewal still requires explicit republication');
select public.admin_publish_inspected_listing('97240000-0000-4000-8000-000000000001');
select public.admin_publish_inspected_hotel(-97201);
select pg_temp.expect((select count(*)=2 from jsonb_array_elements(public.get_my_property_pipeline_v2('published')) item
 where item->>'id' in ('97220000-0000-4000-8000-000000000001','97220000-0000-4000-8000-000000000002') and item->>'lifecycle_stage'='live'),'explicit republication restores the live pipeline state');
update public.inspection_requests set property_address='Corrected address' where id='97220000-0000-4000-8000-000000000001';
select pg_temp.expect((select document_requirements is null from public.inspection_requests where id='97220000-0000-4000-8000-000000000001'),'material property change invalidates the requirements snapshot');
select pg_temp.expect(pg_temp.rejects($$select public._assert_property_documents_ready('97220000-0000-4000-8000-000000000001')$$),'old approval cannot satisfy changed property facts');
select pg_temp.expect((select not public from storage.buckets where id='property-documents'),'document bucket is private');
select pg_temp.expect((select count(*) from public.audit_logs where target_id='97220000-0000-4000-8000-000000000001' and action='PROPERTY_DOCUMENT_REVIEWED')>=4,'decisions remain audited across corrections');
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000001","session_id":"97210000-0000-4000-8000-000000000001","role":"authenticated"}',true);
update public.user_sessions set is_active=false,trust_status='rejected' where user_id='pdr-owner';
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.get_property_document_review('97220000-0000-4000-8000-000000000001')$$),'revoked WeHouse device cannot read private property evidence with a still-live Auth session');
reset role;
update public.user_sessions set is_active=true,trust_status='pending' where user_id='pdr-owner';
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.get_property_document_review('97220000-0000-4000-8000-000000000001')$$),'pending device must not read private property evidence');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.expect(pg_temp.rejects($$select public.get_property_document_review('97220000-0000-4000-8000-000000000001')$$),'anonymous document RPC denied');
select pg_temp.expect(pg_temp.rejects($$select public._assert_property_documents_ready('97220000-0000-4000-8000-000000000001')$$),'private publication helper is not a client API');
reset role;
rollback;
