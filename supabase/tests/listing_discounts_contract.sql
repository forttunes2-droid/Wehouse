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
insert into public.listings(id,listing_id,title,price,state,owner_id) values
('98000000-0000-4000-8000-0000000000e1','dc-home-1','Home 1',100000,'Lagos','dc-a'),
('98000000-0000-4000-8000-0000000000e2','dc-home-2','Home 2',100000,'Lagos','dc-b');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(public.set_my_listing_discount('98000000-0000-4000-8000-0000000000e1',50) is not null,'host can discount their own home up to 50%');
select pg_temp.expect(pg_temp.rejects($$select public.set_my_listing_discount('98000000-0000-4000-8000-0000000000e1',4)$$),'below 5% is refused');
select pg_temp.expect(pg_temp.rejects($$select public.set_my_listing_discount('98000000-0000-4000-8000-0000000000e1',51)$$),'above 50% is refused');
select pg_temp.expect(pg_temp.rejects($$select public.set_my_listing_discount('98000000-0000-4000-8000-0000000000e2',10)$$),'host cannot discount someone else''s home');
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount('98000000-0000-4000-8000-0000000000e1',null,10)$$),'a host cannot spend WeHouse money');
select pg_temp.expect(pg_temp.rejects($$select count(*) from public.listing_discounts$$),'no direct table access');
select pg_temp.expect(public.set_my_listing_discount('98000000-0000-4000-8000-0000000000e1',20) is not null,'host can change their discount');
select pg_temp.expect(public.listing_discount_percent('98000000-0000-4000-8000-0000000000e1')=20,'only the newest host discount counts');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount('98000000-0000-4000-8000-0000000000e1',null,16)$$),'WeHouse discount above 15% is refused');
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount('98000000-0000-4000-8000-0000000000e1','Lagos',10)$$),'property and state together is refused');
select pg_temp.expect(public.creator_set_wehouse_discount(null,'Lagos',15) is not null,'Creator can fund a state-wide discount');
select pg_temp.expect(public.listing_discount_percent('98000000-0000-4000-8000-0000000000e1')=35,'host 20% plus WeHouse 15% adds up');
select pg_temp.expect(public.listing_discount_percent('98000000-0000-4000-8000-0000000000e2')=15,'state discount reaches other Lagos homes');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.creator_set_wehouse_discount(null,'Lagos',10)$$),'an Admin cannot spend WeHouse money');
select 'listing_discounts_contract_ok';
rollback;
