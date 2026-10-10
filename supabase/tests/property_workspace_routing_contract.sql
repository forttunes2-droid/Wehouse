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
insert into public.creator_policy_versions(
  policy_key,scope_type,scope_key,version,value,status,effective_from,
  legal_review_state,reason,checksum,published_at
)
select 'short_let_cancellation','global','*',
  coalesce((select max(version)+1 from public.creator_policy_versions where policy_key='short_let_cancellation' and scope_type='global' and scope_key='*'),1),
  '{"standard":{"free_cancellation_hours":24},"fixture":true}'::jsonb,
  'active',now()-interval '1 minute','reviewed','Rollback-only Host continuity fixture',
  'host-continuity-short-let-cancellation',now()
where not exists (
  select 1 from public.creator_policy_versions
  where policy_key='short_let_cancellation' and scope_type='global' and scope_key='*'
    and status='active' and effective_from<=now()
    and (effective_until is null or effective_until>now())
);
insert into public.creator_policy_versions(
  policy_key,scope_type,scope_key,version,value,status,effective_from,
  legal_review_state,reason,checksum,published_at
)
select 'accommodation_non_refundable_rate','global','*',
  coalesce((select max(version)+1 from public.creator_policy_versions where policy_key='accommodation_non_refundable_rate' and scope_type='global' and scope_key='*'),1),
  '{"discount_percent":10,"minimum_discount_percent":1,"maximum_discount_percent":30,"fixture":true}'::jsonb,
  'active',now()-interval '1 minute','reviewed','Rollback-only Host continuity fixture',
  'host-continuity-nonrefundable-rate',now()
where not exists (
  select 1 from public.creator_policy_versions
  where policy_key='accommodation_non_refundable_rate' and scope_type='global' and scope_key='*'
    and status='active' and effective_from<=now()
    and (effective_until is null or effective_until>now())
);

insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city) values
('86666666-1000-4000-8000-000000000001','host-owner@example.invalid','host-continuity-owner','property_partner',true,'Nasarawa','Lafia'),
('86666666-1000-4000-8000-000000000002','host-manager@example.invalid','host-continuity-manager','user',true,'Nasarawa','Lafia'),
('86666666-1000-4000-8000-000000000003','host-guest@example.invalid','host-continuity-guest','user',true,'Nasarawa','Lafia');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
('host-continuity-owner','property_partner','global','active');
insert into public.listings(
  id,listing_id,title,price,sub_type,state,city,status,availability_status,approved_at,
  management_mode,wehouse_management_status,management_host_user_id,management_updated_at
) values(
  '86666666-2000-4000-8000-000000000001','host-continuity-home','Host continuity home',35000,
  'short_let','Nasarawa','Lafia','available','available',now(),
  'host','not_required','host-continuity-manager',now()
);
insert into public.property_host_assignments(
  assignment_id,listing_id,user_id,assignment_role,status,invited_by,accepted_at
) values
('86666666-3000-4000-8000-000000000001','86666666-2000-4000-8000-000000000001','host-continuity-owner','owner','active','host-continuity-owner',now()),
('86666666-3000-4000-8000-000000000002','86666666-2000-4000-8000-000000000001','host-continuity-manager','manager','active','host-continuity-owner',now());
insert into public.reservations(
  id,listing_id,user_id,status,stay_type,management_mode_snapshot,responsible_host_user_id,
  stay_check_in,stay_check_out,stay_nights,short_stay_rate_type,nightly_rate_snapshot,
  stay_rent_total,short_stay_discount_percent_snapshot,short_stay_cancellation_policy_snapshot,
  short_stay_cancellation_policy_version_id,short_stay_rate_terms_policy_version_id
) values(
  'host-continuity-booking','86666666-2000-4000-8000-000000000001',
  'host-continuity-guest','reserved','short_let','host','host-continuity-manager',
  current_date+2,current_date+3,1,'standard',20000,20000,0,
  '{"rate_type":"standard","fixture":true}'::jsonb,
  (select policy_version_id from public.creator_policy_versions where policy_key='short_let_cancellation' and scope_type='global' and scope_key='*' and status='active' order by effective_from desc,version desc limit 1),
  (select policy_version_id from public.creator_policy_versions where policy_key='accommodation_non_refundable_rate' and scope_type='global' and scope_key='*' and status='active' order by effective_from desc,version desc limit 1)
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
do $guard$
declare blocked boolean:=false;
begin
  -- Re-selecting the current operator is idempotent, but changing the operator
  -- on a live home must require a separately reviewed handoff.
  perform public.set_my_property_management_mode(
    '86666666-2000-4000-8000-000000000001','host'
  );
  begin
    perform public.set_my_property_management_mode(
      '86666666-2000-4000-8000-000000000001','wehouse'
    );
  exception when others then
    if sqlerrm like 'This live home has an operator. Ask WeHouse to review a handoff%' then
      blocked:=true;
    else
      raise;
    end if;
  end;
  if not blocked then
    raise exception 'Published home operator changed without reviewed handoff';
  end if;
end $guard$;
do $handover$
declare removed boolean;
begin
  removed:=public.revoke_property_host_manager('86666666-3000-4000-8000-000000000002');
  if not removed then raise exception 'Manager removal returned false'; end if;
  if not public.current_actor_can_host_reservation('host-continuity-booking') then
    raise exception 'Owner did not inherit Host booking authority';
  end if;
  if not public.property_host_conversation_access('86666666-4000-4000-8000-000000000001') then
    raise exception 'Owner did not inherit Host conversation access';
  end if;
  if not exists(
    select 1 from public.property_host_assignments
    where assignment_id='86666666-3000-4000-8000-000000000002' and status='revoked'
  ) then raise exception 'Manager assignment was not revoked'; end if;
end $handover$;
reset role;
-- RPC-only conversations and booking/audit internals are checked as the fixture
-- administrator; their browser table privileges must stay closed.
do $$ begin
  if not exists(
    select 1 from public.reservations
    where id='host-continuity-booking'
      and responsible_host_user_id='host-continuity-owner'
      and management_mode_snapshot='host'
      and short_stay_rate_type='standard'
      and nightly_rate_snapshot=20000
      and stay_rent_total=20000
  ) then raise exception 'Manager handover changed the booked Short Let rate snapshot'; end if;
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
  if not exists(
    select 1 from public.admin_audit_log
    where action='property_host_manager_revoked'
      and target_id='86666666-2000-4000-8000-000000000001'
  ) then raise exception 'Manager removal transfer was not audited'; end if;
end $$;
select set_config('request.jwt.claim.sub','86666666-1000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.property_host_assignments where listing_id='86666666-2000-4000-8000-000000000001')<>1 then
    raise exception 'Manager can read another person assignment';
  end if;
  if public.current_actor_can_host_reservation('host-continuity-booking')
     or public.property_host_conversation_access('86666666-4000-4000-8000-000000000001') then
    raise exception 'Removed manager kept booking or conversation access';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','86666666-1000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.property_host_assignments where listing_id='86666666-2000-4000-8000-000000000001') then
    raise exception 'Guest can read Host assignments';
  end if;
end $$;
reset role;
do $$ begin
  begin
    update public.reservations
    set short_stay_rate_type='non_refundable'
    where id='host-continuity-booking';
    raise exception 'Booked Short Let rate change was accepted';
  exception when others then
    if sqlerrm='Booked Short Let rate change was accepted' then raise; end if;
    if sqlerrm not like 'The booked Short Let rate cannot be changed' then raise; end if;
  end;
end $$;
rollback;


-- Invitation outcomes must land in the inviter's owning workspace and in the
-- canonical Activity feed exactly once. Test all three legacy response forms.
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city)
values ('86666666-9000-4000-8000-000000000001','invitation-route-owner@example.invalid',
        'invitation-route-owner','user',true,'Nasarawa','Lafia');
