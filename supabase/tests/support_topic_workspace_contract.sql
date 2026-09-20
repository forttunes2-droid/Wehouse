\set ON_ERROR_STOP on
begin;
-- Disposable fixtures only: this whole journey rolls back, including messages.
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('88888888-1111-4111-8111-000000000001','topic-owner@example.invalid','topic-owner','property_partner',true),
('88888888-1111-4111-8111-000000000002','topic-dual@example.invalid','topic-dual','worker',true),
('88888888-1111-4111-8111-000000000003','topic-user@example.invalid','topic-user','user',true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
('topic-owner','property_partner','global','active'),
('topic-dual','worker','global','active'),('topic-dual','property_partner','global','active');
insert into public.hotels(hotel_id,name,state,city,address,owner_id,status,approved_at) values
(-88881,'Topic Hotel One','Nasarawa','Lafia','One address','topic-owner','active',now()),
(-88882,'Topic Hotel Two','Nasarawa','Lafia','Two address','topic-owner','active',now()),
(-88883,'Unpublished Hotel','Nasarawa','Lafia','Private address','topic-owner','draft',null);
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values
(-88881,-88881,'Deluxe',1000,2);
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status) values
(-88881,-88881,-88881,'topic-owner','2026-09-24','2026-09-25',1,1000,'confirmed');
insert into public.listings(listing_id,title,owner_id,state,city,status,approved_at) values
('topic-listing','Topic Property','topic-owner','Nasarawa','Lafia','available',now());
insert into public.worker_bookings(id,user_id,worker_id,service_type) values
('88888888-2222-4222-8222-000000000001','topic-dual','topic-owner','Customer purchase'),
('88888888-2222-4222-8222-000000000002','topic-user','topic-dual','Provider job');
-- Legacy operational cases store source_type rather than subject_type. A
-- misleading client workspace must not reclassify the actual booking party.
insert into public.partner_support_conversations(id,partner_id,subject,requester_role,context_type,context_id,context_snapshot) values
('88888888-4444-4444-8444-000000000001','topic-dual','Customer service issue','worker','operational_case','88888888-2222-4222-8222-000000000001','{"source_type":"worker_job","source_id":"88888888-2222-4222-8222-000000000001","requester_workspace":"worker"}'),
('88888888-4444-4444-8444-000000000002','topic-dual','Provider service issue','worker','operational_case','88888888-2222-4222-8222-000000000002','{"source_type":"worker_job","source_id":"88888888-2222-4222-8222-000000000002","requester_workspace":"personal"}'),
('88888888-4444-4444-8444-000000000003','topic-dual','Legacy hotel enquiry','worker','hotel_operations','-88881','{}');
insert into public.partner_support_messages(conversation_id,sender_id,content)
select id,partner_id,'Existing topic message' from public.partner_support_conversations where partner_id='topic-dual';
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare draft uuid; first jsonb; second jsonb; replay jsonb; listing_message jsonb; rows jsonb;
begin
  perform set_config('request.jwt.claim.sub','88888888-1111-4111-8111-000000000003',true);
  draft:=public.create_my_support_message_draft();
  first:=public.send_my_first_wehouse_message(draft,'Hotel One enquiry','general','hotel_property','-88881','{"requester_workspace":"personal","hotel_name":"Topic Hotel One"}','normal','Question about Hotel One');
  if first->>'conversation_id' is null or first->>'message_id' is null then raise exception 'Hotel first send returned no receipt'; end if;
  replay:=public.send_my_first_wehouse_message(draft,'Hotel One enquiry','general','hotel_property','-88881','{"requester_workspace":"personal"}','normal','Question about Hotel One');
  if replay->>'message_id'<>first->>'message_id' or replay->>'replayed'<>'true' then raise exception 'Hotel first send duplicated a retry'; end if;
  draft:=public.create_my_support_message_draft();
  second:=public.send_my_first_wehouse_message(draft,'Hotel Two enquiry','general','hotel_property','-88882','{"requester_workspace":"personal","hotel_name":"Topic Hotel Two"}','normal','Question about Hotel Two');
  if first->>'conversation_id'=second->>'conversation_id' then raise exception 'Different hotels reused the wrong conversation'; end if;
  draft:=public.create_my_support_message_draft();
  listing_message:=public.send_my_first_wehouse_message(draft,'Property enquiry','general','property_listing','topic-listing','{"requester_workspace":"personal"}','normal','Question about this property');
  rows:=public.get_my_workspace_inbox('personal','wehouse');
  if jsonb_array_length(rows)<>3
    or not rows @> jsonb_build_array(jsonb_build_object('conversation_id',first->>'conversation_id','context_id','-88881'))
    or not rows @> jsonb_build_array(jsonb_build_object('conversation_id',second->>'conversation_id','context_id','-88882'))
    or not rows @> jsonb_build_array(jsonb_build_object('conversation_id',listing_message->>'conversation_id','context_id','topic-listing')) then
    raise exception 'Customer enquiry missing, wrong topic attached, or another user visible';
  end if;
  begin
    perform public.get_my_workspace_inbox('property_partner','wehouse');
    raise exception 'Customer acquired Property Partner access';
  exception when raise_exception then
    if sqlerrm<>'Workspace access required' then raise; end if;
  end;
  draft:=public.create_my_support_message_draft();
  begin
    perform public.send_my_first_wehouse_message(draft,'Hidden hotel','general','hotel_property','-88883','{"requester_workspace":"personal"}','normal','Should be rejected');
    raise exception 'Unpublished property ownership check was bypassed';
  exception when raise_exception then
    if sqlerrm<>'This property is not available to this account' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub','88888888-1111-4111-8111-000000000002',true);
  rows:=public.get_my_workspace_inbox('personal','wehouse');
  if jsonb_array_length(rows)<>2 or not rows @> '[{"subject":"Legacy hotel enquiry"},{"subject":"Customer service issue"}]'::jsonb then raise exception 'Legacy role hid a personal enquiry or purchase'; end if;
  rows:=public.get_my_workspace_inbox('worker','wehouse');
  if jsonb_array_length(rows)<>1 or rows->0->>'subject'<>'Provider service issue' then raise exception 'Worker issue has the wrong workspace'; end if;
  draft:=public.create_my_support_message_draft();
  first:=public.send_my_first_wehouse_message(draft,'Dual-role personal enquiry','general','hotel_property','-88882','{"requester_workspace":"personal"}','normal','Customer enquiry from someone who also works');
  if not public.get_my_workspace_inbox('personal','wehouse') @> jsonb_build_array(jsonb_build_object('conversation_id',first->>'conversation_id')) then raise exception 'Explicit Personal enquiry followed legacy Worker role'; end if;
  if jsonb_array_length(public.get_my_workspace_inbox('property_partner','wehouse'))<>0 then raise exception 'Personal enquiry leaked into Property Partner'; end if;

  perform set_config('request.jwt.claim.sub','88888888-1111-4111-8111-000000000001',true);
  draft:=public.create_my_support_message_draft();
  first:=public.send_my_first_wehouse_message(draft,'Owner hotel work','general','hotel_property','-88881','{"requester_workspace":"property_partner"}','normal','Operations question');
  rows:=public.get_my_workspace_inbox('property_partner','wehouse');
  if jsonb_array_length(rows)<>1 or rows->0->>'conversation_id'<>first->>'conversation_id' then raise exception 'Property owner work missing or customer messages visible'; end if;
  if jsonb_array_length(public.get_my_workspace_inbox('personal','wehouse'))<>0 then raise exception 'Owner work appeared as personal enquiry'; end if;
  draft:=public.create_my_support_message_draft();
  second:=public.send_my_first_wehouse_message(draft,'Owner as customer','general','hotel_property','-88881','{"requester_workspace":"personal"}','normal','Personal enquiry about the same hotel');
  if second->>'conversation_id'=first->>'conversation_id' then raise exception 'Personal enquiry reused the property work conversation'; end if;
  if not public.get_my_workspace_inbox('property_partner','wehouse') @> jsonb_build_array(jsonb_build_object('conversation_id',first->>'conversation_id')) then raise exception 'Personal enquiry moved existing work messages'; end if;
  draft:=public.create_my_support_message_draft();
  replay:=public.send_my_first_wehouse_message(draft,'Owner as customer','general','hotel_property','-88881','{"requester_workspace":"personal"}','normal','Another question in the same topic');
  if replay->>'conversation_id'<>second->>'conversation_id' then raise exception 'Same-workspace follow-up created a duplicate topic'; end if;
  draft:=public.create_my_support_message_draft();
  listing_message:=public.send_my_first_wehouse_message(draft,'Personal hotel booking','general','hotel_booking','-88881','{"requester_workspace":"personal"}','normal','Question about my confirmed stay');
  if listing_message->>'conversation_id'<>second->>'conversation_id' then raise exception 'Booking did not retain its personal enquiry'; end if;
  rows:=public.get_my_workspace_inbox('property_partner','wehouse');
  if jsonb_array_length(rows)<>1 or rows->0->>'conversation_id'<>first->>'conversation_id' or rows->0->>'context_type'<>'hotel_operations' then raise exception 'Personal reservation took over the owner work thread'; end if;
