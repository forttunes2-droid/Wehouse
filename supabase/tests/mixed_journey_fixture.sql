\set ON_ERROR_STOP on
-- Disposable local Supabase only; loaded after load_baseline_fixture.sql.
begin;
set local session_replication_role = replica;
-- These are synthetic reviewed properties, not an exemption from the real
-- booking document gate. Keep production triggers enabled during HTTP load.
insert into public.profiles(auth_id,email,user_id,role,profile_complete)
values ('a8500000-0000-4000-8000-000000000001','load-owner@example.invalid','load-fixture-owner','user',true),
 ('a8500000-0000-4000-8000-000000000002','load-reviewer@example.invalid','load-fixture-reviewer','user',true)
on conflict(user_id) do nothing;
insert into public.inspection_requests(id,request_code,owner_id,owner_email,
 property_address,property_city,property_state,property_type,status,
 document_requirements,document_requirements_revision,document_requirements_set_by,
 document_requirements_set_at,document_requirements_note)
select md5('mixed-hotel-'||hotel_id)::uuid,'MIXED-HOTEL-'||abs(hotel_id),
 'load-fixture-owner','load-owner@example.invalid',address,city,state,'hotel','completed',
 public._default_property_document_requirements('hotel',null),1,
 'load-fixture-reviewer',now(),'Synthetic local CI accepted evidence requirements'
from public.hotels where hotel_id between -1000050 and -1000001;
update public.hotels set inspection_request_id=md5('mixed-hotel-'||hotel_id)::uuid
 where hotel_id between -1000050 and -1000001;
insert into public.property_submission_documents(request_id,requirement_code,
 requirements_revision,version,request_key,submitted_by,original_name,mime_type,
 byte_size,object_path,status,submitted_at,reviewed_at,reviewed_by,review_note)
select r.id,rule->>'code',1,1,gen_random_uuid(),'load-fixture-owner',
 'synthetic-evidence.pdf','application/pdf',12,
 'synthetic-mixed/'||r.id||'/'||(rule->>'code')||'.pdf',
 'approved',now(),now(),'load-fixture-reviewer','Synthetic reviewed evidence for local CI only'
from public.inspection_requests r cross join lateral jsonb_array_elements(r.document_requirements) rule
where r.request_code like 'MIXED-HOTEL-%';
-- Booking writes require the same active arrival policy snapshot as production.
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('accommodation_arrival_issue_window',99001,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}',
  'active',now()-interval '1 minute','reviewed','Disposable mixed-journey fixture','mixed-journey-fixture');
insert into public.hotel_rate_plans (
  rate_plan_id, hotel_id, room_id, name, meal_plan, payment_timing,
  refundable, cancellation_template, price_per_night, active
)
select -3000000 - h * 10 - r, -1000000 - h, -2000000 - h * 10 - r,
  'Synthetic room only', 'room_only', 'pay_now', false, 'standard', 20000, true
from generate_series(1, 50) h cross join generate_series(1, 2) r;
insert into public.hotel_room_units (hotel_id, room_id, unit_label, status)
select -1000000 - h, -2000000 - h * 10 - r,
  'Synthetic ' || h || '-' || r || '-' || unit, 'ready'
from generate_series(1, 50) h cross join generate_series(1, 2) r
cross join generate_series(1, 10) unit;
set local session_replication_role = origin;
do $$ declare r record;begin
 for r in select inspection_request_id from public.hotels
  where hotel_id between -1000050 and -1000001 loop
  perform public._assert_property_documents_ready(r.inspection_request_id);
 end loop;
end $$;
commit;
