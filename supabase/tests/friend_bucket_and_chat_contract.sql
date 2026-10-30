\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated,anon,service_role;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$
begin execute statement; return false; exception when others then return true; end $$;
grant execute on function pg_temp.rejects(text) to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,city,local_government) values
('96000000-0000-4000-8000-000000000001','cb-a@example.invalid','cb-a','user',true,'consumer','A','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000002','cb-b@example.invalid','cb-b','user',true,'consumer','B','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000003','cb-c@example.invalid','cb-c','user',true,'consumer','C','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000004','cb-d@example.invalid','cb-d','user',true,'consumer','D','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000005','cb-e@example.invalid','cb-e','user',true,'consumer','E','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000006','cb-f@example.invalid','cb-f','user',true,'consumer','F','Lagos','Ikeja','Ikeja'),
('96000000-0000-4000-8000-000000000007','cb-g@example.invalid','cb-g','user',true,'consumer','G','Lagos','Ikeja','Ikeja');
set local session_replication_role=origin;

-- Bucket: A can hold 5 friends (accepted or sent), not 6.
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.send_friend_request('cb-b');
select public.send_friend_request('cb-c');
select public.send_friend_request('cb-d');
select public.send_friend_request('cb-e');
select public.send_friend_request('cb-f');
select pg_temp.expect(pg_temp.rejects($$select public.send_friend_request('cb-g')$$),'a sixth friend is rejected');

-- Removing frees a slot.
select public.remove_friend('cb-f');
select pg_temp.expect((public.send_friend_request('cb-g')->>'status')='pending','a freed slot can be used');

-- Recipient accepts B and may chat; ciphertext only.
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('test.cid',(select (x->>'friend_id') from jsonb_array_elements(public.list_my_friends()) x limit 1),true);
select public.respond_to_friend_request(current_setting('test.cid')::uuid,true);
select pg_temp.expect(public.send_friend_encrypted_message(current_setting('test.cid')::uuid,'ZmFrZQ==','aXY=') is not null,'accepted friend can send ciphertext');
select pg_temp.expect(public.send_friend_encrypted_message(current_setting('test.cid')::uuid,'ZmFrZQ==','aXY=','[]'::jsonb,null,'98200000-0000-4000-8000-000000000001')=public.send_friend_encrypted_message(current_setting('test.cid')::uuid,'ZmFrZQ==','aXY=','[]'::jsonb,null,'98200000-0000-4000-8000-000000000001'),'same client id sends one message');
select pg_temp.expect(pg_temp.rejects(format('select public.send_friend_encrypted_message(%L::uuid,%L,%L)',current_setting('test.cid'),'','x')),'empty ciphertext is rejected');

-- Outsider cannot read or write the thread.
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects(format('select * from public.get_friend_encrypted_messages(%L::uuid)',current_setting('test.cid'))),'outsider cannot read');
select pg_temp.expect(pg_temp.rejects(format('select public.send_friend_encrypted_message(%L::uuid,%L,%L)',current_setting('test.cid'),'a','b')),'outsider cannot send');

-- The sender reads it back; the stored value is exactly the ciphertext.
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect((select count(*) from public.get_friend_encrypted_messages(current_setting('test.cid')::uuid))=2,'participant reads the thread');
select pg_temp.expect(pg_temp.rejects('select 1 from public.friend_messages'),'no direct table read');

