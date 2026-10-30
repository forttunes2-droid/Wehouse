begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('94000000-0000-4000-8000-000000000001','short-split-a@example.invalid','short-split-a','user',true,'consumer','Ada','Nasarawa','Lafia','Lafia'),
('94000000-0000-4000-8000-000000000002','short-split-b@example.invalid','short-split-b','creator',true,'consumer','Bola','Nasarawa','Lafia','Lafia'),
('94000000-0000-4000-8000-000000000003','short-split-c@example.invalid','short-split-c','user',true,'consumer','Chika','Nasarawa','Lafia','Lafia'),
('94000000-0000-4000-8000-000000000004','short-split-d@example.invalid','short-split-d','user',true,'consumer','Different guest','Nasarawa','Lafia','Lafia');
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('94000000-0000-4000-8000-000000000005','short-split-owner@example.invalid','short-split-owner','property_partner',true),
('94000000-0000-4000-8000-000000000006','short-split-reviewer@example.invalid','short-split-reviewer','creator',true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type)
values('short-split-owner','property_partner','global'),('short-split-reviewer','creator','global');
insert into auth.sessions(id,user_id,created_at,updated_at)
select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles
where user_id in('short-split-a','short-split-b','short-split-c','short-split-d','short-split-owner');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,auth_id,'short-split-contract-'||user_id,'Synthetic contract browser',true,'trusted'
from public.profiles where user_id in('short-split-a','short-split-b','short-split-c','short-split-d','short-split-owner');
-- Short Let splits use friends. A Roommate conversation alone must not qualify (short-split-d).
insert into public.friends(user_low,user_high,requested_by,status) values
('short-split-a','short-split-b','short-split-a','accepted'),
('short-split-a','short-split-c','short-split-a','accepted');
insert into public.conversations(id,participant_a,participant_b,conversation_type,status) values
('94000000-0000-4000-8000-000000000014','short-split-a','short-split-d','roommate','active');
insert into public.listings(id,listing_id,title,price,property_type,sub_type,status,availability_status,max_guests,max_occupants,security_deposit_amount,state,city,address)
values('94000000-0000-4000-8000-000000000020','short-split-listing','Short Let contract',1000,'apartment','short_let','available','available',3,3,500,'Nasarawa','Lafia','Published test address');
insert into public.inspection_requests(id,request_code,owner_id,owner_email,
 property_address,property_city,property_state,property_type,sub_type,status,
 document_requirements,document_requirements_revision,document_requirements_set_by,document_requirements_set_at)
values('94000000-0000-4000-8000-000000000021','SHORT-SPLIT-REVIEW','short-split-owner',
 'short-split-owner@example.invalid','Published test address','Lafia','Nasarawa','apartment','short_let',
 'completed',public._default_property_document_requirements('apartment','short_let'),1,'short-split-reviewer',now());
update public.listings set owner_id='short-split-owner',partner_id='short-split-owner',
 approved_at=now(),approved_by='short-split-reviewer',
 inspection_request_id='94000000-0000-4000-8000-000000000021'
where id='94000000-0000-4000-8000-000000000020';
insert into public.property_submission_documents(request_id,requirement_code,requirements_revision,
 version,request_key,submitted_by,original_name,mime_type,byte_size,object_path,status,
 submitted_at,reviewed_at,reviewed_by,review_note)
select '94000000-0000-4000-8000-000000000021',rule->>'code',1,1,gen_random_uuid(),
 'short-split-owner','synthetic-shared-stay.pdf','application/pdf',12,
 'short-split-fixture/'||(rule->>'code')||'.pdf','approved',now(),now(),
 'short-split-reviewer','Synthetic reviewed Short Let evidence'
from jsonb_array_elements(public._default_property_document_requirements('apartment','short_let')) rule;
-- A real reservation requires an active policy snapshot, including in an empty test database.
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('accommodation_arrival_issue_window',99001,'{"default_hours":2,"minimum_hours":1,"maximum_hours":6}',
'active',now()-interval '1 minute','reviewed','Rollback-only booking fixture','short-split-contract');
-- Reservation snapshots require both Creator-approved cancellation and rate-term policies.
-- Reuse the migration-seeded active scope where present; do not violate the one-active-policy-per-scope invariant.
update public.creator_policy_versions set
 value='{"standard_full_refund_hours_before_check_in":24,"late_cancellation_requires_review":true,"provider_failure_full_refund":true,"payment_protection_required":true}',
 effective_from=now()-interval '1 minute',effective_until=null,legal_review_state='reviewed'
