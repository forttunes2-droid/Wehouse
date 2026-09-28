\set ON_ERROR_STOP on
begin;

-- Booking references must not grant either hotel transition to a browser role.
do $$ begin
  if has_function_privilege('authenticated','public.partner_transition_hotel_booking(integer,text)','execute')
     or has_function_privilege('authenticated','public.confirm_hotel_check_in_by_code(text)','execute') then
    raise exception 'A signed-in user can bypass guest presence proof';
  end if;
  if has_table_privilege('authenticated','private.hotel_stay_proofs','select') then
    raise exception 'Guest code hashes leaked to signed-in users';
  end if;
end $$;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('78555555-0000-4000-8000-000000000001','presence-owner@example.invalid','presence-owner','property_partner',true),
('78555555-0000-4000-8000-000000000002','presence-guest@example.invalid','presence-guest','user',true),
('78555555-0000-4000-8000-000000000003','presence-other@example.invalid','presence-other','user',true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values('presence-owner','property_partner','global','active');
insert into public.hotels(hotel_id,name,state,city,owner_id,status,timezone,check_in_time,check_out_time)
values(-7855,'Presence Contract Hotel','Nasarawa','Lafia','presence-owner','active','Africa/Lagos','00:00','23:59');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms)
values(-7855,-7855,'Standard',20000,1);
insert into public.hotel_room_units(unit_id,hotel_id,room_id,unit_label,status) overriding system value
values(-7855,-7855,-7855,'101','ready');
insert into public.payment_protection_transactions(id,booking_type,payer_user_id,payee_user_id,amount_total,amount_commission,amount_payee,commission_rate,protection_state,subject_type,subject_id)
values('78555555-1000-4000-8000-000000000001','hotel_booking','presence-guest','presence-owner',40000,4800,35200,0.12,'protected','hotel_booking','-7855');
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,canonical_state,payment_status,booking_code,payment_protection_id,arrival_issue_policy_version_id,arrival_issue_window_hours)
select -7855,-7855,-7855,'presence-guest',timezone('Africa/Lagos',now())::date,timezone('Africa/Lagos',now())::date+2,2,40000,'confirmed','confirmed','paid','PRESENCE-REF','78555555-1000-4000-8000-000000000001'::uuid,policy_version_id,default_hours
from public.current_accommodation_arrival_policy();
set local session_replication_role=origin;

select set_config('request.jwt.claim.sub','78555555-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
  begin
    perform public.issue_my_hotel_stay_code(-7855,'checked_in');
    raise exception 'Another account issued the guest code';
  exception when raise_exception then
    if sqlerrm<>'This hotel stay is not available to your account' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','78555555-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.issue_my_hotel_stay_code(-7855,'checked_in') as arrival_code \gset
do $$ begin
  begin
    perform public.issue_my_hotel_stay_code(-7855,'checked_out');
    raise exception 'Guest issued departure before arrival';
  exception when raise_exception then
    if sqlerrm<>'The guest must be checked in before departure' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','78555555-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare result jsonb; begin
  result:=public.partner_confirm_hotel_stay_with_code(-7855,'checked_in','00000000');
  if (result->>'success')::boolean then raise exception 'Wrong guest code accepted'; end if;
end $$;
reset role;
do $$ begin
  if (select attempts from private.hotel_stay_proofs where booking_id=-7855)<>1 then
    raise exception 'Wrong code did not consume an attempt';
  end if;
end $$;
set local role authenticated;
select public.partner_confirm_hotel_stay_with_code(-7855,'checked_in',:'arrival_code') as arrival_result \gset
reset role;
do $$ begin
  if exists(select 1 from private.hotel_stay_proofs where booking_id=-7855)
     or (select status from public.hotel_room_units where unit_id=-7855)<>'occupied' then
    raise exception 'Arrival code was reusable or room stayed ready';
  end if;
end $$;
select set_config('request.jwt.claim.sub','78555555-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.issue_my_hotel_stay_code(-7855,'checked_out') as departure_code \gset
reset role;
select set_config('request.jwt.claim.sub','78555555-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.partner_confirm_hotel_stay_with_code(-7855,'checked_out',:'departure_code') as departure_result \gset
reset role;
do $$ begin
  if (select status from public.hotel_room_units where unit_id=-7855)<>'cleaning'
     or (select status from public.hotel_bookings where booking_id=-7855)<>'checked_out' then
    raise exception 'Verified departure did not complete checkout and cleaning';
  end if;
end $$;
rollback;
