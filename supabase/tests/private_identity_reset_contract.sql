-- Trusted synthetic account fixtures; no provider calls and no committed data.
begin;
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('99600000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','cipher-'||n||'@example.invalid',now(),now() from generate_series(1,4)n;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,state,city,local_government)
select '99600000-0000-4000-8000-00000000000'||n,'cipher-'||n||'@example.invalid','cipher-'||n,'user',true,'Lagos','Ikeja','Ikeja' from generate_series(1,4)n;
insert into auth.sessions(id,user_id,created_at,updated_at)
select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('cipher-1','cipher-2','cipher-3','cipher-4');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,auth_id,'cipher-contract-'||user_id,'Synthetic trusted browser',true,'trusted' from public.profiles where user_id in('cipher-1','cipher-2','cipher-3','cipher-4');
insert into public.user_encryption_identities(user_id,public_key_jwk,encrypted_private_key,backup_iv,backup_salt)
select 'cipher-'||n,'{"kty":"EC","crv":"P-256","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","y":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}'::jsonb,repeat('A',64),repeat('A',16),repeat('A',24) from generate_series(1,4)n;
insert into public.friends(id,user_low,user_high,status,requested_by) values
('99600000-1000-4000-8000-000000000001','cipher-1','cipher-2','accepted','cipher-1'),
('99600000-1000-4000-8000-000000000002','cipher-1','cipher-3','pending','cipher-1'),
('99600000-1000-4000-8000-000000000003','cipher-3','cipher-4','accepted','cipher-3');
insert into public.friend_messages(id,friend_id,sender_id,ciphertext,encryption_iv,encryption_version)
values('99600000-2000-4000-8000-000000000001','99600000-1000-4000-8000-000000000001','cipher-1',repeat('A',64),repeat('A',16),1);
set local session_replication_role=origin;
create function pg_temp.envelopes(a text,b text,va integer default 1,vb integer default 1) returns jsonb language sql as $$
select jsonb_build_array(
 jsonb_build_object('recipient_user_id',a,'recipient_key_version',va,'sender_ephemeral_public_key_jwk','{}'::jsonb,'wrapped_key','k','wrap_iv','i'),
 jsonb_build_object('recipient_user_id',b,'recipient_key_version',vb,'sender_ephemeral_public_key_jwk','{}'::jsonb,'wrapped_key','k','wrap_iv','i'))