end; $$;
reset role;
do $$ begin
  perform set_config('request.jwt.claim.sub','88888888-1111-4111-8111-000000000001',true);
  begin
    update public.partner_support_conversations set context_id='-88882'
    where partner_id='topic-owner' and context_type='hotel_operations';
    raise exception 'Work topic was reassigned to another property';
  exception when raise_exception then
    if sqlerrm<>'Conversation ownership cannot be reassigned' then raise; end if;
  end;
  begin
    update public.partner_support_conversations set partner_id='topic-user'
    where partner_id='topic-owner' and context_type='hotel_booking';
    raise exception 'Booking conversation was reassigned to another person';
  exception when raise_exception then
    if sqlerrm<>'Conversation ownership cannot be reassigned' then raise; end if;
  end;
end; $$;
update public.workspace_role_assignments set status='revoked',revoked_at=now() where user_id='topic-dual';
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub','88888888-1111-4111-8111-000000000002',true);
  if jsonb_array_length(public.get_my_workspace_inbox('personal','wehouse'))<>3 then raise exception 'Revocation lost personal enquiries'; end if;
  begin
    perform public.get_my_workspace_inbox('worker','wehouse');
    raise exception 'Revoked grant retained work messages';
  exception when raise_exception then
    if sqlerrm<>'Workspace access required' then raise; end if;
  end;
end; $$;
rollback;
