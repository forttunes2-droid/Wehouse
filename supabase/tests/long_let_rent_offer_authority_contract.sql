begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
 ('b7990000-0000-4000-8000-000000000001','rent-owner@example.invalid','rent-owner','user',true),
 ('b7990000-0000-4000-8000-000000000002','rent-operations@example.invalid','rent-operations','user',true),
 ('b7990000-0000-4000-8000-000000000003','rent-outsider@example.invalid','rent-outsider','user',true);
insert into auth.sessions(id,user_id,created_at,updated_at)
 select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('rent-owner','rent-operations','rent-outsider');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
 select user_id,auth_id,auth_id,'rent-offer-'||user_id,'Synthetic contract browser',true,'trusted'
 from public.profiles where user_id in('rent-owner','rent-operations','rent-outsider');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
 ('rent-owner','property_partner','global','active'),('rent-outsider','property_partner','global','active');
insert into public.listings(id,listing_id,title,sub_type,state,city,status,availability_status,owner_id,partner_id,approved_at,management_mode,management_updated_at,management_host_user_id,price,currency) values
 ('b7990000-2000-4000-8000-000000000001','rent-host-home','Host rent home','long_stay','Lagos','Ikeja','available','available','rent-owner','rent-owner',now(),'host',now(),'rent-owner',1200000,'NGN'),
 ('b7990000-2000-4000-8000-000000000002','rent-managed-home','Managed rent home','long_stay','Lagos','Ikeja','available','available','rent-owner','rent-owner',now(),'wehouse',now(),null,1200000,'NGN');
insert into public.property_host_assignments(listing_id,user_id,assignment_role,status,invited_by,accepted_at,access_level) values
 ('b7990000-2000-4000-8000-000000000001','rent-owner','owner','active','rent-owner',now(),'full_hosting'),
 ('b7990000-2000-4000-8000-000000000002','rent-owner','owner','active','rent-owner',now(),'full_hosting'),
 ('b7990000-2000-4000-8000-000000000001','rent-operations','manager','active','rent-owner',now(),'operations');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','b7990000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000001","session_id":"b7990000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
declare receipt jsonb;retry jsonb;denied boolean:=false;
begin
 receipt:=public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001',1,array[12,3,6],true);
 if receipt->>'revision'<>'2' or receipt->'accepted_terms_months'<>'[3,6,12]'::jsonb or receipt->>'monthly_accepted'<>'true' then raise exception 'FAIL: owner offer was not saved';end if;
 retry:=public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001',1,array[3,6,12],true);
 if retry is distinct from receipt then raise exception 'FAIL: retry changed saved terms';end if;
 begin perform public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001',1,array[12],false);
 exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'FAIL: stale change overwrote accepted offer';end if;
 receipt:=public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000002',1,array[12,24],false);
 if receipt->'accepted_terms_months'<>'[12,24]'::jsonb then raise exception 'FAIL: WeHouse-managed owner could not set accepted terms';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','b7990000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000003","session_id":"b7990000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$
declare denied boolean:=false;
begin
 begin perform public.set_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001',2,array[12],false);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL: outsider changed another Partner offer';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','b7990000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b7990000-0000-4000-8000-000000000002","session_id":"b7990000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$
declare denied boolean:=false;
begin
 begin perform public.get_my_long_let_rent_terms('b7990000-2000-4000-8000-000000000001');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL: Operations co-host gained commercial control';end if;
end $$;
reset role;
select 'Long Let owner/manager/outsider authority and retry checks passed' as result;
rollback;
