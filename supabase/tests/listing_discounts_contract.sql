\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %', description; end if; end $$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('98000000-0000-4000-8000-000000000001','dc-a@example.invalid','dc-a','user',true,'consumer','A','Lagos','Ikeja','Ikeja'),
('98000000-0000-4000-8000-000000000002','dc-b@example.invalid','dc-b','user',true,'consumer','B','Lagos','Ikeja','Ikeja'),
('98000000-0000-4000-8000-000000000003','dc-c@example.invalid','dc-c','user',true,'consumer','C','Abuja','Garki','Garki'),
('98000000-0000-4000-8000-000000000004','dc-lagos-admin@example.invalid','dc-lagos-admin','user',true,'consumer','LA','Lagos','Ikeja','Ikeja'),
('98000000-0000-4000-8000-000000000005','dc-abuja-admin@example.invalid','dc-abuja-admin','user',true,'consumer','AA','Abuja','Garki','Garki'),
('98000000-0000-4000-8000-000000000006','dc-creator@example.invalid','dc-creator','user',true,'consumer','CR','Lagos','Ikeja','Ikeja');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state) values
('dc-lagos-admin','admin','state','Lagos'),('dc-abuja-admin','admin','state','Abuja'),('dc-creator','creator','global',null);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type)
values('dc-a','property_partner','global'),('dc-b','property_partner','global');
insert into auth.sessions(id,user_id,created_at,updated_at)
select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles
where user_id in('dc-a','dc-b','dc-c','dc-lagos-admin','dc-abuja-admin','dc-creator');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,auth_id,'discount-contract-'||user_id,'Synthetic contract browser',true,'trusted'
from public.profiles where user_id in('dc-a','dc-b','dc-c','dc-lagos-admin','dc-abuja-admin','dc-creator');
-- Isolate these rates without deleting referenced history or colliding with
-- real baseline policies. The complete fixture is rolled back below.
update public.creator_policy_versions set status='retired',
 effective_until=greatest(clock_timestamp(),effective_from+interval '1 microsecond')
where policy_key in('commission_short_let_wehouse_managed','commission_long_let_wehouse_managed','commission_hotel')
 and scope_type='global' and scope_key='*' and status='active';
insert into public.creator_policy_versions(policy_key,scope_type,scope_key,version,value,value_schema,status,effective_from,public_disclosure,disclosure_text,legal_review_state,reason,checksum,published_at)
values('commission_short_let_wehouse_managed','global','*',999997,'{"percent":12}'::jsonb,'{"type":"percent"}'::jsonb,'active',now()-interval '1 minute',true,'fixture','pending','discount cap fixture','discount-cap-fixture',now()),
('commission_long_let_wehouse_managed','global','*',999996,'{"percent":5}'::jsonb,'{"type":"percent"}'::jsonb,'active',now()-interval '1 minute',true,'fixture','pending','long let cap fixture','long-let-cap-fixture',now()),
('commission_hotel','global','*',999995,'{"percent":10}'::jsonb,'{"type":"percent"}'::jsonb,'active',now()-interval '1 minute',true,'fixture','pending','hotel cap fixture','hotel-cap-fixture',now());
insert into public.listings(id,listing_id,title,price,state,owner_id) values
('98000000-0000-4000-8000-0000000000e1','dc-home-1','Home 1',100000,'Lagos','dc-a'),
('98000000-0000-4000-8000-0000000000e2','dc-home-2','Home 2',100000,'Lagos','dc-b');
insert into public.listings(id,listing_id,title,price,state,owner_id,sub_type) values
('98000000-0000-4000-8000-0000000000e3','dc-long-3','Long Let 3',1000000,'Lagos','dc-b','long_stay');
insert into public.inspection_requests(id,request_code,owner_id,owner_email,
 property_address,property_city,property_state,property_type,sub_type,status)
select md5(l.id::text)::uuid,'DC-'||l.listing_id,l.owner_id,p.email,
 'Synthetic reviewed property','Ikeja',l.state,'apartment',l.sub_type,'completed'
from public.listings l join public.profiles p on p.user_id=l.owner_id
where l.listing_id in('dc-home-1','dc-home-2','dc-long-3');
update public.listings set management_mode='host',management_host_user_id=owner_id,
 approved_at=now(),inspection_request_id=md5(id::text)::uuid
where listing_id in('dc-home-1','dc-home-2','dc-long-3');
insert into public.property_host_assignments(listing_id,user_id,assignment_role,status,
 invited_by,accepted_at,access_level)