where policy_key='short_let_cancellation' and scope_type='global' and scope_key='*' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
select 'short_let_cancellation',99002,'{"standard_full_refund_hours_before_check_in":24,"late_cancellation_requires_review":true,"provider_failure_full_refund":true,"payment_protection_required":true}',
 'active',now()-interval '1 minute','reviewed','Rollback-only Short Let cancellation fixture','short-split-cancellation'
where not exists(select 1 from public.creator_policy_versions where policy_key='short_let_cancellation' and scope_type='global' and scope_key='*' and status='active');
update public.creator_policy_versions set
 value='{"minimum_discount_percent":5,"maximum_discount_percent":20,"guest_cancellation_refund_percent":0,"no_show_provider_eligible_after_review":true,"security_deposit_full_refund_without_occupancy":true,"provider_failure_overrides_non_refundable":true,"payment_or_listing_mismatch_reviewable":true,"payment_protection_required":true}',
 effective_from=now()-interval '1 minute',effective_until=null,legal_review_state='reviewed'
where policy_key='accommodation_non_refundable_rate' and scope_type='global' and scope_key='*' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
select 'accommodation_non_refundable_rate',99003,'{"minimum_discount_percent":5,"maximum_discount_percent":20,"guest_cancellation_refund_percent":0,"no_show_provider_eligible_after_review":true,"security_deposit_full_refund_without_occupancy":true,"provider_failure_overrides_non_refundable":true,"payment_or_listing_mismatch_reviewable":true,"payment_protection_required":true}',
 'active',now()-interval '1 minute','reviewed','Rollback-only Short Let rate terms fixture','short-split-rate-terms'
where not exists(select 1 from public.creator_policy_versions where policy_key='accommodation_non_refundable_rate' and scope_type='global' and scope_key='*' and status='active');
-- Reservation creation also snapshots the Creator-approved commission for this listing's management mode.
update public.creator_policy_versions set value='{"percent":10}',effective_from=now()-interval '1 minute',effective_until=null,legal_review_state='reviewed'
where policy_key='commission_short_let_wehouse_managed' and scope_type='global' and scope_key='*' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
select 'commission_short_let_wehouse_managed',99004,'{"percent":10}',
 'active',now()-interval '1 minute','reviewed','Rollback-only Short Let commission fixture','short-split-commission'
where not exists(select 1 from public.creator_policy_versions where policy_key='commission_short_let_wehouse_managed' and scope_type='global' and scope_key='*' and status='active');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000005","session_id":"94000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select public.accept_my_property_fees(public.get_provider_fee_disclosure('short_let','wehouse')->>'digest',null,'94000000-0000-4000-8000-000000000020');
reset role;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","session_id":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

create temp table verified_short_shared_references(reference text,amount numeric,payer text);
grant all on verified_short_shared_references to authenticated;
select set_config('test.verified_short_reservation',(select id from public.create_short_stay_reservation('94000000-0000-4000-8000-000000000020',current_date+10,current_date+11,3)),true);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare p public.booking_payments;receipt jsonb;begin
 select * into p from public.booking_payments where paystack_reference=(select payment_reference from public.reservations where id=current_setting('test.verified_short_reservation'));
 receipt:=public.process_verified_paystack_charge('charge.success:9400010','charge.success',p.paystack_reference,repeat('f',64),now(),(p.amount_total*100)::bigint,'NGN','9400010');
 if receipt->>'success' is distinct from 'true' then raise exception 'FAIL: Short Let reservation fee: %, %',receipt,(select processing_error from public.verified_provider_events where provider_reference=p.paystack_reference);end if;
end $$;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","session_id":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.verified_short_group',public.create_my_shared_short_let(current_setting('test.verified_short_reservation'),array['short-split-c'])->>'id',true);
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000003","session_id":"94000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.respond_to_shared_housing_invite(current_setting('test.verified_short_group')::uuid,true);
do $$declare p jsonb;begin
 p:=public.create_my_shared_housing_payment(current_setting('test.verified_short_group')::uuid);
 insert into verified_short_shared_references values(p->>'reference',(p->>'amount')::numeric,'short-split-c');
