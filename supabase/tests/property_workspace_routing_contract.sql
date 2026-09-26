\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city) values
('86666666-0000-4000-8000-000000000001','property-owner@example.invalid','property-route-owner','property_partner',true,'Nasarawa','Lafia'),
('86666666-0000-4000-8000-000000000002','property-guest@example.invalid','property-route-guest','user',true,'Nasarawa','Lafia'),
('86666666-0000-4000-8000-000000000003','property-desk@example.invalid','property-route-desk','user',true,'Nasarawa','Lafia'),
('86666666-0000-4000-8000-000000000004','property-rooms@example.invalid','property-route-rooms','user',true,'Nasarawa','Lafia'),
('86666666-0000-4000-8000-000000000005','property-other@example.invalid','property-route-other','user',true,'Nasarawa','Keffi'),
('86666666-0000-4000-8000-000000000006','property-creator@example.invalid','property-route-creator','user',true,'Nasarawa','Lafia');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,status) values
('property-route-owner','property_partner','global',null,null,'active'),
('property-route-other','admin','branch','Nasarawa','Keffi','active'),
('property-route-creator','creator','global',null,null,'active');
insert into public.hotels(hotel_id,name,state,city,owner_id,status) values
(-8661,'Routing Hotel','Nasarawa','Lafia','property-route-owner','active'),
(-8662,'Other Hotel','Nasarawa','Keffi','property-route-other','active');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values
(-8661,-8661,'Standard',20000,2),(-8662,-8661,'Deluxe',30000,1),(-8663,-8662,'Other room',20000,1);
insert into public.hotel_team_members(hotel_id,member_user_id,hotel_role,status,capabilities,invited_by) values
(-8661,'property-route-owner','front_desk','active',array['stay.read'],'property-route-owner'),
(-8661,'property-route-desk','front_desk','active',array['stay.read'],'property-route-owner'),
(-8661,'property-route-rooms','front_desk','active',array['room.mark_ready'],'property-route-owner');
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,payment_status) values
(-8661,-8661,-8661,'property-route-guest',current_date+2,current_date+3,1,20000,'pending','unpaid'),
(-8662,-8662,-8663,'property-route-guest',current_date+2,current_date+3,1,20000,'confirmed','paid');
set local session_replication_role=origin;
-- The trigger owns audience production, including legacy professional-role accounts.
insert into public.notifications(recipient_id,type,title,source_type,source_id,destination_route,workspace_scope)
values('property-route-owner','saved_search_match','A new home matches your search','listing','public-home','detail','partner');
update public.hotel_bookings set status='confirmed',payment_status='paid' where booking_id=-8661;
do $$ begin
  if exists(select 1 from public.notifications where recipient_id='property-route-owner' and type='saved_search_match' and workspace_scope<>'personal') then raise exception 'Saved search went to professional workspace'; end if;
  if exists(select 1 from public.activity_event_audiences a join public.activity_events e using(activity_event_id) where e.subject_id='-8661' and a.recipient_user_id='property-route-rooms') then raise exception 'Guest Activity leaked to room-only staff'; end if;
  if not exists(select 1 from public.activity_event_audiences a join public.activity_events e using(activity_event_id) where e.subject_id='-8661' and a.recipient_user_id='property-route-desk' and a.workspace='hotel') then raise exception 'Authorized desk did not receive Activity'; end if;