$$;
grant execute on function pg_temp.envelopes(text,text,integer,integer) to authenticated;
select set_config('request.jwt.claims','{"sub":"99600000-0000-4000-8000-000000000003","session_id":"99600000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select public.establish_private_conversation_key('friend','99600000-1000-4000-8000-000000000003',pg_temp.envelopes('cipher-3','cipher-4'));
reset role;
select set_config('request.jwt.claims','{"sub":"99600000-0000-4000-8000-000000000001","session_id":"99600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.establish_private_conversation_key('friend','99600000-1000-4000-8000-000000000001',pg_temp.envelopes('cipher-1','cipher-2'));
create function pg_temp.token() returns text language sql as $$select key_id::text||':'||recipient_key_version::text||':'||wrap_iv||':'||wrapped_key from public.conversation_key_envelopes where conversation_kind='friend' and conversation_id='99600000-1000-4000-8000-000000000001' and recipient_user_id=public.current_profile_user_id() and is_current$$;
grant execute on function pg_temp.token() to authenticated;
select public.send_friend_encrypted_message('99600000-1000-4000-8000-000000000001','c2VudA==','aXY=','[]',null,'99600000-2000-4000-8000-000000000002',pg_temp.token());
select set_config('fixture.old_token',pg_temp.token(),true);
do $$declare identity public.user_encryption_identities;receipt jsonb;request uuid:=gen_random_uuid();begin
 if has_function_privilege('authenticated','public.reset_my_encryption_identity(jsonb,text,text,text,integer)','execute')
 or has_column_privilege('authenticated','public.user_encryption_identities','backup_iv','update')
 or has_table_privilege('authenticated','public.user_encryption_identities','insert')
 or has_table_privilege('authenticated','public.conversation_key_envelopes','insert') then raise exception 'Private key authority exposed';end if;
 begin update public.user_encryption_identities set backup_iv=repeat('B',16) where user_id='cipher-1';raise exception 'FAIL direct backup update';exception when insufficient_privilege then null;end;
 select * into identity from public.user_encryption_identities where user_id='cipher-1';
 receipt:=public.set_my_private_chat_backup(request,1,identity.updated_at,'device_only');
 if receipt->>'backup_scheme'<>'device_only' then raise exception 'Weak backup was not retired';end if;
 if public.set_my_private_chat_backup(request,1,identity.updated_at,'device_only') is distinct from receipt then raise exception 'Backup retry lost its receipt';end if;
 begin perform public.set_my_private_chat_backup(gen_random_uuid(),1,identity.updated_at,'device_only');raise exception 'FAIL stale revision';exception when serialization_failure then null;end;
 select * into identity from public.user_encryption_identities where user_id='cipher-1';
 if identity.public_key_jwk->>'x'<>repeat('A',43) or identity.key_version<>1 or identity.encrypted_private_key is not null then raise exception 'Backup change altered identity or retained weak blob';end if;
 receipt:=public.start_my_new_private_identity(1,identity.updated_at,jsonb_build_object('kty','EC','crv','P-256','x',repeat('B',43),'y',repeat('B',43)));
 if (receipt->>'key_version')::integer<>2 then raise exception 'New identity version missing';end if;
 if public.start_my_new_private_identity(1,identity.updated_at,jsonb_build_object('kty','EC','crv','P-256','x',repeat('B',43),'y',repeat('B',43))) is distinct from receipt then raise exception 'Restart retry rotated twice';end if;
 begin perform public.send_friend_encrypted_message('99600000-1000-4000-8000-000000000001','bmV3','aXY=','[]',null,'99600000-2000-4000-8000-000000000003',current_setting('fixture.old_token'));raise exception 'FAIL stale envelope accepted';exception when serialization_failure then null;end;
 if public.send_friend_encrypted_message('99600000-1000-4000-8000-000000000001','c2VudA==','aXY=','[]',null,'99600000-2000-4000-8000-000000000002',current_setting('fixture.old_token'))<>'99600000-2000-4000-8000-000000000002'::uuid then raise exception 'Confirmed retry duplicated message';end if;
end $$;
reset role;
do $$begin
 if (select count(*) from public.conversation_key_envelopes where conversation_id='99600000-1000-4000-8000-000000000001' and not is_current)<>2 then raise exception 'Peer historical envelopes were lost';end if;
 if (select count(*) from public.conversation_key_envelopes where conversation_id='99600000-1000-4000-8000-000000000003' and is_current)<>2 then raise exception 'Unrelated conversation changed';end if;
 if (select count(*) from public.friend_messages where friend_id='99600000-1000-4000-8000-000000000001')<>2 then raise exception 'Message history was changed';end if;
end $$;
set local role authenticated;
select public.establish_private_conversation_key('friend','99600000-1000-4000-8000-000000000001',pg_temp.envelopes('cipher-1','cipher-2',2,1));
select public.send_friend_encrypted_message('99600000-1000-4000-8000-000000000001','bmV3','aXY=','[]',null,'99600000-2000-4000-8000-000000000003',pg_temp.token());
reset role;
do $$begin
 if not exists(select 1 from public.friend_messages m join public.conversation_key_envelopes e on e.key_id=m.encryption_key_id and e.recipient_user_id=m.sender_id and e.is_current where m.id='99600000-2000-4000-8000-000000000003') then raise exception 'Message was not bound to its generation';end if;
 update public.user_sessions set is_active=false where user_id='cipher-1';
end $$;
set local role authenticated;
do $$begin
 begin perform public.create_my_automatic_private_identity(jsonb_build_object('kty','EC','crv','P-256','x',repeat('A',43),'y',repeat('A',43)));raise exception 'FAIL revoked device setup';exception when insufficient_privilege then null;end;
 begin perform * from public.get_friend_encrypted_messages_page('99600000-1000-4000-8000-000000000001');raise exception 'FAIL revoked read';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'private_identity_reset_contract_ok';
rollback;
