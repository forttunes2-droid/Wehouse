\set ON_ERROR_STOP on
begin;

-- Browser roles may consume Activity, never manufacture or destroy it.
do $$
begin
  if not has_table_privilege('authenticated','public.activity_events','select')
     or has_table_privilege('authenticated','public.activity_events','insert')
     or has_table_privilege('authenticated','public.activity_event_audiences','update')
     or has_table_privilege('authenticated','public.notifications','insert')
     or has_table_privilege('authenticated','public.notifications','delete')
     or has_table_privilege('authenticated','public.notifications','truncate')
     or has_table_privilege('anon','public.notifications','select')
     or not has_column_privilege('authenticated','public.notifications','read','update')
     or not has_column_privilege('authenticated','public.notifications','read_at','update') then
    raise exception 'Activity table privilege boundary is unsafe';
  end if;
end
$$;

set local session_replication_role=replica;

insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,account_kind,state,city,local_government,
  worker_status,worker_verified
) values
('89999999-0000-4000-8000-000000000001','activity-owner@example.invalid','activity-owner','user',true,'consumer','Nasarawa','Lafia','Lafia',null,false),
('89999999-0000-4000-8000-000000000002','activity-guest@example.invalid','activity-guest','user',true,'consumer','Nasarawa','Lafia','Lafia',null,false),
('89999999-0000-4000-8000-000000000003','activity-property-state@example.invalid','activity-property-state','user',true,'consumer','Nasarawa','Lafia','Lafia',null,false),
('89999999-0000-4000-8000-000000000004','activity-property-keffi@example.invalid','activity-property-keffi','user',true,'consumer','Nasarawa','Keffi','Keffi',null,false),
('89999999-0000-4000-8000-000000000005','activity-finance-state@example.invalid','activity-finance-state','user',true,'consumer','Nasarawa','Lafia','Lafia',null,false),
('89999999-0000-4000-8000-000000000006','activity-security-state@example.invalid','activity-security-state','user',true,'consumer','Nasarawa','Lafia','Lafia',null,false),
('89999999-0000-4000-8000-000000000007','activity-admin-state@example.invalid','activity-admin-state','user',true,'consumer','Nasarawa','Lafia','Lafia',null,false),
('89999999-0000-4000-8000-000000000008','activity-hotel-team@example.invalid','activity-hotel-team','user',true,'consumer','Nasarawa','Lafia','Lafia',null,false),
('89999999-0000-4000-8000-000000000009','activity-worker@example.invalid','activity-worker','user',true,'consumer','Nasarawa','Lafia','Lafia','pending',false),
('89999999-0000-4000-8000-000000000010','activity-worker-ops@example.invalid','activity-worker-ops','user',true,'consumer','Nasarawa','Lafia','Lafia',null,false);

insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,scope_state,scope_lga,status
) values
('activity-property-state','staff','state','Nasarawa',null,'active'),
('activity-property-state','property_operations','state','Nasarawa',null,'active'),
('activity-property-keffi','staff','branch','Nasarawa','Keffi','active'),
('activity-property-keffi','property_operations','branch','Nasarawa','Keffi','active'),
('activity-finance-state','staff','state','Nasarawa',null,'active'),
('activity-finance-state','finance_operations','state','Nasarawa',null,'active'),
('activity-security-state','staff','state','Nasarawa',null,'active'),
('activity-security-state','security_operations','state','Nasarawa',null,'active'),
('activity-admin-state','admin','state','Nasarawa',null,'active'),
('activity-worker','worker','global',null,null,'active'),
('activity-worker-ops','staff','state','Nasarawa',null,'active'),
('activity-worker-ops','worker_operations','state','Nasarawa',null,'active');

insert into public.case_reason_registry(
  reason_code,label,owning_domain,allowed_subject_types,requires_evidence,
  customer_description,active,version
) values(
  'activity_security_contract','Security Activity contract','security_operations',
  array['account'],false,'Contract fixture',true,1
);