set local session_replication_role=origin;

insert into public.notifications(
  recipient_id,type,title,message,related_id,source_type,source_id,
  destination_route,destination_params,event_key,workspace_scope
) values
('invitation-route-owner','hotel_team_invitation_response','Hotel invitation accepted',
 'A team member accepted the hotel invitation.','fixture-team-invite-1',
 'hotel_team_member','fixture-team-invite-1','property-owner',
 '{"hotel_id":-8671}'::jsonb,'fixture:invitation:hotel-team:1','property_partner'),
('invitation-route-owner','resource_invitation_response','Hotel resource invitation accepted',
 'The hotel resource invitation was accepted.','fixture-resource-invite-1',
 'resource_invitation','fixture-resource-invite-1','activity',
 '{"resource_type":"hotel","hotel_id":-8671}'::jsonb,
 'fixture:invitation:resource-hotel:1','personal'),
('invitation-route-owner','resource_invitation_response','Property resource invitation accepted',
 'The property resource invitation was accepted.','fixture-resource-invite-2',
 'resource_invitation','fixture-resource-invite-2','activity',
 '{"resource_type":"property","listing_id":"fixture-property"}'::jsonb,
 'fixture:invitation:resource-property:2','personal');

do $invitation_activity$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from public.notifications n
  where n.recipient_id='invitation-route-owner'
    and n.event_key in (
      'fixture:invitation:hotel-team:1',
      'fixture:invitation:resource-hotel:1',
      'fixture:invitation:resource-property:2'
    )
    and n.workspace_scope is distinct from case
      when n.type='hotel_team_invitation_response' then 'hotel'
      when n.type='resource_invitation_response'
        and n.destination_params->>'resource_type'='hotel' then 'hotel'
      when n.type='resource_invitation_response'
        and n.destination_params->>'resource_type'='property' then 'property_partner'
      else n.workspace_scope
    end;
  if v_bad<>0 then
    raise exception 'Invitation response notification routed to the wrong workspace';
  end if;

  select count(*) into v_bad
  from public.notifications n
  where n.recipient_id='invitation-route-owner'
    and n.event_key in (
      'fixture:invitation:hotel-team:1',
      'fixture:invitation:resource-hotel:1',
      'fixture:invitation:resource-property:2'
    )
    and not exists (
      select 1
      from public.activity_events e
      join public.activity_event_audiences a using(activity_event_id)
      where e.event_key='notification:'||n.id
        and a.recipient_user_id=n.recipient_id
        and a.workspace=n.workspace_scope
    );
  if v_bad<>0 then
    raise exception 'Invitation response missing canonical Activity audience';
  end if;

  if exists (
    select 1
    from public.notifications n
    join public.activity_events e on e.event_key='notification:'||n.id
    join public.activity_event_audiences a using(activity_event_id)
    where n.recipient_id='invitation-route-owner'
      and n.event_key in (
        'fixture:invitation:hotel-team:1',
        'fixture:invitation:resource-hotel:1',
        'fixture:invitation:resource-property:2'
      )
      and a.workspace is distinct from n.workspace_scope
  ) then
    raise exception 'Invitation response left a duplicate audience in the wrong workspace';
  end if;
end
$invitation_activity$;
rollback;


-- Exercise the real invitation response RPCs as authenticated users. The current
-- hotel-team RPC delegates to a linked resource invitation; its response must
-- still appear in the inviter's Hotel workspace. Property responses belong in
-- Property Partner Activity. All fixture writes roll back.
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city)
values
('86666666-9900-4000-8000-000000000011','invite-rpc-owner@example.invalid',
 'invite-rpc-owner-20261010','user',true,'Nasarawa','Lafia'),
('86666666-9900-4000-8000-000000000012','invite-rpc-acceptor@example.invalid',
 'invite-rpc-acceptor-20261010','user',true,'Nasarawa','Lafia');
