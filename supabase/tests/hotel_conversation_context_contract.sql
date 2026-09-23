\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city,full_name) values
('87999999-0000-4000-8000-000000000001','hc-owner@example.invalid','hc-owner','property_partner',true,'Nasarawa','Lafia','Owner'),
('87999999-0000-4000-8000-000000000002','hc-guest@example.invalid','hc-guest','creator',true,'Nasarawa','Lafia','Guest'),
('87999999-0000-4000-8000-000000000003','hc-desk-a@example.invalid','hc-desk-a','user',true,'Nasarawa','Lafia','Reception A'),
('87999999-0000-4000-8000-000000000004','hc-desk-b@example.invalid','hc-desk-b','user',true,'Nasarawa','Lafia','Reception B'),
('87999999-0000-4000-8000-000000000005','hc-other@example.invalid','hc-other','admin',true,'Nasarawa','Lafia','Unassigned Admin'),
('87999999-0000-4000-8000-000000000006','hc-message@example.invalid','hc-message','user',true,'Nasarawa','Lafia','Message Only');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values ('hc-owner','property_partner','global','active'),('hc-guest','creator','global','active'),('hc-other','admin','global','active');
insert into public.hotels(hotel_id,name,state,city,owner_id,status) values (-8799,'Context Hotel','Nasarawa','Lafia','hc-owner','active');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values (-8799,-8799,'Deluxe',20000,3);
insert into public.hotel_team_members(hotel_id,member_user_id,hotel_role,status,capabilities,invited_by) values
(-8799,'hc-desk-a','front_desk','active',array['stay.read','stay.message'],'hc-owner'),
(-8799,'hc-desk-b','front_desk','active',array['stay.read','stay.message'],'hc-owner'),
(-8799,'hc-message','front_desk','active',array['stay.message'],'hc-owner');
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,payment_status,special_requests,booking_code) values
(-8799,-8799,-8799,'hc-guest',current_date+2,current_date+3,1,20000,'confirmed','paid','Quiet room, please','PRIVATE-HANDOVER'),
(-8798,-8799,-8799,'hc-guest',current_date+4,current_date+5,1,20000,'confirmed','paid','Second stay only','SECOND-CODE');
insert into public.hotel_booking_conversations(id,booking_id,hotel_id,guest_user_id) values
('87999999-1000-4000-8000-000000000001',-8799,-8799,'hc-guest'),('87999999-1000-4000-8000-000000000002',-8798,-8799,'hc-guest');
insert into public.hotel_booking_messages(id,conversation_id,sender_id,content,hidden_for) values
('87999999-2000-4000-8000-000000000001','87999999-1000-4000-8000-000000000001','hc-guest','May I arrive at six?',array[]::text[]),
('87999999-2000-4000-8000-000000000002','87999999-1000-4000-8000-000000000001','hc-desk-a','We have noted your request.',array[]::text[]),
('87999999-2000-4000-8000-000000000003','87999999-1000-4000-8000-000000000002','hc-guest','Other booking only',array[]::text[]),
('87999999-2000-4000-8000-000000000004','87999999-1000-4000-8000-000000000001','hc-desk-a','Hidden for guest',array['hc-guest']);
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','87999999-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare b jsonb; begin
 b:=public.get_my_hotel_conversation_bundle('87999999-1000-4000-8000-000000000001',-8799);
 if b->'context'->>'viewer_party'<>'guest' or b->'context'->>'special_requests'<>'Quiet room, please' or (b->'context'->>'can_reply')::boolean is not true then raise exception 'Professional account lost its guest identity'; end if;
 if jsonb_array_length(b->'messages')<>2 or b::text like '%PRIVATE-HANDOVER%' or b::text like '%Other booking only%' or b::text like '%Hidden for guest%' then raise exception 'Bundle leaked unrelated/private data'; end if;
 if public.open_my_hotel_booking_conversation(-8799)<>'87999999-1000-4000-8000-000000000001'::uuid or public.open_my_hotel_booking_conversation(-8799)<>'87999999-1000-4000-8000-000000000001'::uuid then raise exception 'Repeated entry created another conversation'; end if;
 begin perform public.get_my_hotel_conversation_bundle('87999999-1000-4000-8000-000000000001',-8798); raise exception 'Mixed booking accepted'; exception when insufficient_privilege then null; end;
 if (select unread_count from public.get_my_hotel_booking_conversations() where booking_id=-8799)<>1 then raise exception 'Guest unread includes hidden/self messages'; end if;