end $$;
select set_config('request.jwt.claim.sub','86666666-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare hotels jsonb; begin
  hotels:=public.get_my_hotel_operations();
  if jsonb_array_length(hotels)<>1 or hotels->0->>'room_type_count'<>'2' or hotels->0->>'total_room_count'<>'3' then raise exception 'Authorized inventory counts incorrect'; end if;
  if public.get_my_hotel_booking_target(-8661)->>'hotel_id'<>'-8661' then raise exception 'Wrong stay parent'; end if;
  if public.get_my_hotel_operation_snapshot_v2(-8661,-8661)->'bookings'->0->>'booking_id'<>'-8661' then raise exception 'Exact selected stay missing'; end if;
  begin perform public.get_my_hotel_booking_target(-8662); raise exception 'Cross-hotel stay leak'; exception when others then if sqlerrm='Cross-hotel stay leak' then raise; end if; end;
  begin perform public.get_my_hotel_operation_snapshot_v2(-8661,-8662); raise exception 'Mismatched parent accepted'; exception when others then if sqlerrm='Mismatched parent accepted' then raise; end if; end;
  if exists(select 1 from public.get_my_canonical_activity_v2('partner',100) where type='saved_search_match') then raise exception 'Partner feed contains saved search'; end if;
  if not exists(select 1 from public.get_my_canonical_activity_v2('personal',100) where type='saved_search_match') then raise exception 'Personal feed lost saved search'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','86666666-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.get_my_canonical_activity_v2('hotel',100) where source_id='-8661') then raise exception 'Desk feed missing'; end if;
  if public.get_my_hotel_booking_target(-8661)->>'hotel_id'<>'-8661' then raise exception 'Desk cannot resolve its stay'; end if;
end $$;
reset role;
-- Permission change must revoke old feeds AND direct table reads without deleting history.
update public.hotel_team_members set capabilities=array['room.mark_ready'] where member_user_id='property-route-desk';
set local role authenticated;
do $$ begin
  if exists(select 1 from public.get_my_canonical_activity_v2('hotel',100) where source_id='-8661') then raise exception 'Historical guest Activity survived capability revocation'; end if;
  if (public.get_my_canonical_activity_summary('hotel')->>'unread')::integer<>0 then raise exception 'Revoked Activity still counted'; end if;
  if exists(select 1 from public.activity_events where subject_id='-8661') then raise exception 'Direct Activity RLS bypassed revocation'; end if;
  if public.mark_all_my_canonical_activity_read('hotel')<>0 then raise exception 'Revoked Activity can be mutated'; end if;
  begin perform public.get_my_hotel_booking_target(-8661); raise exception 'Revoked stay access survived'; exception when others then if sqlerrm='Revoked stay access survived' then raise; end if; end;
end $$;
reset role;
update public.hotel_team_members set capabilities=array['stay.read'],revoked_at=now() where member_user_id='property-route-desk';
set local role authenticated;
do $$ begin
  if jsonb_array_length(public.get_my_hotel_operations())<>0 then raise exception 'Revoked membership resurrected'; end if;
  begin perform public.get_my_hotel_operation_snapshot(-8661); raise exception 'Revoked snapshot survived'; exception when others then if sqlerrm='Revoked snapshot survived' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','86666666-0000-4000-8000-000000000005',true);
set local role authenticated;
do $$ begin
  begin perform public.get_my_property_hotel_record(-8661); raise exception 'Admin crossed LGA'; exception when others then if sqlerrm='Admin crossed LGA' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','86666666-0000-4000-8000-000000000006',true);
set local role authenticated;
do $$ declare record jsonb; begin
  record:=public.get_my_property_hotel_record(-8661);
  if record->>'name'<>'Routing Hotel' or jsonb_array_length(record->'hotel_rooms')<>2 or record ? 'bookings' then raise exception 'Internal property projection is wrong'; end if;
end $$;
reset role;
update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id in ('property-route-owner','property-route-creator');
select set_config('request.jwt.claim.sub','86666666-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
  if jsonb_array_length(public.get_my_hotel_operations())<>0 then raise exception 'Revoked owner workspace still controls hotel'; end if;
  if exists(select 1 from public.get_my_canonical_activity_v2('partner',100)) then raise exception 'Revoked partner retained Activity'; end if;
  if not exists(select 1 from public.get_my_canonical_activity_v2('personal',100) where type='saved_search_match') then raise exception 'Revocation erased Personal'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.hotels where hotel_id=-8661) or not exists(select 1 from public.hotel_bookings where booking_id=-8661) then raise exception 'Domain records were deleted'; end if;
  if has_function_privilege('anon','public.get_my_hotel_booking_target(integer)','execute') or has_function_privilege('anon','public.get_my_property_hotel_record(integer)','execute') then raise exception 'Anonymous access exposed'; end if;