insert into public.hotels(hotel_id,name,state,city,owner_id,status)
values(-8699,'Invitation RPC Fixture Hotel','Nasarawa','Lafia',
       'invite-rpc-owner-20261010','active');
insert into public.hotel_team_members(
  id,hotel_id,member_user_id,hotel_role,status,capabilities,invited_by
) values(
  '86666666-9900-4000-8000-000000000103',-8699,
  'invite-rpc-acceptor-20261010','front_desk','invited',
  array['stay.read'],'invite-rpc-owner-20261010'
);
insert into public.resource_invitations(
  invitation_id,resource_type,resource_id,role_key,permission_profile,delivery,
  inviter_user_id,intended_user_id,subject_assignment_id,status,expires_at
) values
(
  '86666666-9900-4000-8000-000000000101','hotel','-8699',
  'hotel_front_desk','front_desk','direct',
  'invite-rpc-owner-20261010','invite-rpc-acceptor-20261010',
  '86666666-9900-4000-8000-000000000103','pending',now()+interval '1 day'
),
(
  '86666666-9900-4000-8000-000000000102','property',
  '86666666-9900-4000-8000-000000000104',
  'property_cohost','manager','direct',
  'invite-rpc-owner-20261010','invite-rpc-acceptor-20261010',
  null,'pending',now()+interval '1 day'
);
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','86666666-9900-4000-8000-000000000012',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $invitation_rpc_journey$
declare v_hotel jsonb; v_property jsonb;
begin
  v_hotel:=public.respond_to_hotel_team_invitation(
    '86666666-9900-4000-8000-000000000103',true
  );
  v_property:=public.respond_to_resource_invitation(
    '86666666-9900-4000-8000-000000000102',false,null
  );
  if v_hotel->>'accepted'<>'true' or v_property->>'accepted'<>'false' then
    raise exception 'Invitation response RPC returned an unexpected result';
  end if;
end
$invitation_rpc_journey$;
reset role;
do $invitation_rpc_activity$
declare bad integer;
begin
  if not exists(
    select 1 from public.notifications
    where recipient_id='invite-rpc-owner-20261010'
      and type='resource_invitation_response'
      and related_id='86666666-9900-4000-8000-000000000101'
      and workspace_scope='hotel'
  ) then raise exception 'Hotel team acceptance did not route into Hotel Activity'; end if;
  if not exists(
    select 1 from public.notifications
    where recipient_id='invite-rpc-owner-20261010'
      and type='resource_invitation_response'
      and related_id='86666666-9900-4000-8000-000000000102'
      and workspace_scope='property_partner'
  ) then raise exception 'Property resource decline did not route into Property Partner Activity'; end if;
  select count(*) into bad
  from public.notifications n
  where n.recipient_id='invite-rpc-owner-20261010'
    and n.related_id in (
      '86666666-9900-4000-8000-000000000101',
      '86666666-9900-4000-8000-000000000102'
    )
    and not exists(
      select 1 from public.activity_events e
      join public.activity_event_audiences a using(activity_event_id)
      where e.event_key='notification:'||n.id
        and a.recipient_user_id=n.recipient_id
        and a.workspace=n.workspace_scope
    );
  if bad<>0 then raise exception 'Invitation RPC response missing canonical Activity audience: %',bad; end if;
  if exists(
    select 1 from public.notifications n
    join public.activity_events e on e.event_key='notification:'||n.id
    join public.activity_event_audiences a using(activity_event_id)
    where n.recipient_id='invite-rpc-owner-20261010'
      and n.related_id in (
        '86666666-9900-4000-8000-000000000101',
        '86666666-9900-4000-8000-000000000102'
      )
      and a.workspace is distinct from n.workspace_scope
  ) then raise exception 'Invitation RPC left a duplicate audience in the wrong workspace'; end if;
end
$invitation_rpc_activity$;
rollback;
