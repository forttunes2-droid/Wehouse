\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAILED: %', description; end if; end $$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('99000000-0000-4000-8000-000000000001','pin-a@example.invalid','pin-a','user',true,'consumer','A','Lagos','Ikeja','Ikeja'),
('99000000-0000-4000-8000-000000000002','pin-b@example.invalid','pin-b','user',true,'consumer','B','Lagos','Ikeja','Ikeja'),
('99000000-0000-4000-8000-000000000003','pin-c@example.invalid','pin-c','user',true,'consumer','C','Lagos','Ikeja','Ikeja');
insert into public.conversations(id,participant_a,participant_b,status,conversation_type) values
('99000000-0000-4000-8000-0000000000c1','pin-a','pin-b','active','roommate');
insert into public.messages(id,conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version) values
('99000000-0000-4000-8000-000000000100','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000101','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000102','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000103','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000104','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000105','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000106','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000107','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000108','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000109','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000110','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1),
('99000000-0000-4000-8000-000000000111','99000000-0000-4000-8000-0000000000c1','pin-a','[Encrypted message]','ciphertext','iv',1);
set local session_replication_role=origin;

select set_config('request.jwt.claims','{"sub":"99000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(public.set_message_pin('roommate','99000000-0000-4000-8000-0000000000c1','99000000-0000-4000-8000-000000000100',true)=1,'a participant can pin');
select pg_temp.expect(public.set_message_pin('roommate','99000000-0000-4000-8000-0000000000c1','99000000-0000-4000-8000-000000000100',true)=1,'pinning twice is harmless');
select pg_temp.expect(pg_temp.rejects($$select public.set_message_pin('roommate','99000000-0000-4000-8000-0000000000c1','99000000-0000-4000-8000-0000000009ff',true)$$),'a message from nowhere cannot be pinned');
select pg_temp.expect(pg_temp.rejects($$select public.set_message_pin('worker','99000000-0000-4000-8000-0000000000c1','99000000-0000-4000-8000-000000000100',true)$$),'a conversation cannot be pinned through the wrong chat type');
select set_config('request.jwt.claims','{"sub":"99000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.get_message_pins('roommate','99000000-0000-4000-8000-0000000000c1'))=1,'the other person sees the same pins');
do $$ begin for i in 1..9 loop
  perform public.set_message_pin('roommate','99000000-0000-4000-8000-0000000000c1',('99000000-0000-4000-8000-0000000001'||lpad(i::text,2,'0'))::uuid,true);
end loop; end $$;
select pg_temp.expect((select count(*) from public.get_message_pins('roommate','99000000-0000-4000-8000-0000000000c1'))=10,'both people can pin, up to ten');
select pg_temp.expect(pg_temp.rejects($$select public.set_message_pin('roommate','99000000-0000-4000-8000-0000000000c1','99000000-0000-4000-8000-000000000110',true)$$),'an eleventh pin is refused');
select pg_temp.expect(public.set_message_pin('roommate','99000000-0000-4000-8000-0000000000c1','99000000-0000-4000-8000-000000000100',false)=9,'either person can unpin');
select set_config('request.jwt.claims','{"sub":"99000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select * from public.get_message_pins('roommate','99000000-0000-4000-8000-0000000000c1')$$),'an outsider cannot read pins');
select pg_temp.expect(pg_temp.rejects($$select public.set_message_pin('roommate','99000000-0000-4000-8000-0000000000c1','99000000-0000-4000-8000-000000000101',false)$$),'an outsider cannot unpin');
select pg_temp.expect(pg_temp.rejects($$select count(*) from public.message_pins$$),'no direct table access');
reset role;
select set_config('request.jwt.claims','',true);
set local role anon;
select pg_temp.expect(pg_temp.rejects($$select public.set_message_pin('roommate','99000000-0000-4000-8000-0000000000c1','99000000-0000-4000-8000-000000000101',true)$$),'signed-out people cannot pin');
reset role;

-- Discount breakdown: public, percentages only.
set local session_replication_role=replica;
insert into public.listings(id,listing_id,title,price,state,owner_id) values
('99000000-0000-4000-8000-0000000000e1','pin-home','Pin Home',100000,'Lagos','pin-a');
insert into public.listing_discounts(listing_id,funded_by,percent,ends_on,created_by) values
('99000000-0000-4000-8000-0000000000e1','host',20,current_date+30,'pin-a');
set local session_replication_role=origin;
set local role anon;
select pg_temp.expect((public.listing_discount_breakdown('99000000-0000-4000-8000-0000000000e1')->>'host_percent')::numeric=20,'guests see the host share');
select pg_temp.expect((public.listing_discount_breakdown('99000000-0000-4000-8000-0000000000e1')->>'total_percent')::numeric=20,'guests see the total');
select pg_temp.expect(public.listing_discount_breakdown('99000000-0000-4000-8000-0000000000e1')->>'ends_on' is not null,'guests see when it ends');
reset role;
select 'message_pins_contract_ok';
rollback;
