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

-- Media-only uploads, ciphertext Storage RLS, and preserved message history.
\set ON_ERROR_STOP on
begin;
-- Isolated fixtures exercise the real RPCs and guards; no production data is used.
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city,full_name) values
('88999999-0000-4000-8000-000000000001','media-owner@example.invalid','media-owner','property_partner',true,'Nasarawa','Lafia','Owner'),
('88999999-0000-4000-8000-000000000002','media-guest@example.invalid','media-guest','user',true,'Nasarawa','Lafia','Guest');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values ('media-owner','property_partner','global','active');
insert into public.hotels(hotel_id,name,state,city,owner_id,status) values (-8899,'Media Contract Hotel','Nasarawa','Lafia','media-owner','active');
insert into public.hotel_rooms(room_id,hotel_id,room_type,price_per_night,total_rooms) values (-8899,-8899,'Deluxe',20000,1);
insert into public.hotel_bookings(booking_id,hotel_id,room_id,user_id,check_in,check_out,total_nights,total_price,status,payment_status) values
(-8899,-8899,-8899,'media-guest',current_date+2,current_date+3,1,20000,'confirmed','paid');
insert into public.hotel_booking_conversations(id,booking_id,hotel_id,guest_user_id) values
('88999999-1000-4000-8000-000000000001',-8899,-8899,'media-guest');
insert into public.hotel_booking_messages(id,conversation_id,sender_id,content,attachments,attachment_types) values
('88999999-2000-4000-8000-000000000001','88999999-1000-4000-8000-000000000001','media-owner','Legacy note',array['legacy.pdf'],array['application/pdf']);
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','88999999-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
-- Create the support thread via its actual atomic first-send routine.
do $$ declare r jsonb; begin
 r:=public.send_my_first_wehouse_message(public.create_my_support_message_draft(),'Account help','general','general',null,'{}','normal','Need help','{}','{}');
 perform set_config('wh.media.support',(r->>'conversation_id'),true);
 perform set_config('wh.media.draft',public.create_my_support_message_draft()::text,true);
end $$;
insert into storage.objects(bucket_id,name,metadata)
select bucket, prefix||suffix, jsonb_build_object('mimetype',mime,'size',size)
from (values
 ('hotel-chat-files','88999999-1000-4000-8000-000000000001/media-guest/'),
 ('support-files',current_setting('wh.media.support')||'/')
) targets(bucket,prefix)
cross join (values ('valid.png','image/png',70),('clip.mp4','video/mp4',200),('voice.webm','audio/webm',100),
 ('document.pdf','application/pdf',200),('fake.png','application/pdf',200),('empty.png','image/png',0),('large.png','image/png',26214401)
) media(suffix,mime,size);
insert into storage.objects(bucket_id,name,metadata) values
('support-files','drafts/media-guest/'||current_setting('wh.media.draft')||'/photo.png','{"mimetype":"image/png","size":70}');
set local session_replication_role=replica;
insert into public.partner_support_messages(id,conversation_id,sender_id,content,attachments,attachment_types) values
('88999999-2000-4000-8000-000000000002',current_setting('wh.media.support')::uuid,'media-guest','Legacy document',array['legacy.pdf'],array['application/pdf']);
set local session_replication_role=origin;
set local role authenticated;
do $$ declare c uuid:='88999999-1000-4000-8000-000000000001'; p text:=c::text||'/media-guest/'; id uuid; f text; t text; begin
 -- Real supported photo/video and recorder-style audio paths remain usable.
 id:=public.send_hotel_booking_message(c,'Room photo',array[p||'valid.png'],array['image/png']);
 id:=public.send_hotel_booking_message(c,'Room video',array[p||'clip.mp4'],array['video/mp4']);
 id:=public.send_hotel_booking_message(c,'',array[p||'voice.webm'],array['audio/webm;codecs=opus']);
 foreach f in array array['document.pdf','fake.png','empty.png','large.png','missing.png'] loop
   t:=case when f='document.pdf' then 'application/pdf' else 'image/png' end;
   begin
     perform public.send_hotel_booking_message(c,'Cannot bypass media policy',array[p||f],array[t]);
     raise exception 'Forbidden hotel attachment accepted: %',f;
   exception when sqlstate '22023' then null; end;
 end loop;
 begin
   perform public.send_hotel_booking_message(c,'Wrong owner',array[c::text||'/media-owner/valid.png'],array['image/png']);
   raise exception 'Another hotel sender path accepted';
 exception when others then if sqlerrm='Another hotel sender path accepted' then raise; end if; end;
 -- Ordinary messages, quoting and opposite-party receipts still work with old rows.
 perform public.send_hotel_booking_message(c,'Reply to earlier note','{}','{}','88999999-2000-4000-8000-000000000001');
 perform public.mark_hotel_booking_messages_read(c);
