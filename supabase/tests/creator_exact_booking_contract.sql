begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.rejects(text) to authenticated;
-- Synthetic read-contract history, not a booking-creation/payment test. Restore
-- all user triggers before invoking either browser-facing read function.
alter table public.reservations disable trigger user;
alter table public.hotel_bookings disable trigger user;
do $$
declare actor uuid:=gen_random_uuid(); person text:='booking-lookup-'||actor;
 old_id text:=gen_random_uuid()::text; receipt jsonb; hotel integer; room integer; stay integer; i integer;
begin
 insert into auth.users(id,aud,role,email,created_at,updated_at) values(actor,'authenticated','authenticated',actor||'@example.invalid',now(),now());
 insert into public.profiles(user_id,auth_id,email,role,profile_complete) values(person,actor,actor||'@example.invalid','user',true);
 insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values(person,'creator','global');
 insert into public.reservations(id,listing_id,user_id,status,created_at) values(old_id,'lookup-test-home',person,'cancelled',now()-interval '2 years');
 for i in 1..101 loop
  insert into public.reservations(listing_id,user_id,status) values('lookup-test-home',person,'cancelled');
 end loop;
 insert into public.hotels(name,state,city,owner_id,status) values('Lookup contract','Nasarawa','Lafia',person,'inactive') returning hotel_id into hotel;
 insert into public.hotel_rooms(hotel_id,room_type,price_per_night) values(hotel,'Contract room',10000) returning room_id into room;
 insert into public.hotel_bookings(hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,payment_status)
 values(hotel,room,person,current_date+2,current_date+3,1,10000,'cancelled','unpaid') returning booking_id into stay;
 alter table public.reservations enable trigger user;
 alter table public.hotel_bookings enable trigger user;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(not exists(select 1 from jsonb_array_elements(public.creator_get_booking_records('apartments',100)) r where r->>'id'=old_id),'old record outside first page');
 receipt:=public.creator_get_booking_record('apartments',old_id);
 perform pg_temp.expect(receipt->>'id'=old_id and receipt->>'kind'='apartment','old exact home available');
 receipt:=public.creator_get_booking_record('hotels',stay::text);
 perform pg_temp.expect(receipt->>'id'=stay::text and receipt->>'kind'='hotel','exact hotel available');
 perform pg_temp.expect(public.creator_get_booking_record('apartments','missing-record') is null,'missing record does not choose another');
 perform pg_temp.expect(pg_temp.rejects('select public.creator_get_booking_record(null,''1'')'),'null kind rejected');
 perform pg_temp.expect(pg_temp.rejects('select public.creator_get_booking_record(''hotels'',''1 OR 1=1'')'),'malformed ID rejected');
 execute 'reset role';
 update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id=person and workspace_role='creator';
 execute 'set local role authenticated';
 perform pg_temp.expect(pg_temp.rejects(format('select public.creator_get_booking_record(''apartments'',%L)',old_id)),'revoked Creator denied');
 execute 'reset role';
end $$;
select 'Creator exact booking contract passed' as result;
rollback;
