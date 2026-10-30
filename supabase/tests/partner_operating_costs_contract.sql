begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %',description; end if; end $$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated,anon;
create temp table pc_wallet_baseline as select count(*) as records from public.wallet_transactions;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('97300000-0000-4000-8000-000000000001','pc-owner@example.invalid','pc-owner','user',true),
('97300000-0000-4000-8000-000000000002','pc-other@example.invalid','pc-other','user',true),
('97300000-0000-4000-8000-000000000003','pc-guest@example.invalid','pc-guest','user',true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
('pc-owner','property_partner','global','active'),('pc-other','property_partner','global','active');
insert into public.hotels(hotel_id,name,state,city,owner_id,status) values
(-97301,'Cost Contract Hotel','Lagos','Ikeja','pc-owner','active'),(-97302,'Other Cost Hotel','Lagos','Ikeja','pc-other','active');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values(-97301,-97301,'Standard',100000,2);
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,payment_status)
  values(-97301,-97301,-97301,'pc-guest',current_date,current_date+1,1,100000,'confirmed','paid');
with paid as(insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,amount,amount_total,currency,status,purpose)
  values('pc-pro-1','pc-pro-1','pc-owner','pc-owner',100,100,'NGN','paid','partner_pro_access'),
    ('pc-pro-2','pc-pro-2','pc-other','pc-other',100,100,'NGN','paid','partner_pro_access') returning id,user_id)
insert into public.partner_pro_entitlements(partner_id,current_period_end,last_payment_id) select user_id,now()+interval '1 month',id from paid;
with paid as(insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,hotel_booking_id,amount,amount_total,currency,status,purpose)
  values('pc-income','pc-income','pc-guest','pc-guest',-97301,100000,100000,'NGN','paid','hotel_booking') returning id)