end $$;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","session_id":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare p jsonb;begin
 p:=public.create_my_shared_housing_payment(current_setting('test.verified_short_group')::uuid);
 insert into verified_short_shared_references values(p->>'reference',(p->>'amount')::numeric,'short-split-a');
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare p record;receipt jsonb;i integer:=0;begin
 for p in select * from verified_short_shared_references order by payer loop
  i:=i+1;
  receipt:=public.process_verified_paystack_charge('charge.success:'||(9400020+i),'charge.success',p.reference,repeat('a',64),now(),(p.amount*100)::bigint,'NGN',(9400020+i)::text);
  if receipt->>'success' is distinct from 'true' then raise exception 'FAIL: verified shared Short Let %, %',receipt,(select processing_error from public.verified_provider_events where provider_reference=p.reference);end if;
  if i=1 and exists(select 1 from public.reservations where id=current_setting('test.verified_short_reservation') and rent_payment_status='paid') then raise exception 'FAIL: one payer confirmed the whole stay';end if;
  if (select count(*) from public.payment_protection_transactions where paystack_reference=p.reference)<>2
   or (select sum(amount_total) from public.payment_protection_transactions where paystack_reference=p.reference) is distinct from p.amount then raise exception 'FAIL: actual shared Short Let protection components do not conserve verified payment';end if;
 end loop;
 if not exists(select 1 from public.reservations where id=current_setting('test.verified_short_reservation') and status='ready_for_move_in' and canonical_state='stay_paid' and rent_payment_status='paid') then raise exception 'FAIL: all shared stay receipts did not confirm one booking';end if;
end $$;

-- A subsequent Creator rate and funded offer apply to the next booking only.
-- These are rollback fixture configurations, not launch commission activation.
set local session_replication_role=replica;
update public.creator_policy_versions set status='retired' where policy_key='commission_short_let_wehouse_managed' and scope_type='global' and scope_key='*' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('commission_short_let_wehouse_managed',99005,'{"percent":20}','active',now()-interval '1 minute','reviewed','Rollback fixture next booking rate','short-split-next-rate');
insert into public.listing_discounts(listing_id,funded_by,percent,starts_on,ends_on,created_by) values
('94000000-0000-4000-8000-000000000020','host',10,current_date,current_date+90,'short-split-owner'),
('94000000-0000-4000-8000-000000000020','wehouse',5,current_date,current_date+90,'short-split-reviewer');
set local session_replication_role=origin;
select pg_temp.expect((select sum(amount_commission)=100 and sum(amount_payee)=900 from public.payment_protection_transactions where subject_type='short_let_stay' and paystack_reference in(select reference from verified_short_shared_references)),'old two-payer fee/net remains its saved 10 percent after the Creator rate changes');
select pg_temp.expect(pg_temp.rejects($sql$update public.booking_payments set amount_commission=amount_commission+1 where paystack_reference=(select reference from verified_short_shared_references limit 1)$sql$),'accepted share amounts cannot be rewritten');
truncate verified_short_shared_references;
-- New bookings require the Partner to accept the newly disclosed fee.
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000005","session_id":"94000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select public.accept_my_property_fees(public.get_provider_fee_disclosure('short_let','wehouse')->>'digest',null,'94000000-0000-4000-8000-000000000020');
reset role;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","session_id":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.verified_short_reservation',(select id from public.create_short_stay_reservation('94000000-0000-4000-8000-000000000020',current_date+30,current_date+31,3)),true);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare p public.booking_payments;receipt jsonb;begin
 select * into p from public.booking_payments where paystack_reference=(select payment_reference from public.reservations where id=current_setting('test.verified_short_reservation'));
 receipt:=public.process_verified_paystack_charge('charge.success:9400030','charge.success',p.paystack_reference,repeat('b',64),now(),(p.amount_total*100)::bigint,'NGN','9400030');
 if receipt->>'success' is distinct from 'true' then raise exception 'FAIL: next reservation fee did not verify';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","session_id":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.verified_short_group',public.create_my_shared_short_let(current_setting('test.verified_short_reservation'),array['short-split-b','short-split-c'])->>'id',true);
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000002","session_id":"94000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select public.respond_to_shared_housing_invite(current_setting('test.verified_short_group')::uuid,true);
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000003","session_id":"94000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.respond_to_shared_housing_invite(current_setting('test.verified_short_group')::uuid,true);
do $$declare p jsonb;begin
 p:=public.create_my_shared_housing_payment(current_setting('test.verified_short_group')::uuid);
 insert into verified_short_shared_references values(p->>'reference',(p->>'amount')::numeric,'short-split-c');