insert into public.inspection_requests(
  request_code,owner_id,owner_email,property_address,property_city,property_state,lifecycle_stage
) values(
  'ACTIVITY-PROP-1','activity-owner','activity-owner@example.invalid',
  'Activity Contract House','Lafia','Nasarawa','access_required'
);

insert into public.wallets(id,owner_id,owner_type)
values(
  '89999999-1000-4000-8000-000000000001',
  'activity-owner','property_partner'
);

insert into public.hotels(name,state,city,owner_id,status)
values('Activity Contract Hotel','Nasarawa','Lafia','activity-owner','active');

insert into public.hotel_rooms(hotel_id,room_type,price_per_night)
select hotel_id,'Standard',20000
from public.hotels where name='Activity Contract Hotel';

insert into public.hotel_team_members(
  hotel_id,member_user_id,hotel_role,status,invited_by,capabilities
)
select hotel_id,'activity-hotel-team','manager','active','activity-owner',array['stay.read']
from public.hotels where name='Activity Contract Hotel';

insert into public.hotel_bookings(
  hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,payment_status
)
select h.hotel_id,r.room_id,'activity-guest',current_date+1,current_date+2,
       1,20000,'pending','unpaid'
from public.hotels h
join public.hotel_rooms r on r.hotel_id=h.hotel_id
where h.name='Activity Contract Hotel'
limit 1;

insert into public.worker_verifications(
  worker_id,status,verification_video_url
) values('activity-worker','pending','contract/worker.mp4');

set local session_replication_role=origin;

-- Property submission/review work routes by grant scope, not profiles.role.
update public.inspection_requests
set lifecycle_stage='access_review',updated_at=now()
where request_code='ACTIVITY-PROP-1';

-- Finance work produces an actionable Finance Operations event.
insert into public.withdrawals(id,wallet_id,amount,status)
values(
  '89999999-2000-4000-8000-000000000001',
  '89999999-1000-4000-8000-000000000001',
  25000,'awaiting_review'
);

-- Security escalations use the same Activity contract.
insert into public.operational_cases(
  reason_code,owning_domain,subject_type,subject_id,
  requester_user_id,state_scope,status,priority
) values(
  'activity_security_contract','security_operations','account','activity-guest',
  'activity-guest','Nasarawa','decision_ready','urgent'
);

-- Hotel paid stay reaches the active Hotel Team and guest.
update public.hotel_bookings
set status='confirmed',payment_status='paid',updated_at=now()
where user_id='activity-guest'
  and hotel_id=(
    select hotel_id from public.hotels where name='Activity Contract Hotel'
  );

-- Worker review submission is one domain using the same generic routing rule.
update public.worker_verifications
set status='profile_under_review',submitted_at=now(),updated_at=now()
where worker_id='activity-worker';

do $$
declare
  property_event uuid;
  finance_event uuid;
  security_event uuid;
  hotel_event uuid;
  worker_event uuid;
