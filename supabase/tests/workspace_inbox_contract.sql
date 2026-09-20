\set ON_ERROR_STOP on
begin;
do $$ begin
  if has_schema_privilege('anon','wehouse_maintenance','USAGE')
    or has_schema_privilege('authenticated','wehouse_maintenance','USAGE')
    or has_schema_privilege('service_role','wehouse_maintenance','USAGE')
    or has_table_privilege('authenticated','wehouse_maintenance.test_record_resets','SELECT') then
    raise exception 'Maintenance archive exposed to application roles';
  end if;
end $$;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('99999999-1111-4111-8111-000000000001','inbox-a@example.invalid','inbox-a','worker',true),
('99999999-1111-4111-8111-000000000002','inbox-b@example.invalid','inbox-b','worker',true),
('99999999-1111-4111-8111-000000000003','inbox-c@example.invalid','inbox-c','user',true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
('inbox-a','worker','global','active'),('inbox-a','property_partner','global','active'),('inbox-b','worker','global','active');
insert into public.worker_bookings(id,user_id,worker_id,service_type) values
('99999999-2222-4222-8222-000000000001','inbox-a','inbox-b','Customer purchase'),
('99999999-2222-4222-8222-000000000002','inbox-c','inbox-a','Provider job');
insert into public.booking_conversations(id,booking_id,user_id,worker_id) values
('99999999-3333-4333-8333-000000000001','99999999-2222-4222-8222-000000000001','inbox-a','inbox-b'),
('99999999-3333-4333-8333-000000000002','99999999-2222-4222-8222-000000000002','inbox-c','inbox-a');
insert into public.partner_support_conversations(id,partner_id,subject,requester_role,context_id) values
('99999999-4444-4444-8444-000000000001','inbox-a','Personal request','user','personal-contract'),
('99999999-4444-4444-8444-000000000002','inbox-a','Work request','worker','work-contract'),
('99999999-4444-4444-8444-000000000003','inbox-c','Other person request','user','other-contract');
insert into public.partner_support_messages(conversation_id,sender_id,content) values
('99999999-4444-4444-8444-000000000001','inbox-a','Personal message'),
('99999999-4444-4444-8444-000000000002','inbox-a','Work message'),
('99999999-4444-4444-8444-000000000003','inbox-c','Other person message');
insert into public.notifications(recipient_id,type,title,message,workspace_scope) values
('inbox-a','service_request_received','Work update','Work only','worker'),
('inbox-c','roommate_match','Private update','Another person','personal');
insert into public.hotels(hotel_id,name,state,city,address,owner_id) values(-9999,'Inbox Contract Hotel','Nasarawa','Lafia','Contract address','inbox-a');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values(-9999,-9999,'Deluxe',1000,2);
insert into public.hotel_team_members(hotel_id,member_user_id,hotel_role,capabilities,invited_by) values(-9999,'inbox-b','front_desk',array['stay.read'],'inbox-a');
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status) values
(-99991,-9999,-9999,'inbox-a','2026-09-24','2026-09-25',1,1000,'confirmed'),
(-99992,-9999,-9999,'inbox-c','2026-09-24','2026-09-25',1,1000,'confirmed');
insert into public.hotel_booking_conversations(id,booking_id,hotel_id,guest_user_id) values
('99999999-5555-4555-8555-000000000001',-99991,-9999,'inbox-a'),
('99999999-5555-4555-8555-000000000002',-99992,-9999,'inbox-c');
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare rows jsonb; draft uuid; sent jsonb;
begin
  if has_function_privilege('anon','public.get_my_workspace_inbox(text,text)','EXECUTE') then raise exception 'Anonymous inbox access'; end if;
  perform set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000001',true);
  rows:=public.get_my_workspace_help_targets('personal');
  if jsonb_array_length(rows->'worker_jobs')<>1 or rows->'worker_jobs'->0->>'label'<>'Customer purchase'
    or rows ? 'properties' or rows ? 'worker_profile' or rows ? 'withdrawals' then
    raise exception 'Personal Help mixes professional records'; end if;
  rows:=public.get_my_workspace_help_targets('worker');
  if jsonb_array_length(rows->'worker_jobs')<>1 or rows->'worker_jobs'->0->>'label'<>'Provider job'
    or rows ? 'hotel_bookings' or rows->'worker_profile' is null then
    raise exception 'Worker Help mixes customer records'; end if;
  rows:=public.get_my_workspace_help_targets('property_partner');
  if jsonb_array_length(rows->'hotels')<>1 or rows ? 'worker_jobs' or rows ? 'hotel_bookings' then
    raise exception 'Partner Help is disconnected or includes personal records'; end if;
  perform set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000002',true);
  rows:=public.get_my_workspace_help_targets('hotel');
  if jsonb_array_length(rows->'hotels')<>1 or rows ? 'worker_jobs' or rows ? 'withdrawals' then
    raise exception 'Hotel Team Help includes unrelated records'; end if;
  perform set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000003',true);
  begin perform public.get_my_workspace_help_targets('property_partner'); raise exception 'Unassigned partner Help access';
  exception when raise_exception then if sqlerrm<>'Workspace access required' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000001',true);
  rows:=public.get_my_workspace_inbox('personal','service');
  if jsonb_array_length(rows)<>1 or rows->0->>'service_type'<>'Customer purchase' then raise exception 'Personal Inbox contains provider work'; end if;
  rows:=public.get_my_workspace_inbox('worker','service');
  if jsonb_array_length(rows)<>1 or rows->0->>'service_type'<>'Provider job' then raise exception 'Worker Inbox contains personal purchases'; end if;
  rows:=public.get_my_workspace_inbox('personal','hotel');
  if jsonb_array_length(rows)<>1 or rows->0->>'booking_id'<>'-99991' then raise exception 'Guest Inbox contains hotel operations'; end if;
  rows:=public.get_my_workspace_inbox('property_partner','hotel');
  if jsonb_array_length(rows)<>1 or rows->0->>'booking_id'<>'-99992' then raise exception 'Hotel operations contains personal stay'; end if;
  rows:=public.get_my_workspace_inbox('personal','wehouse');
  if jsonb_array_length(rows)<>1 or rows->0->>'subject'<>'Personal request' then raise exception 'Personal help scope incorrect'; end if;
  rows:=public.get_my_workspace_inbox('worker','wehouse');
  if jsonb_array_length(rows)<>1 or rows->0->>'subject'<>'Work request' then raise exception 'Work help scope incorrect'; end if;
  draft:=public.create_my_support_message_draft();
  sent:=public.send_my_first_wehouse_message(draft,'Personal account help','general','general','workspace:personal','{"requester_workspace":"personal"}'::jsonb,'normal','Personal first message');
  rows:=public.get_my_workspace_inbox('personal','wehouse');
  if not rows @> jsonb_build_array(jsonb_build_object('conversation_id',sent->>'conversation_id')) then raise exception 'New personal help was routed to legacy worker role'; end if;
  if public.get_my_workspace_inbox('worker','wehouse') @> jsonb_build_array(jsonb_build_object('conversation_id',sent->>'conversation_id')) then raise exception 'New personal help leaked into work'; end if;
  draft:=public.create_my_support_message_draft();
  sent:=public.send_my_first_wehouse_message(draft,'Worker account help','general','general','workspace:worker','{"requester_workspace":"worker"}'::jsonb,'normal','Worker first message');
  if not public.get_my_workspace_inbox('worker','wehouse') @> jsonb_build_array(jsonb_build_object('conversation_id',sent->>'conversation_id')) then raise exception 'New worker help lost workspace'; end if;
  if exists(select 1 from public.notifications where recipient_id='inbox-c') then raise exception 'Another person activity is visible'; end if;
  if exists(select 1 from public.notifications where recipient_id='inbox-a' and workspace_scope in ('personal','account')) then raise exception 'Work event incorrectly placed in Personal'; end if;
  perform set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000003',true);
  begin
    perform public.get_my_workspace_inbox('worker','service');
    raise exception 'Missing workspace grant was accepted';
  exception when raise_exception then
    if sqlerrm<>'Workspace access required' then raise; end if;
  end;
end;
$$;
reset role;
update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id='inbox-a' and workspace_role='worker';
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub','99999999-1111-4111-8111-000000000001',true);
  begin
    perform public.get_my_workspace_inbox('worker','service');
    raise exception 'Revoked worker retained workspace access';
  exception when raise_exception then
    if sqlerrm<>'Workspace access required' then raise; end if;
  end;
  if jsonb_array_length(public.get_my_workspace_inbox('personal','service'))<>1 then raise exception 'Revocation lost personal purchase'; end if;
  begin perform public.get_my_workspace_help_targets('worker'); raise exception 'Revoked worker retained Help access';
  exception when raise_exception then if sqlerrm<>'Workspace access required' then raise; end if; end;
  if jsonb_array_length(public.get_my_workspace_help_targets('personal')->'worker_jobs')<>1 then raise exception 'Help revocation lost personal purchase'; end if;
end; $$;
rollback;
