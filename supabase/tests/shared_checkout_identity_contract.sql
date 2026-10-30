-- Exercise the actual payment constructor, including its member:phase:attempt key.
begin;
set local session_replication_role=replica;
insert into auth.users(id,email) values('99710000-0000-4000-8000-000000000001','shared-checkout-a@example.invalid'),('99710000-0000-4000-8000-000000000002','shared-checkout-b@example.invalid');
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('99710000-0000-4000-8000-000000000001','shared-checkout-a@example.invalid','shared-checkout-a','user',true),
('99710000-0000-4000-8000-000000000002','shared-checkout-b@example.invalid','shared-checkout-b','user',true);
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('99710000-0000-4000-8000-000000000003','shared-checkout-owner@example.invalid','shared-checkout-owner','property_partner',true);
insert into auth.sessions(id,user_id,created_at,updated_at) select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('shared-checkout-a','shared-checkout-b');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,auth_id,'shared-checkout-'||user_id,'Synthetic trusted browser',true,'trusted' from public.profiles where user_id in('shared-checkout-a','shared-checkout-b');
insert into public.listings(id,listing_id,title,price,property_type,sub_type,status,availability_status,max_guests)
values('99710000-1000-4000-8000-000000000001','shared-checkout-home','Synthetic shared home',101,'apartment','short_let','available','available',3);
update public.listings set owner_id='shared-checkout-owner',partner_id='shared-checkout-owner' where id='99710000-1000-4000-8000-000000000001';
-- The identity contract isolates command checks using seeded records. Include
-- the accepted reservation and allocation now required by the real checkout.
insert into public.creator_policy_versions(policy_key,version,value,status,effective_from,legal_review_state,reason,checksum)
select 'commission_short_let_wehouse_managed',99710,'{"percent":10}','active',now()-interval '1 minute','reviewed','Rollback identity fixture','shared-checkout-fee'
where not exists(select 1 from public.creator_policy_versions where policy_key='commission_short_let_wehouse_managed' and scope_type='global' and scope_key='*' and status='active');
insert into public.reservations(id,listing_id,user_id,stay_type,status,manual_payment_status,reservation_fee_status,rent_payment_status,
 stay_check_in,stay_check_out,stay_nights,stay_rent_total,short_stay_partner_rent_snapshot,security_deposit_snapshot,
 management_mode_snapshot,commission_policy_version_id,shared_payment_group_id)
values('99710000-4000-4000-8000-000000000001','99710000-1000-4000-8000-000000000001','shared-checkout-a','short_let','reserved','paid','paid','not_started',
 current_date+10,current_date+11,1,101,101,0,'wehouse',
 (select policy_version_id from public.creator_policy_versions where policy_key='commission_short_let_wehouse_managed' and scope_type='global' and scope_key='*' and status='active' order by effective_from desc limit 1),
 '99710000-2000-4000-8000-000000000001');