end $$;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000002","session_id":"94000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$declare p jsonb;begin
 p:=public.create_my_shared_housing_payment(current_setting('test.verified_short_group')::uuid);
 insert into verified_short_shared_references values(p->>'reference',(p->>'amount')::numeric,'short-split-b');
end $$;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","session_id":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare p jsonb;begin
 p:=public.create_my_shared_housing_payment(current_setting('test.verified_short_group')::uuid);
 insert into verified_short_shared_references values(p->>'reference',(p->>'amount')::numeric,'short-split-a');
end $$;
reset role;
-- Retire the unrelated current base policy and change the next managed rate.
-- Already-accepted payments must still use their saved 20 percent version.
set local session_replication_role=replica;
update public.creator_policy_versions set status='retired' where policy_key in('commission_short_let','commission_short_let_wehouse_managed') and scope_type='global' and scope_key='*' and status='active';
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
values('commission_short_let_wehouse_managed',99006,'{"percent":25}','active',now()-interval '1 minute','reviewed','Rollback fixture later rate','short-split-later-rate');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$declare p record;receipt jsonb;i integer:=0;begin
 for p in select * from verified_short_shared_references order by payer loop
  i:=i+1;
  receipt:=public.process_verified_paystack_charge('charge.success:'||(9400040+i),'charge.success',p.reference,repeat('c',64),now(),(p.amount*100)::bigint,'NGN',(9400040+i)::text);
  if receipt->>'success' is distinct from 'true' then raise exception 'FAIL: three-payer discounted stay %, %',receipt,(select processing_error from public.verified_provider_events where provider_reference=p.reference);end if;
  if i<3 and exists(select 1 from public.reservations where id=current_setting('test.verified_short_reservation') and rent_payment_status='paid') then raise exception 'FAIL: partially funded three-payer stay confirmed';end if;
  receipt:=public.process_verified_paystack_charge('charge.success:'||(9400040+i),'charge.success',p.reference,repeat('c',64),now(),(p.amount*100)::bigint,'NGN',(9400040+i)::text);
  if receipt->>'success' is distinct from 'true' then raise exception 'FAIL: receipt retry is not idempotent';end if;
 end loop;
end $$;
select pg_temp.expect((select count(*)=3 and sum(amount_total)=850 and sum(amount_commission)=130 and sum(amount_payee)=720 and bool_and(commission_rate=20) from public.payment_protection_transactions where subject_type='short_let_stay' and paystack_reference in(select reference from verified_short_shared_references)),'three minor-unit shares conserve the saved stay price, rate and Partner payout; WeHouse funds its own offer');
select pg_temp.expect((select count(*)=3 and sum(amount_total)=500 and sum(amount_commission)=0 from public.payment_protection_transactions where subject_type='short_let_caution' and paystack_reference in(select reference from verified_short_shared_references)),'each payer has their own caution record with no commission');
select pg_temp.expect((select count(*)=6 and sum(amount_total)=1350 and bool_and(protection_state='protected' and protected_ledger_transaction_id is not null) from public.payment_protection_transactions where paystack_reference in(select reference from verified_short_shared_references)),'no duplicate parent protection; all verified money reaches recorded protection');
select pg_temp.expect((select status='ready_for_move_in' and rent_payment_status='paid' from public.reservations where id=current_setting('test.verified_short_reservation')),'all three verified shares confirm one stay');
select pg_temp.expect(not has_function_privilege('authenticated','private.shared_short_let_allocation(uuid)','execute') and not has_function_privilege('anon','private.capture_shared_short_let_checkout(uuid)','execute'),'private financial helpers cannot be called directly');
select 'Actual two/three-payer verified Short Let charges, saved rates, discounts, components and idempotency passed; fixtures rolled back' as result;
rollback;