end $$;
-- Support accepts photos/videos but NOT imported files OR voice notes.
do $$ declare c uuid:=current_setting('wh.media.support')::uuid; p text:=c::text||'/'; f text; t text; r jsonb; begin
 perform public.send_support_message(c,'Photo',array[p||'valid.png'],array['image/png']);
 perform public.send_support_message(c,'Video',array[p||'clip.mp4'],array['video/mp4']);
 foreach f in array array['document.pdf','voice.webm','fake.png','empty.png','large.png','missing.png'] loop
   t:=case when f='document.pdf' then 'application/pdf' when f='voice.webm' then 'audio/webm' else 'image/png' end;
   begin
     perform public.send_support_message(c,'Blocked',array[p||f],array[t]);
     raise exception 'Forbidden support attachment accepted: %',f;
   exception when sqlstate '22023' then null; end;
 end loop;
 begin
   perform public.send_support_message(c,'Wrong conversation',array['88999999-1000-4000-8000-000000000001/valid.png'],array['image/png']);
   raise exception 'Cross-conversation media accepted';
 exception when insufficient_privilege then null; end;
 r:=public.send_my_first_wehouse_message(current_setting('wh.media.draft')::uuid,'Account help','general','general',null,'{}','normal','Photo evidence',
  array['drafts/media-guest/'||current_setting('wh.media.draft')||'/photo.png'],array['image/png']);
 if r->>'message_id' is null then raise exception 'Photo draft first Send failed'; end if;
 -- Once consumed, the same temporary draft is not a way to smuggle media elsewhere.
 begin
   perform public.send_support_message(c,'Old draft',array['drafts/media-guest/'||current_setting('wh.media.draft')||'/photo.png'],array['image/png']);
   raise exception 'Consumed media draft accepted';
 exception when insufficient_privilege then null; end;
 perform public.send_support_message(c,'Ordinary follow-up remains available','{}','{}');
end $$;
reset role;
do $$ begin
 if not (select is_read from public.hotel_booking_messages where id='88999999-2000-4000-8000-000000000001') then raise exception 'Legacy row broke receipts'; end if;
 if not exists(select 1 from public.partner_support_messages where id='88999999-2000-4000-8000-000000000002' and attachments=array['legacy.pdf']) then raise exception 'History was deleted or rewritten'; end if;
 if exists(select 1 from storage.buckets where id in('support-files','hotel-chat-files','chat-files') and public) then raise exception 'Chat bucket is public'; end if;
 if not exists(select 1 from storage.buckets where id='chat-files' and allowed_mime_types=array['application/octet-stream'] and file_size_limit=26214416) then raise exception 'Encrypted media bucket lost ciphertext support'; end if;
 if exists(select 1 from storage.buckets b,unnest(b.allowed_mime_types) m where b.id in('support-files','hotel-chat-files') and m like 'application/%') then raise exception 'Plain chat bucket allows documents'; end if;
 if exists(select 1 from storage.buckets b,unnest(b.allowed_mime_types) m where b.id='support-files' and m like 'audio/%') then raise exception 'Support imported audio enabled'; end if;
 if has_function_privilege('anon','private.guard_chat_media_message()','execute') or has_function_privilege('authenticated','private.guard_chat_media_message()','execute') then raise exception 'Trigger routine exposed as callable API'; end if;
end $$;
-- Direct privileged inserts also cannot defeat the rule through a renamed PDF.
do $$ begin
 begin
  insert into public.hotel_booking_messages(conversation_id,sender_id,content,attachments,attachment_types) values
  ('88999999-1000-4000-8000-000000000001','media-guest','Bypass',array['88999999-1000-4000-8000-000000000001/media-guest/document.pdf'],array['image/png']);
  raise exception 'Renamed file reference accepted';
 exception when sqlstate '22023' then null; end;