insert into public.shared_payment_groups(shared_payment_group_id,product_type,listing_id,reservation_id,created_by,total_amount,capacity,status,checkout_expires_at,legacy_group_id,payment_phase,guest_count)
values('99710000-2000-4000-8000-000000000001','short_let','99710000-1000-4000-8000-000000000001','99710000-4000-4000-8000-000000000001','shared-checkout-a',101,3,'checkout_open',now()+interval '20 minutes','99710000-2000-4000-8000-000000000002','short_stay',3);
insert into public.shared_housing_groups(id,listing_id,reservation_id,created_by,status,member_limit,total_amount,expires_at,payment_phase,product_type,canonical_group_id,guest_count)
values('99710000-2000-4000-8000-000000000002','99710000-1000-4000-8000-000000000001','99710000-4000-4000-8000-000000000001','shared-checkout-a','payment_pending',3,101,now()+interval '20 minutes','short_stay','short_let','99710000-2000-4000-8000-000000000001',3);
insert into public.shared_housing_members(id,group_id,user_id,invitation_status,share_amount,eligible_partner_share,canonical_member_id) values
('99710000-3000-4000-8000-000000000001','99710000-2000-4000-8000-000000000002','shared-checkout-a','accepted',51,51,'99710000-3000-4000-8000-000000000003'),
('99710000-3000-4000-8000-000000000002','99710000-2000-4000-8000-000000000002','shared-checkout-b','accepted',50,50,'99710000-3000-4000-8000-000000000004');
insert into public.shared_payment_members(shared_payment_member_id,shared_payment_group_id,user_id,share_amount,eligible_partner_share,invitation_state,legacy_member_id) values
('99710000-3000-4000-8000-000000000003','99710000-2000-4000-8000-000000000001','shared-checkout-a',51,51,'accepted','99710000-3000-4000-8000-000000000001'),
('99710000-3000-4000-8000-000000000004','99710000-2000-4000-8000-000000000001','shared-checkout-b',50,50,'accepted','99710000-3000-4000-8000-000000000002');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"99710000-0000-4000-8000-000000000001","session_id":"99710000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.create_my_shared_housing_payment('99710000-2000-4000-8000-000000000002');perform set_config('test.shared_reference',r->>'reference',true);
 if public.create_my_shared_housing_payment('99710000-2000-4000-8000-000000000002')->>'reference'<>r->>'reference' then raise exception 'Retry manufactured another shared charge';end if;
 begin perform public.validate_shared_housing_checkout(gen_random_uuid(),'shared-checkout-a');raise exception 'FAIL: browser called service validator';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('test.shared_payment_id',(select id::text from public.booking_payments where paystack_reference=current_setting('test.shared_reference')),true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$begin
 if public.validate_shared_housing_checkout(current_setting('test.shared_payment_id')::uuid,'shared-checkout-a')->>'valid'<>'true' then raise exception 'Valid real compound-key checkout rejected';end if;
 if public.validate_shared_housing_checkout(current_setting('test.shared_payment_id')::uuid,'shared-checkout-b')->>'valid'<>'false' then raise exception 'Another payer checkout accepted';end if;
end $$;
reset role;
-- Mutations below affect rollback-only fixture records, never provider money.
do $$declare original jsonb;patch jsonb;begin
 select metadata into original from public.booking_payments where id=current_setting('test.shared_payment_id')::uuid;
 if original->>'shared_member_id'<>'99710000-3000-4000-8000-000000000001:short_stay:1' then raise exception 'Actual constructor no longer supplies compound member key';end if;
 foreach patch in array array[
  '{"shared_member_id":"99710000-3000-4000-8000-000000000001"}'::jsonb,
  '{"legacy_shared_member_id":"invalid-uuid"}'::jsonb,
  '{"legacy_shared_member_id":"99710000-3000-4000-8000-000000000002"}'::jsonb,
  '{"canonical_shared_payment_member_id":"99710000-3000-4000-8000-000000000004"}'::jsonb,
  '{"canonical_product_type":"long_let"}'::jsonb,
  '{"checkout_attempt":2}'::jsonb,'{"payment_phase":"contract_rent"}'::jsonb
 ] loop
  begin
   update public.booking_payments set metadata=original||patch where id=current_setting('test.shared_payment_id')::uuid;
   if public.validate_shared_housing_checkout(current_setting('test.shared_payment_id')::uuid,'shared-checkout-a')->>'valid'<>'false' then raise exception 'Forged or stale shared identity accepted: %',patch;end if;
  exception when raise_exception then
   if sqlerrm<>'Shared stay payment identity and allocation are immutable' then raise;end if;
  end;
 end loop;
 update public.booking_payments set metadata=original where id=current_setting('test.shared_payment_id')::uuid;
 update public.shared_housing_members set invitation_status='declined' where id='99710000-3000-4000-8000-000000000002';
 if public.validate_shared_housing_checkout(current_setting('test.shared_payment_id')::uuid,'shared-checkout-a')->>'valid'<>'false' then raise exception 'Missing payer consent accepted';end if;
 update public.shared_housing_members set invitation_status='accepted' where id='99710000-3000-4000-8000-000000000002';
 update public.shared_housing_groups set expires_at=now()-interval '1 second' where id='99710000-2000-4000-8000-000000000002';
 if public.validate_shared_housing_checkout(current_setting('test.shared_payment_id')::uuid,'shared-checkout-a')->>'valid'<>'false' then raise exception 'Expired shared hold accepted';end if;
end $$;
rollback;
select 'Real shared checkout identity, two payers below three-guest capacity, consent, wrong payer, phase/attempt/UUID tampering and expiry pass; fixtures rolled back' result;
