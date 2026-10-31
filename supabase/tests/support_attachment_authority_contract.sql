begin;
-- Metadata-only synthetic fixtures, all rolled back. Match Storage's explicit
-- transaction setting; no real objects or bytes are removed by SQL.
set local storage.allow_delete_query='true';
create function pg_temp.expect(value boolean,description text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',description;end if;end $$;
grant execute on function pg_temp.expect(boolean,text) to authenticated;
set local session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at) values
 ('99610000-0000-4000-8000-000000000001','support-file-requester@example.invalid',now()),
 ('99610000-0000-4000-8000-000000000002','support-file-team@example.invalid',now()),
 ('99610000-0000-4000-8000-000000000003','support-file-outsider@example.invalid',now());
insert into public.profiles(auth_id,user_id,email,role,profile_complete,full_name,state,city) values
 ('99610000-0000-4000-8000-000000000001','support-file-requester','support-file-requester@example.invalid','user',true,'Requester','Nasarawa','Lafia'),
 ('99610000-0000-4000-8000-000000000002','support-file-team','support-file-team@example.invalid','user',true,'Team','Nasarawa','Lafia'),
 ('99610000-0000-4000-8000-000000000003','support-file-outsider','support-file-outsider@example.invalid','user',true,'Outsider','Nasarawa','Lafia');
insert into auth.sessions(id,user_id,created_at,updated_at)
 select id,id,now(),now() from auth.users where email like 'support-file-%@example.invalid';
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
 select user_id,auth_id::uuid,auth_id::uuid,'support-files-'||user_id,'Synthetic',true,'trusted'
 from public.profiles where user_id in('support-file-requester','support-file-team','support-file-outsider');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
 values(gen_random_uuid(),'99610000-0000-4000-8000-000000000002','totp','verified',now(),now());
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type)
 values('support-file-team','creator','global');
insert into public.partner_support_conversations(id,partner_id,subject)
 values('99610000-1000-4000-8000-000000000001','support-file-requester','Support attachment authority');
insert into storage.objects(id,bucket_id,name,owner_id,metadata) values
 ('99610000-2000-4000-8000-000000000001','support-files','99610000-1000-4000-8000-000000000001/customer.png','99610000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":70}'),
 ('99610000-2000-4000-8000-000000000002','support-files','99610000-1000-4000-8000-000000000001/team.png','99610000-0000-4000-8000-000000000002','{"mimetype":"image/png","size":70}'),
 ('99610000-2000-4000-8000-000000000003','support-files','99610000-1000-4000-8000-000000000001/unsent.png','99610000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":70}'),
 ('99610000-2000-4000-8000-000000000004','support-files','99610000-1000-4000-8000-000000000001/unowned.png',null,'{"mimetype":"image/png","size":70}');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"99610000-0000-4000-8000-000000000001","session_id":"99610000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.send_support_message_v2('99610000-3000-4000-8000-000000000001','99610000-1000-4000-8000-000000000001',
 'Customer evidence',array['99610000-1000-4000-8000-000000000001/customer.png'],array['image/png']);