end $$;
reset role;
-- A different receptionist reads the guest, NOT another receptionist's hotel reply.
select set_config('request.jwt.claim.sub','87999999-0000-4000-8000-000000000004',true);
set local role authenticated;
do $$ declare b jsonb; begin
 b:=public.get_my_hotel_conversation_bundle('87999999-1000-4000-8000-000000000001',-8799);
 if b->'context'->>'viewer_party'<>'hotel' or b->'context'->>'special_requests'<>'Quiet room, please' then raise exception 'Hotel context missing from direct Inbox route'; end if;
 if (select unread_count from public.get_my_hotel_booking_conversations() where booking_id=-8799)<>1 then raise exception 'Colleague hotel replies counted as incoming guest messages'; end if;
 perform public.mark_hotel_booking_messages_read('87999999-1000-4000-8000-000000000001');
end $$;
reset role;
do $$ begin
 if not (select is_read from public.hotel_booking_messages where id='87999999-2000-4000-8000-000000000001') then raise exception 'Hotel did not acknowledge guest message'; end if;
 if (select is_read from public.hotel_booking_messages where id='87999999-2000-4000-8000-000000000002') then raise exception 'Colleague falsely acknowledged guest reading'; end if;
 if (select is_read from public.hotel_booking_messages where id='87999999-2000-4000-8000-000000000003') then raise exception 'Other booking was marked read'; end if;
end $$;
select set_config('request.jwt.claim.sub','87999999-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare reply uuid; begin
 perform public.mark_hotel_booking_messages_read('87999999-1000-4000-8000-000000000001');
 reply:=public.send_hotel_booking_message('87999999-1000-4000-8000-000000000001','Thank you. Is parking available?',array[]::text[],array[]::text[],'87999999-2000-4000-8000-000000000002');
 if not exists(select 1 from public.get_hotel_booking_messages('87999999-1000-4000-8000-000000000001') where id=reply and sender_role='guest') then raise exception 'Follow-up lost same booking thread'; end if;
 begin perform public.send_hotel_booking_message('87999999-1000-4000-8000-000000000001','Wrong quote',array[]::text[],array[]::text[],'87999999-2000-4000-8000-000000000003'); raise exception 'Cross-booking reply accepted'; exception when others then if sqlerrm='Cross-booking reply accepted' then raise; end if; end;
end $$;
reset role;
do $$ begin
 if not (select is_read from public.hotel_booking_messages where id='87999999-2000-4000-8000-000000000002') then raise exception 'Guest reading not acknowledged'; end if;
 if (select is_read from public.hotel_booking_messages where id='87999999-2000-4000-8000-000000000004') then raise exception 'Hidden message marked read'; end if;
 if (select count(*) from public.hotel_booking_conversations where booking_id=-8799)<>1 then raise exception 'Follow-up created duplicate conversation'; end if;
end $$;
select set_config('request.jwt.claim.sub','87999999-0000-4000-8000-000000000006',true);
set local role authenticated;
do $$ declare b jsonb; begin
 b:=public.get_my_hotel_conversation_bundle('87999999-1000-4000-8000-000000000001',-8799);
 if b->'context'->>'request_visible'<>'false' or b->'context'->>'special_requests' is not null then raise exception 'Message-only role received private stay note'; end if;
end $$;
reset role;
update public.hotel_team_members set status='revoked',revoked_at=now() where member_user_id='hc-message';
set local role authenticated;
do $$ begin
 begin perform public.get_my_hotel_conversation_bundle('87999999-1000-4000-8000-000000000001',-8799); raise exception 'Revoked membership retained context'; exception when insufficient_privilege then null; end;
 begin perform public.mark_hotel_booking_messages_read('87999999-1000-4000-8000-000000000001'); raise exception 'Revoked membership retained receipts'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','87999999-0000-4000-8000-000000000005',true);
set local role authenticated;
do $$ begin
 begin perform public.get_my_hotel_conversation_bundle('87999999-1000-4000-8000-000000000001',-8799); raise exception 'Unassigned admin read guest/hotel chat'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local session_replication_role=replica;
update public.hotel_bookings set status='checked_out' where booking_id=-8799;
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','87999999-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare b jsonb; begin
 b:=public.get_my_hotel_conversation_bundle('87999999-1000-4000-8000-000000000001',-8799);
 if b->'context'->>'can_reply'<>'false' or jsonb_array_length(b->'messages')<>3 then raise exception 'Ended stay lost history or kept composer'; end if;
 begin perform public.send_hotel_booking_message('87999999-1000-4000-8000-000000000001','Closed'); raise exception 'Closed stay accepted send'; exception when others then if sqlerrm='Closed stay accepted send' then raise; end if; end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.get_my_hotel_conversation_bundle(uuid,integer)','execute') then raise exception 'Anonymous conversation bundle exposed'; end if;
end $$;
rollback;