insert into public.property_partner_earning_releases(payment_id,partner_id,earning_type,status,net_amount,released_at)
  select id,'pc-owner','hotel_payment','available',100000,now() from paid;
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"97300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
create temp table pc_record as select public.record_my_partner_operating_cost('97310000-0000-4000-8000-000000000001','hotel','-97301','cleaning','Turnover cleaning',12500,current_date) as cost;
select pg_temp.expect(public.record_my_partner_operating_cost('97310000-0000-4000-8000-000000000001','hotel','-97301','cleaning','Turnover cleaning',12500,current_date)->>'id'=(select cost->>'id' from pc_record),'same cost intent returns one record');
select pg_temp.expect(pg_temp.rejects($$select public.record_my_partner_operating_cost('97310000-0000-4000-8000-000000000001','hotel','-97301','cleaning','Turnover cleaning',13000,current_date)$$),'changed details cannot reuse cost intent');
select pg_temp.expect(pg_temp.rejects($$select public.record_my_partner_operating_cost(gen_random_uuid(),'hotel','-97302','cleaning','Other owner property',100,current_date)$$),'cannot attach costs to another owner property');
select pg_temp.expect(pg_temp.rejects($$select public.record_my_partner_operating_cost(gen_random_uuid(),'hotel','-97301','cleaning','Invalid amount','NaN'::numeric,current_date)$$),'NaN is rejected');
select pg_temp.expect(pg_temp.rejects($$select public.record_my_partner_operating_cost(gen_random_uuid(),'hotel','-97301','cleaning','Invalid amount',1.005,current_date)$$),'sub-kobo amount is rejected');
select pg_temp.expect(pg_temp.rejects($$insert into public.partner_pro_operating_costs(owner_id,request_key,asset_kind,asset_id,category,title,amount_ngn,incurred_on) values('pc-owner',gen_random_uuid(),'hotel','-97301','cleaning','Direct write',100,current_date)$$),'no direct cost mutation');
select pg_temp.expect((public.get_my_partner_operating_report(current_date,'hotel','-97301')->>'recorded_costs_ngn')::numeric=12500,'property report includes recorded costs');
select pg_temp.expect((public.get_my_partner_operating_report(current_date,'hotel','-97301')->>'recorded_margin_ngn')::numeric=87500,'property report joins canonical released income');
select set_config('request.jwt.claims','{"sub":"97300000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.partner_pro_operating_costs where owner_id='pc-owner')=0,'other Partner cannot read cost metadata');
select pg_temp.expect(pg_temp.rejects($$select public.void_my_partner_operating_cost((select (cost->>'id')::uuid from pc_record),'Other person void')$$),'other Partner cannot void cost');
select pg_temp.expect(pg_temp.rejects($$select public.get_my_partner_operating_report(current_date,'hotel','-97301')$$),'other Partner cannot open property report');
reset role;
update public.partner_pro_entitlements set review_started_at=now(),review_reason='Contract provider review' where partner_id='pc-owner';
select set_config('request.jwt.claims','{"sub":"97300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.get_my_partner_operating_report(current_date)$$),'provider review suspends paid report tools');
select pg_temp.expect((select count(*) from public.partner_pro_operating_costs where owner_id='pc-owner')=1,'own stored records remain readable during paid-access review');
reset role;
update public.partner_pro_entitlements set review_started_at=null,review_reason=null,current_period_end=now()-interval '1 day' where partner_id='pc-owner';
set local role authenticated;
select pg_temp.expect(pg_temp.rejects($$select public.record_my_partner_operating_cost(gen_random_uuid(),'hotel','-97301','cleaning','Expired paid access',100,current_date)$$),'expired plan cannot create a cost record');
reset role;
update public.partner_pro_entitlements set current_period_end=now()+interval '1 month' where partner_id='pc-owner';
insert into public.partner_pro_operating_costs(owner_id,request_key,asset_kind,asset_id,category,title,amount_ngn,incurred_on)
  select 'pc-owner',gen_random_uuid(),'hotel','-97301','supplies','Pagination cost '||n,100,current_date from generate_series(1,51) n;
set local role authenticated;
create temp table pc_page as select public.get_my_partner_operating_report(current_date) as report;
select pg_temp.expect(jsonb_array_length((select report->'costs' from pc_page))=50,'report page is bounded');
select pg_temp.expect((select (report->>'cost_count')::int from pc_page)=52,'aggregate count includes all pages');
select pg_temp.expect(jsonb_array_length(public.get_my_partner_operating_report(current_date,null,null,(select (report->>'next_before_on')::date from pc_page),(select (report->>'next_before_id')::uuid from pc_page))->'costs')=2,'keyset cursor returns remaining records');
select public.void_my_partner_operating_cost((select (cost->>'id')::uuid from pc_record),'Entered twice in another accounting record.');
select pg_temp.expect((public.get_my_partner_operating_report(current_date)->>'recorded_costs_ngn')::numeric=5100,'voided records leave current totals');
select pg_temp.expect((select voided_at is not null from public.partner_pro_operating_costs where id=(select (cost->>'id')::uuid from pc_record)),'void retains its historical record');
reset role;
set local session_replication_role=replica;
with paid as(insert into public.booking_payments(payment_reference,paystack_reference,user_id,payer_user_id,amount,amount_total,currency,status,purpose)
  values('pc-usd','pc-usd','pc-guest','pc-guest',100,100,'USD','paid','hotel_booking') returning id)
insert into public.property_partner_earning_releases(payment_id,partner_id,earning_type,status,net_amount,released_at)
  select id,'pc-owner','hotel_payment','available',100,now() from paid;
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.expect((public.get_my_partner_operating_report(current_date)->>'mixed_currency')::boolean,'mixed currencies are detected');
select pg_temp.expect(public.get_my_partner_operating_report(current_date)->'recorded_margin_ngn'='null'::jsonb,'mixed currency margin is unavailable rather than fabricated');
reset role;
select pg_temp.expect((select count(*) from public.wallet_transactions)=(select records from pc_wallet_baseline),'cost records never create wallet movements');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.expect(pg_temp.rejects($$select public.get_my_partner_operating_report(current_date)$$),'anonymous report access denied');
reset role;
rollback;