-- Cancel: either side can end it; the chat closes; a new request waits 30 days.
-- Exercise history with tied timestamps, hidden rows and cursor traversal.
reset role;
set local session_replication_role=replica;
insert into public.friend_messages(friend_id,sender_id,ciphertext,encryption_iv,created_at)
select current_setting('test.cid')::uuid,'cb-a','ZmFrZQ==','aXY=',now()-interval '2 days'
from generate_series(1,120);
insert into public.friend_messages(friend_id,sender_id,ciphertext,encryption_iv,created_at,hidden_for)
values(current_setting('test.cid')::uuid,'cb-a','ZmFrZQ==','aXY=',now()-interval '1 day',array['cb-a']);
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.expect((select count(*) from public.get_friend_encrypted_messages(current_setting('test.cid')::uuid))=50,'legacy read is bounded');
select pg_temp.expect((select count(*) from public.get_friend_encrypted_messages_page(current_setting('test.cid')::uuid))=51,'page includes one lookahead');
select pg_temp.expect(pg_temp.rejects(format('select * from public.get_friend_encrypted_messages_page(%L::uuid,null,null,1000)',current_setting('test.cid'))),'oversized page is rejected');
select pg_temp.expect(pg_temp.rejects(format('select * from public.get_friend_encrypted_messages_page(%L::uuid,now(),null,50)',current_setting('test.cid'))),'partial cursor is rejected');
do $$declare before_at timestamptz;before_id uuid;page record;ids uuid[]:='{}';n integer:=0;seen integer;cursor jsonb;target uuid;
begin
 loop
  seen:=0;
  for page in select * from public.get_friend_encrypted_messages_page(current_setting('test.cid')::uuid,before_at,before_id,50) loop
   if page.id=any(ids) then raise exception 'Duplicate message across pages';end if;
   ids:=array_append(ids,page.id);before_at:=page.created_at;before_id:=page.id;seen:=seen+1;
  end loop;
  n:=n+1;exit when seen<50;
  if n>4 then raise exception 'Cursor did not advance';end if;
 end loop;
 perform pg_temp.expect(cardinality(ids)=122,'all visible messages are reachable exactly once, including tied timestamps');
 target:=ids[100];
 cursor:=public.get_friend_message_history_cursor(current_setting('test.cid')::uuid,target)->'before';
 perform pg_temp.expect(exists(select 1 from public.get_friend_encrypted_messages_page(current_setting('test.cid')::uuid,(cursor->>'at')::timestamptz,(cursor->>'id')::uuid,50) m where m.id=target),'pinned message can be located outside latest page');
 perform set_config('test.history_target',target::text,true);
end $$;
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects(format('select * from public.get_friend_encrypted_messages_page(%L::uuid)',current_setting('test.cid'))),'outsider cannot read a page');
select pg_temp.expect(pg_temp.rejects(format('select public.get_friend_message_history_cursor(%L::uuid,%L::uuid)',current_setting('test.cid'),current_setting('test.history_target'))),'outsider cannot locate a pinned message');
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.remove_friend('cb-b');
select pg_temp.expect(pg_temp.rejects(format('select * from public.get_friend_encrypted_messages(%L::uuid)',current_setting('test.cid'))),'cancelled chat is closed');
select pg_temp.expect(pg_temp.rejects(format('select public.send_friend_encrypted_message(%L::uuid,%L,%L)',current_setting('test.cid'),'a','b')),'cannot send after cancelling');
select pg_temp.expect(pg_temp.rejects($$select public.send_friend_request('cb-b')$$),'canceller cannot re-request within 30 days');
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect(pg_temp.rejects($$select public.send_friend_request('cb-a')$$),'the other person cannot re-request within 30 days either');
reset role;
select pg_temp.expect(not exists(select 1 from public.roommate_user_blocks where blocker_user_id like 'cb-%'),'friend cancel writes nothing to Roommate blocks');
select pg_temp.expect(not exists(select 1 from public.conversations where participant_a like 'cb-%'),'friend chat creates no Roommate conversation');

-- After 30 days a new request is allowed.
update public.friends set responded_at = now() - public.friend_rerequest_wait() - interval '1 day' where user_low='cb-a' and user_high='cb-b';
select set_config('request.jwt.claims','{"sub":"96000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect((public.send_friend_request('cb-b')->>'status')='pending','a request is allowed after the 30-day wait');
reset role;

select 'friend_bucket_and_chat_contract_ok' as result;
rollback;