reset role;
select set_config('request.jwt.claims','{"sub":"99610000-0000-4000-8000-000000000002","session_id":"99610000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select public.claim_my_communication_case('99610000-1000-4000-8000-000000000001');
select public.send_support_message_v2('99610000-3000-4000-8000-000000000002','99610000-1000-4000-8000-000000000001',
 'WeHouse evidence',array['99610000-1000-4000-8000-000000000001/team.png'],array['image/png']);
with removed as(delete from storage.objects where bucket_id='support-files' and name like '99610000-1000-4000-8000-000000000001/%' returning 1)
 select pg_temp.expect(count(*)=0,'Creator cannot delete sent evidence or another uploader files') from removed;
reset role;
select set_config('request.jwt.claims','{"sub":"99610000-0000-4000-8000-000000000001","session_id":"99610000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
with removed as(delete from storage.objects where id in('99610000-2000-4000-8000-000000000001','99610000-2000-4000-8000-000000000002','99610000-2000-4000-8000-000000000004') returning 1)
 select pg_temp.expect(count(*)=0,'Requester cannot delete own sent, team sent or ownerless files') from removed;
select pg_temp.expect(exists(select 1 from storage.objects where id='99610000-2000-4000-8000-000000000002'),'Requester can still read the customer-visible team attachment');
with replaced as(update storage.objects set metadata='{"mimetype":"image/png","size":1}' where id='99610000-2000-4000-8000-000000000001' returning 1)
 select pg_temp.expect(count(*)=0,'Client cannot replace sent content') from replaced;
do $$begin
 begin
  perform public.send_support_message_v2(gen_random_uuid(),'99610000-1000-4000-8000-000000000001','Not my file',array['99610000-1000-4000-8000-000000000001/team.png'],array['image/png']);
  raise exception 'FAIL: participant claimed a team upload';
 exception when insufficient_privilege then null;end;
end $$;
select pg_temp.expect(exists(select 1 from storage.objects where id='99610000-2000-4000-8000-000000000003'),'Owner can read own unsent file for Storage cleanup');
with removed as(delete from storage.objects where id='99610000-2000-4000-8000-000000000003' returning 1)
 select pg_temp.expect(count(*)=1,'Owner can clean own unsent upload') from removed;
reset role;
-- First-send receipts keep their attachments after a retry or expired draft.
do $$declare draft uuid;reply jsonb;replay jsonb;path text;begin
 draft:=public.create_my_support_message_draft();path:='drafts/support-file-requester/'||draft||'/photo.png';
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('support-files',path,'99610000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":70}');
 reply:=public.send_my_first_wehouse_message(draft,'Photo help','general','general',null,'{}','normal','My photo',array[path],array['image/png']);
 replay:=public.send_my_first_wehouse_message(draft,'Photo help','general','general',null,'{}','normal','My photo',array[path],array['image/png']);
 perform pg_temp.expect(reply->>'conversation_id'=replay->>'conversation_id' and reply->>'message_id'=replay->>'message_id','First-send retry returns the same recorded message');
 execute 'set local role authenticated';
 perform pg_temp.expect(not private.support_file_can_cleanup((select id from storage.objects where bucket_id='support-files' and name=path)),'Consumed sent draft cannot be cleaned as an unsent upload');
 execute 'reset role';
 draft:=public.create_my_support_message_draft();path:='drafts/support-file-requester/'||draft||'/expired.png';
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('support-files',path,'99610000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":70}');
 update public.support_message_drafts set created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute' where draft_id=draft;
 execute 'set local role authenticated';
 delete from storage.objects where bucket_id='support-files' and name=path;
 if not found then raise exception 'FAIL: expired own unsent draft cleanup denied';end if;
 execute 'reset role';
end $$;
-- The final metadata guard also applies to Storage's service-role mutation,
-- after permission probes. Reviewed erasure must clear authorised references
-- through the existing case process before removing retained bytes.
do $$begin
 begin delete from storage.objects where id='99610000-2000-4000-8000-000000000002';
  raise exception 'FAIL: final Storage mutation deleted referenced bytes';
 exception when insufficient_privilege then null;end;
end $$;
update public.user_sessions set is_active=false where auth_id='99610000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect(not exists(select 1 from storage.objects where bucket_id='support-files' and name like '99610000-1000-4000-8000-000000000001/%'),'Revoked requester cannot read Support attachments');
reset role;
select set_config('request.jwt.claims','{"sub":"99610000-0000-4000-8000-000000000003","session_id":"99610000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(not exists(select 1 from storage.objects where bucket_id='support-files' and name like '99610000-1000-4000-8000-000000000001/%'),'Outsider has no Support file access');
reset role;
select 'support_attachment_authority_contract_ok';
rollback;
