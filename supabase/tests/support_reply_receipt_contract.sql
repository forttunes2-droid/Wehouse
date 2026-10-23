begin;
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end$$;
create function pg_temp.rejects(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when others then return true;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated;
do $$
declare u uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); x uuid:=gen_random_uuid();
 us uuid:=gen_random_uuid(); cs uuid:=gen_random_uuid(); xs uuid:=gen_random_uuid();
 uid text:='reply-check-'||u; cid text:='reply-check-'||c; xid text:='reply-check-'||x;
 conversation uuid; intent uuid:=gen_random_uuid(); receipt uuid; note uuid; bundle jsonb;
begin
 insert into auth.users(id,aud,role,email,created_at,updated_at) values
 (u,'authenticated','authenticated',u||'@example.invalid',now(),now()),(c,'authenticated','authenticated',c||'@example.invalid',now(),now()),(x,'authenticated','authenticated',x||'@example.invalid',now(),now());
 insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,state,city) values
 (u,u||'@example.invalid',uid,'creator',true,'Requester','Nasarawa','Lafia'),(c,c||'@example.invalid',cid,'user',true,'Reviewer','Nasarawa','Lafia'),(x,x||'@example.invalid',xid,'user',true,'Unrelated person','Nasarawa','Lafia');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(us,u,now(),now()),(cs,c,now(),now()),(xs,x,now(),now());
 insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status) values
 (uid,u,us,'check-'||u,'Browser',true,'trusted'),(cid,c,cs,'check-'||c,'Browser',true,'trusted'),(xid,x,xs,'check-'||x,'Browser',true,'trusted');
 insert into public.workspace_role_assignments(user_id,workspace_role,scope_type) values(cid,'creator','global');
 insert into public.partner_support_conversations(partner_id,subject) values(uid,'Reply receipt contract') returning id into conversation;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',us,'role','authenticated')::text,true);
 receipt:=public.send_support_message_v2(intent,conversation,'Please help');
 perform pg_temp.expect(receipt=public.send_support_message_v2(intent,conversation,'Please help'),'exact retry returns original receipt');
 perform pg_temp.expect((select count(*)=1 from public.partner_support_messages where sender_id=uid and client_request_id=intent),'retry stores one message');
 perform pg_temp.expect(pg_temp.rejects(format('select public.send_support_message_v2(%L,%L,%L)',intent,conversation,'Changed content')),'same intent cannot change content');
 perform pg_temp.expect(pg_temp.rejects(format('select public.send_support_message_v2(gen_random_uuid(),%L,%L,%L::text[],%L::text[],%L)',conversation,'Secret','{}','{}','internal')),'requester cannot write internal note');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',x,'session_id',xs,'role','authenticated')::text,true);
 perform pg_temp.expect(not public.current_actor_can_access_operational_conversation(conversation,false),'unrelated person cannot read');
 perform pg_temp.expect(pg_temp.rejects(format('select public.send_support_message_v2(gen_random_uuid(),%L,%L)',conversation,'Unrelated')),'unrelated person cannot send');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',c,'session_id',cs,'role','authenticated')::text,true);
 perform pg_temp.expect(pg_temp.rejects(format('select public.send_support_message_v2(gen_random_uuid(),%L,%L)',conversation,'Unclaimed')),'Creator must claim before replying');
 perform pg_temp.expect(public.claim_my_communication_case(conversation),'Creator can claim an unassigned case');
 note:=public.send_support_message_v2(gen_random_uuid(),conversation,'Private operational detail','{}','{}','internal');
 bundle:=public.get_operational_conversation_bundle(conversation);
 perform pg_temp.expect(exists(select 1 from jsonb_array_elements(bundle->'internal_notes') item where item->>'id'=note::text),'assigned team sees internal note');
 perform pg_temp.expect(not exists(select 1 from jsonb_array_elements(bundle->'messages') item where item->>'id'=note::text),'internal note excluded from public messages');
 perform pg_temp.expect(exists(select 1 from jsonb_array_elements(bundle->'internal_notes') item where item->>'id'=note::text and (item->>'is_read')::boolean=false),'private-note bundle carries read state');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',us,'role','authenticated')::text,true);
 update public.partner_support_messages set created_at=now()+interval '1 minute' where id=note;
 perform pg_temp.expect((select last_message is distinct from 'Private operational detail' from public.get_my_support_conversations() where conversation_id=conversation),'customer Inbox preview excludes newest internal note');
 perform pg_temp.expect((select unread_count=(select count(*) from public.partner_support_messages m where m.conversation_id=conversation and m.sender_id<>uid and not coalesce(m.is_read,false) and coalesce(m.visibility,'customer')<>'internal') from public.get_my_support_conversations() where conversation_id=conversation),'customer unread count excludes private notes');
 perform pg_temp.expect(not exists(select 1 from public.get_support_messages(conversation) m where m.id=note),'requester message API excludes internal notes');
 -- This requester intentionally has a privileged legacy label: ownership still wins.
 execute 'set local role authenticated';
 perform pg_temp.expect(not exists(select 1 from public.partner_support_messages where id=note),'direct RLS hides notes from requester despite legacy Creator label');
 perform pg_temp.expect(exists(select 1 from public.partner_support_messages where id=receipt),'direct RLS preserves own public message');
 execute 'reset role';
 perform public.mark_support_messages_read(conversation);
 perform pg_temp.expect((select not is_read from public.partner_support_messages where id=note),'requester cannot consume a private note receipt');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',x,'session_id',xs,'role','authenticated')::text,true);
 perform pg_temp.expect(pg_temp.rejects(format('select public.mark_support_messages_read(%L)',conversation)),'unrelated person cannot mark a conversation read');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',c,'session_id',cs,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform pg_temp.expect(exists(select 1 from public.partner_support_messages where id=note),'direct RLS permits authorized team private note');
 execute 'reset role';
 perform public.mark_support_messages_read(conversation);
 perform pg_temp.expect((select is_read from public.partner_support_messages where id=receipt),'authorized team marks requester message read');
 update public.user_sessions set is_active=false,trust_status='rejected' where user_id=cid;
 perform pg_temp.expect(not public.current_actor_can_access_operational_conversation(conversation,false),'revoked device loses conversation access');
 perform pg_temp.expect(pg_temp.rejects('select public.support_inbox(''all'')'),'revoked device cannot read operational Inbox');
 perform pg_temp.expect(pg_temp.rejects('select public.get_my_support_conversations()'),'revoked device cannot read requester Inbox');
 perform pg_temp.expect(pg_temp.rejects(format('select public.send_support_message_v2(gen_random_uuid(),%L,%L)',conversation,'Revoked')),'revoked device cannot send');
 perform pg_temp.expect(pg_temp.rejects(format('select public.mark_support_messages_read(%L)',conversation)),'revoked device cannot mark messages read');
 perform pg_temp.expect(pg_temp.rejects(format('select public.get_operational_conversation_bundle(%L)',conversation)),'revoked device cannot read bundle');
end $$;
rollback;
select 'Support reply retry, private notes, Creator assignment and trusted-device checks passed; fixtures rolled back' as result;