end $$;
rollback;


-- Removing a Host manager must transfer active booking/chat responsibility back
-- to the owner before the assignment is revoked.
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city) values
('86666666-1000-4000-8000-000000000001','host-owner@example.invalid','host-continuity-owner','property_partner',true,'Nasarawa','Lafia'),
('86666666-1000-4000-8000-000000000002','host-manager@example.invalid','host-continuity-manager','user',true,'Nasarawa','Lafia'),
('86666666-1000-4000-8000-000000000003','host-guest@example.invalid','host-continuity-guest','user',true,'Nasarawa','Lafia');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
('host-continuity-owner','property_partner','global','active'),
('host-continuity-manager','property_partner','global','active');
insert into public.listings(
  id,listing_id,title,sub_type,state,city,status,availability_status,approved_at,
  management_mode,wehouse_management_status,management_host_user_id
) values(
  '86666666-2000-4000-8000-000000000001','host-continuity-home','Host continuity home',
  'short_let','Nasarawa','Lafia','available','available',now(),
  'host','not_required','host-continuity-manager'
);
insert into public.property_host_assignments(
  assignment_id,listing_id,user_id,assignment_role,status,invited_by,accepted_at
) values
('86666666-3000-4000-8000-000000000001','86666666-2000-4000-8000-000000000001','host-continuity-owner','owner','active','host-continuity-owner',now()),
('86666666-3000-4000-8000-000000000002','86666666-2000-4000-8000-000000000001','host-continuity-manager','manager','active','host-continuity-owner',now());
insert into public.reservations(
  id,listing_id,user_id,status,stay_type,management_mode_snapshot,responsible_host_user_id
) values(
  'host-continuity-booking','86666666-2000-4000-8000-000000000001',
  'host-continuity-guest','reserved','short_let','host','host-continuity-manager'
);
insert into public.property_host_conversations(
  conversation_id,reservation_id,guest_user_id,host_user_id,status
) values(
  '86666666-4000-4000-8000-000000000001','host-continuity-booking',
  'host-continuity-guest','host-continuity-manager','open'
);
set local session_replication_role=origin;

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','86666666-1000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare removed boolean;
begin
  removed:=public.revoke_property_host_manager('86666666-3000-4000-8000-000000000002');
  if not removed then raise exception 'Manager removal returned false'; end if;
  if not exists(
    select 1 from public.property_host_assignments
    where assignment_id='86666666-3000-4000-8000-000000000002' and status='revoked'
  ) then raise exception 'Manager assignment was not revoked'; end if;
  if not exists(
    select 1 from public.reservations
    where id='host-continuity-booking'
      and responsible_host_user_id='host-continuity-owner'
      and management_mode_snapshot='host'
  ) then raise exception 'Active Host booking was stranded on removed manager'; end if;
  if not exists(
    select 1 from public.property_host_conversations
    where conversation_id='86666666-4000-4000-8000-000000000001'
      and host_user_id='host-continuity-owner'
  ) then raise exception 'Host conversation was stranded on removed manager'; end if;
  if not exists(
    select 1 from public.listings
    where id='86666666-2000-4000-8000-000000000001'
      and management_host_user_id='host-continuity-owner'
  ) then raise exception 'Future Host responsibility did not return to owner'; end if;
  if not public.current_actor_can_host_reservation('host-continuity-booking') then
    raise exception 'Owner did not inherit Host booking authority';
  end if;
  if not public.property_host_conversation_access('86666666-4000-4000-8000-000000000001') then
    raise exception 'Owner did not inherit Host conversation access';
  end if;
  if not exists(
    select 1 from public.admin_audit_log
    where action='property_host_manager_revoked'
      and target_id='86666666-2000-4000-8000-000000000001'
  ) then raise exception 'Manager removal transfer was not audited'; end if;
end $$;
reset role;
rollback;