end $$;
-- Exercise Storage RLS on the real encrypted upload path, including another
-- professional role as a personal participant. No admin/Creator bypass exists.
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('88999999-0000-4000-8000-000000000003','media-outsider@example.invalid','media-outsider','creator',true);
insert into public.conversations(id,participant_a,participant_b,status,conversation_type) values
('88999999-3000-4000-8000-000000000001','media-guest','media-owner','active','roommate');
insert into public.worker_bookings(id,user_id,worker_id,service_type,status) values
('88999999-4000-4000-8000-000000000001','media-guest','media-owner','Media test','pending');
insert into public.booking_conversations(id,booking_id,user_id,worker_id) values
('88999999-5000-4000-8000-000000000001','88999999-4000-4000-8000-000000000001','media-guest','media-owner');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','88999999-0000-4000-8000-000000000002',true);
set local role authenticated;
insert into storage.objects(bucket_id,name,owner,metadata) values
('chat-files','e2ee/roommate/88999999-3000-4000-8000-000000000001/room.bin','88999999-0000-4000-8000-000000000002','{"mimetype":"application/octet-stream","size":86}'),
('chat-files','e2ee/worker/88999999-5000-4000-8000-000000000001/voice.bin','88999999-0000-4000-8000-000000000002','{"mimetype":"application/octet-stream","size":200}');
do $$ declare p text; c uuid; k text; item jsonb; begin
 for k,c,p in select * from (values
  ('roommate','88999999-3000-4000-8000-000000000001'::uuid,'e2ee/roommate/88999999-3000-4000-8000-000000000001/room.bin'),
  ('worker','88999999-5000-4000-8000-000000000001'::uuid,'e2ee/worker/88999999-5000-4000-8000-000000000001/voice.bin')
 ) media(kind,conversation,path) loop
  item:=jsonb_build_object('path',p,'file_iv','AAAAAAAAAAAAAAAA','metadata_iv','AAAAAAAAAAAAAAAA','metadata_ciphertext','AAAAAAAAAAAAAAAAAAAAAAAA');
  perform public.send_private_encrypted_message(k,c,'ciphertext','iv',jsonb_build_array(item));
  begin
    perform public.send_private_encrypted_message(k,c,'ciphertext','iv',jsonb_build_array(item||jsonb_build_object('path','https://external.invalid/file.pdf')));
    raise exception 'External encrypted attachment path accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.send_private_encrypted_message(k,c,'ciphertext','iv',jsonb_build_array(item||jsonb_build_object('metadata_iv','not-an-iv')));
    raise exception 'Malformed encryption metadata accepted';
  exception when sqlstate '22023' then null; end;
 end loop;
end $$;
reset role;
select set_config('request.jwt.claim.sub','88999999-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare n integer; begin
 select count(*) into n from storage.objects where bucket_id='chat-files' and name like '%88999999%';
 if n<>2 then raise exception 'Intended peer cannot read private media'; end if;
 delete from storage.objects where bucket_id='chat-files' and name like '%88999999%';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Peer deleted somebody else''s uploads'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','88999999-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='chat-files' and name like '%88999999%') then raise exception 'Unrelated Creator read private media'; end if;
 begin
  insert into storage.objects(bucket_id,name,owner,metadata) values('chat-files','e2ee/roommate/88999999-3000-4000-8000-000000000001/attack.bin',auth.uid(),'{"mimetype":"application/octet-stream","size":100}');
  raise exception 'Unrelated identity uploaded into a private conversation';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- A block takes effect on existing media reads and on future uploads.
insert into public.roommate_user_blocks(blocker_user_id,blocked_user_id) values('media-owner','media-guest');
insert into public.worker_user_blocks(blocker_user_id,blocked_user_id) values('media-owner','media-guest');
select set_config('request.jwt.claim.sub','88999999-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='chat-files' and name like '%88999999%') then raise exception 'Blocked connection retained new Storage access'; end if;
 begin
  insert into storage.objects(bucket_id,name,owner,metadata) values('chat-files','e2ee/roommate/88999999-3000-4000-8000-000000000001/blocked.bin',auth.uid(),'{"mimetype":"application/octet-stream","size":100}');
  raise exception 'Blocked connection uploaded media';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Expired worker conversations keep allowed history, but cannot upload new media.
delete from public.worker_user_blocks where blocker_user_id='media-owner' and blocked_user_id='media-guest';
set local session_replication_role=replica;
update public.worker_bookings set status='approved_released' where id='88999999-4000-4000-8000-000000000001';
set local session_replication_role=origin;
set local role authenticated;
do $$ begin
 if not private.can_access_chat_cipher_object('e2ee/worker/88999999-5000-4000-8000-000000000001/voice.bin',false)
 or private.can_access_chat_cipher_object('e2ee/worker/88999999-5000-4000-8000-000000000001/voice.bin',true) then raise exception 'Closed job history/write boundary changed'; end if;
end $$;
reset role;

rollback;