begin
  select activity_event_id into property_event
  from public.activity_events
  where event_type='property.access_review.action_required'
    and subject_id=(
      select id::text from public.inspection_requests
      where request_code='ACTIVITY-PROP-1'
    )
  limit 1;
  if property_event is null then raise exception 'Property Activity missing'; end if;
  if not exists(
    select 1 from public.activity_event_audiences
    where activity_event_id=property_event
      and recipient_user_id='activity-property-state'
      and workspace='property_operations'
      and action_required and resolved_at is null
  ) then raise exception 'State Property Operations did not receive Activity'; end if;
  if not exists(
    select 1 from public.activity_event_audiences
    where activity_event_id=property_event
      and recipient_user_id='activity-admin-state'
      and workspace='admin'
      and action_required
  ) then raise exception 'State Admin did not receive Property Activity'; end if;
  if exists(
    select 1 from public.activity_event_audiences
    where activity_event_id=property_event
      and recipient_user_id='activity-property-keffi'
  ) then raise exception 'Out-of-LGA Property Operations received Lafia Activity'; end if;

  select activity_event_id into finance_event
  from public.activity_events
  where event_type='finance.withdrawal_review_required'
    and subject_id='89999999-2000-4000-8000-000000000001'
  limit 1;
  if finance_event is null or not exists(
    select 1 from public.activity_event_audiences
    where activity_event_id=finance_event
      and recipient_user_id='activity-finance-state'
      and workspace='finance_operations'
      and action_required
  ) then raise exception 'Finance Operations Activity routing failed'; end if;

  select activity_event_id into security_event
  from public.activity_events
  where event_type='case.action_required'
    and subject_id=(
      select operational_case_id::text from public.operational_cases
      where reason_code='activity_security_contract'
      order by created_at desc limit 1
    )
  limit 1;
  if security_event is null or not exists(
    select 1 from public.activity_event_audiences
    where activity_event_id=security_event
      and recipient_user_id='activity-security-state'
      and workspace='security_operations'
      and action_required
  ) then raise exception 'Security Operations Activity routing failed'; end if;

  select activity_event_id into hotel_event
  from public.activity_events
  where event_type='hotel.stay_confirmed'
    and subject_id=(
      select booking_id::text from public.hotel_bookings
      where user_id='activity-guest' order by booking_id desc limit 1
    )
  limit 1;
  if hotel_event is null then raise exception 'Hotel Activity missing'; end if;
  if not exists(
    select 1 from public.activity_event_audiences
    where activity_event_id=hotel_event
      and recipient_user_id='activity-hotel-team'
      and workspace='hotel'
      and action_required
  ) then raise exception 'Hotel Team did not receive paid-stay Activity'; end if;
  if not exists(
    select 1 from public.activity_event_audiences
    where activity_event_id=hotel_event
      and recipient_user_id='activity-guest'
      and workspace='personal'
  ) then raise exception 'Guest did not receive hotel confirmation Activity'; end if;

  select activity_event_id into worker_event
  from public.activity_events
  where event_type='worker.review_submitted'
    and subject_id='activity-worker'
  limit 1;
  if worker_event is null or not exists(
    select 1 from public.activity_event_audiences
    where activity_event_id=worker_event
      and recipient_user_id='activity-worker-ops'
      and workspace='worker_operations'
      and action_required
  ) then raise exception 'Worker Operations review Activity routing failed'; end if;
end
$$;

-- Reading is separate from resolution. A review decision resolves the Team
-- action and creates the Worker-facing lifecycle result.
update public.worker_verifications
set status='verified',reviewed_by='activity-worker-ops',
    reviewed_at=now(),updated_at=now()
where worker_id='activity-worker';

do $$
begin
  if exists(
    select 1
    from public.activity_event_audiences a
    join public.activity_events e using(activity_event_id)
    where e.event_type='worker.review_submitted'
      and e.subject_id='activity-worker'
      and a.resolved_at is null
  ) then raise exception 'Review action stayed unresolved after decision'; end if;

  if not exists(
    select 1
    from public.activity_event_audiences a
    join public.activity_events e using(activity_event_id)
    where e.event_type='worker.review_approved'
      and e.subject_id='activity-worker'
      and a.recipient_user_id='activity-worker'
      and a.workspace='worker'
  ) then raise exception 'Worker did not receive review outcome Activity'; end if;
end
$$;

-- The public read model is identity-bound and workspace-aware.
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','89999999-0000-4000-8000-000000000003',true);
set local role authenticated;

do $$
begin
  if not exists(
    select 1 from public.get_my_canonical_activity_v2('staff',100)
    where type='property.access_review.action_required'
  ) then raise exception 'Canonical Activity feed omitted authorized Property event'; end if;

  if exists(
    select 1 from public.get_my_canonical_activity_v2('staff',100)
    where type='finance.withdrawal_review_required'
  ) then raise exception 'Canonical Activity feed leaked another Operation event'; end if;
end
$$;

rollback;