select id,owner_id,'owner','active',owner_id,now(),'full_hosting' from public.listings
where listing_id in('dc-home-1','dc-home-2','dc-long-3');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","session_id":"98000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(public.set_my_listing_discount('98000000-0000-4000-8000-0000000000e1',50) is not null,'host can discount their own home up to 50%');
select pg_temp.expect(pg_temp.rejects($$select public.set_my_listing_discount('98000000-0000-4000-8000-0000000000e1',4)$$),'below 5% is refused');
select pg_temp.expect(pg_temp.rejects($$select public.set_my_listing_discount('98000000-0000-4000-8000-0000000000e1',51)$$),'above 50% is refused');
select pg_temp.expect(pg_temp.rejects($$select public.set_my_listing_discount('98000000-0000-4000-8000-0000000000e2',10)$$),'host cannot discount someone else''s home');
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount('98000000-0000-4000-8000-0000000000e1',null,10)$$),'a host cannot spend WeHouse money');
select pg_temp.expect(pg_temp.rejects($$select count(*) from public.listing_discounts$$),'no direct table access');
select pg_temp.expect(public.set_my_listing_discount('98000000-0000-4000-8000-0000000000e1',20) is not null,'host can change their discount');
select pg_temp.expect(public.listing_discount_percent('98000000-0000-4000-8000-0000000000e1')=20,'only the newest host discount counts');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000006","session_id":"98000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount('98000000-0000-4000-8000-0000000000e1',null,16)$$),'WeHouse discount above 15% is refused');
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount('98000000-0000-4000-8000-0000000000e1',null,11)$$),'WeHouse cannot discount above the lowest 10% commission it can earn');
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount('98000000-0000-4000-8000-0000000000e1','Lagos',10)$$),'property and state together is refused');
select pg_temp.expect(public.creator_set_wehouse_discount(null,'Lagos',10) is not null,'Creator can fund a state-wide discount up to the lowest commission');
select pg_temp.expect(public.listing_discount_percent('98000000-0000-4000-8000-0000000000e1')=28,'host 20% plus WeHouse limited to 10% of the host price (8%)');
select pg_temp.expect(public.listing_discount_percent('98000000-0000-4000-8000-0000000000e2')=10,'state discount reaches other Lagos homes');
reset role;
select pg_temp.expect((select partner_percent from public.short_let_discount_breakdown('98000000-0000-4000-8000-0000000000e1',current_date,0))=20,'the partner side stays at the host discount');
select pg_temp.expect((select wehouse_percent from public.short_let_discount_breakdown('98000000-0000-4000-8000-0000000000e1',current_date,0))=8,'WeHouse share is its commission on the host price, not on the list price');
select pg_temp.expect((select wehouse_percent from public.short_let_discount_breakdown('98000000-0000-4000-8000-0000000000e1',current_date,30))=0,'WeHouse adds nothing once the partner side reaches the 50% cap');
select pg_temp.expect((select amount_payee from public.short_let_payout_split(72000,80000,10))=72000,'partner keeps rent after commission even when WeHouse funds a discount');
select pg_temp.expect((select amount_commission from public.short_let_payout_split(72000,80000,10))=0,'WeHouse funded its whole commission');
select pg_temp.expect((select amount_commission from public.short_let_payout_split(76000,80000,10))=4000,'WeHouse keeps its commission minus what it funded');
-- Long Let: the state discount is capped by the Long Let commission (5% fixture) and applies to Year 1 only.
select pg_temp.expect(public.wehouse_discount_ceiling_for('long_stay')<=5,'Long Let WeHouse discount follows the Long Let commission');
select pg_temp.expect((select wehouse_percent from public.short_let_discount_breakdown('98000000-0000-4000-8000-0000000000e3',current_date,0))<=5,'state discount is capped for a Long Let');
select pg_temp.expect((select wehouse_percent from public.short_let_discount_breakdown('98000000-0000-4000-8000-0000000000e2',current_date,0))=10,'Short Let cap is unchanged by the Long Let cap');
select pg_temp.expect((select partner_rent from public.long_let_year_one_quote('98000000-0000-4000-8000-0000000000e3',1000000))=1000000,'partner Year 1 rent is untouched by a WeHouse-funded discount');
select pg_temp.expect((select payable from public.long_let_year_one_quote('98000000-0000-4000-8000-0000000000e3',1000000))
  =round(1000000*(1-(select wehouse_percent from public.short_let_discount_breakdown('98000000-0000-4000-8000-0000000000e3',current_date,0))/100),2),'renter pays Year 1 rent minus the discount');
select pg_temp.expect((select amount_payee from public.short_let_payout_split(
  (select payable from public.long_let_year_one_quote('98000000-0000-4000-8000-0000000000e3',1000000)),1000000,10))=900000,'Long Let partner keeps Year 1 rent minus commission');
set local role authenticated;
select pg_temp.expect((select count(*) from public.creator_list_wehouse_discounts())=1,'Creator lists the active WeHouse discount');
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount(null,'Lagos',10,current_date-1)$$),'past Home offer end date is refused');
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount(null,'Lagos',10,'infinity'::date)$$),'non-finite Home offer end date is refused');
select set_config('test.home_discount',public.creator_set_wehouse_discount(null,'Lagos',10,current_date+2)::text,true);
select pg_temp.expect(public.creator_set_wehouse_discount(null,'Lagos',10,current_date+2)::text=current_setting('test.home_discount'),'retry of same dated Home campaign returns the original receipt');
select pg_temp.expect((select ends_on=current_date+2 from public.creator_list_wehouse_discounts() where id::text=current_setting('test.home_discount')),'Home campaign stores its duration');
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_hotel_discount(null,null,null,5,current_date-1)$$),'past Hotel offer end date is refused');
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_hotel_discount(null,null,null,5,'infinity'::date)$$),'non-finite Hotel offer end date is refused');
select set_config('test.hotel_discount',public.creator_set_wehouse_hotel_discount(null,null,null,5,current_date+2)::text,true);
select pg_temp.expect(public.creator_set_wehouse_hotel_discount(null,null,null,5,current_date+2)::text=current_setting('test.hotel_discount'),'retry of same dated Hotel campaign returns the original receipt');
select pg_temp.expect((select ends_on=current_date+2 from public.creator_list_wehouse_hotel_discounts() where id::text=current_setting('test.hotel_discount')),'Hotel campaign stores its duration');
select public.creator_stop_wehouse_discount((select id from public.creator_list_wehouse_discounts() limit 1));
select pg_temp.expect((select count(*) from public.creator_list_wehouse_discounts())=0,'Creator can stop it');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000004","session_id":"98000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount(null,'Lagos',10)$$),'an Admin cannot spend WeHouse money');
select pg_temp.expect(pg_temp.rejects($$select * from public.creator_list_wehouse_discounts()$$),'an Admin cannot list WeHouse discounts');
select 'listing_discounts_contract_ok';
rollback;
