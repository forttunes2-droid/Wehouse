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
select public.send_friend_encrypted_message('99600000-1000-4000-8000-000000000001','c2VudA==','aXY=','[]',null,'99600000-2000-4000-8000-000000000002','1:i:k');
do $$declare next_version integer;begin
 if not public.can_observe_private_identity_key('cipher-2') or public.can_observe_private_identity_key('cipher-3') or public.can_observe_private_identity_key('cipher-4') then raise exception 'Key-change observer crossed an accepted conversation boundary';end if;
 if has_function_privilege('anon','public.reset_my_encryption_identity(jsonb,text,text,text,integer)','execute')
 or has_function_privilege('authenticated','private.reset_identity_before_friend_support(jsonb,text,text,text,integer)','execute')
 or has_function_privilege('authenticated','private.establish_key_before_recovery_lock(text,uuid,jsonb)','execute')
 or has_column_privilege('authenticated','public.user_encryption_identities','key_version','update')
 or has_column_privilege('authenticated','public.user_encryption_identities','public_key_jwk','update')
 or has_table_privilege('authenticated','public.conversation_key_envelopes','insert')
 or has_table_privilege('anon','public.user_encryption_identities','select')
 or has_function_privilege('anon','public.can_observe_private_identity_key(text)','execute') then raise exception 'Key-reset authority exposed';end if;
 update public.user_encryption_identities set backup_iv=repeat('B',16) where user_id='cipher-1';
 if not found then raise exception 'Trusted owner could not update the encrypted backup';end if;
 begin update public.user_encryption_identities set key_version=7 where user_id='cipher-1';raise exception 'FAIL: direct identity rotation accepted';exception when insufficient_privilege then null;end;
 begin perform public.reset_my_encryption_identity('{}',repeat('A',64),repeat('A',16),repeat('A',24),1);raise exception 'FAIL: invalid key reset accepted';exception when raise_exception then if sqlerrm not in('Unsupported key derivation settings','Invalid encryption public key') then raise;end if;end;
 next_version:=public.reset_my_encryption_identity('{"kty":"EC","crv":"P-256","x":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","y":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}',repeat('B',64),repeat('B',16),repeat('B',24),600000);
 if next_version<>2 then raise exception 'Identity reset did not return a new key version';end if;
end $$;
reset role;
do $$begin
 if exists(select 1 from public.conversation_key_envelopes where conversation_kind='friend' and conversation_id='99600000-1000-4000-8000-000000000001') then raise exception 'Friend envelopes were left wrapped to an unavailable key';end if;
 if (select count(*) from public.conversation_key_envelopes where conversation_kind='friend' and conversation_id='99600000-1000-4000-8000-000000000003')<>2 then raise exception 'Unrelated conversation keys were changed';end if;
 if not exists(select 1 from public.friend_messages where id='99600000-2000-4000-8000-000000000001' and ciphertext=repeat('A',64)) then raise exception 'Reset deleted existing ciphertext';end if;
 if (select count(*) from realtime.messages where topic='wehouse:e2ee-key:cipher-1')<>1 then raise exception 'Identity rotation did not emit exactly one scoped signal';end if;
end $$;
set local role authenticated;
do $$begin
 begin perform public.send_friend_encrypted_message('99600000-1000-4000-8000-000000000001','bmV3','aXY=','[]',null,'99600000-2000-4000-8000-000000000003','1:i:k');raise exception 'FAIL: stale envelope accepted';exception when serialization_failure then null;end;
 begin perform public.send_friend_encrypted_message('99600000-1000-4000-8000-000000000001','bmV3','aXY=');raise exception 'FAIL: missing envelope accepted';exception when serialization_failure then null;end;
 if public.send_friend_encrypted_message('99600000-1000-4000-8000-000000000001','c2VudA==','aXY=','[]',null,'99600000-2000-4000-8000-000000000002','1:i:k')<>'99600000-2000-4000-8000-000000000002'::uuid then raise exception 'Lost-result retry duplicated a confirmed message after reset';end if;
 if not public.establish_private_conversation_key('friend','99600000-1000-4000-8000-000000000001',pg_temp.envelopes('cipher-1','cipher-2',2,1)) then raise exception 'Friend key exchange could not restart after recovery';end if;
 perform public.send_friend_encrypted_message('99600000-1000-4000-8000-000000000001','bmV3','aXY=','[]',null,'99600000-2000-4000-8000-000000000004','2:i:k');
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"99600000-0000-4000-8000-000000000004","session_id":"99600000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$begin if public.can_observe_private_identity_key('cipher-1') then raise exception 'Outsider can observe key changes';end if;end $$;
reset role;
update public.user_sessions set is_active=false where user_id='cipher-1';
select set_config('request.jwt.claims','{"sub":"99600000-0000-4000-8000-000000000001","session_id":"99600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if public.can_observe_private_identity_key('cipher-2') then raise exception 'Revoked device can observe private key changes';end if;
 begin perform public.get_friend_encrypted_messages_page('99600000-1000-4000-8000-000000000001');raise exception 'FAIL: revoked device read Friend ciphertext';exception when insufficient_privilege then null;end;
 begin perform public.get_private_encrypted_messages('roommate','99600000-1000-4000-8000-000000000001');raise exception 'FAIL: revoked device reached private message reads';exception when insufficient_privilege then null;end;
 begin perform public.get_private_chat_peer_public_key('friend','99600000-1000-4000-8000-000000000001','cipher-2');raise exception 'FAIL: revoked device read peer keys';exception when insufficient_privilege then null;end;
 begin perform public.set_private_message_reaction('roommate','99600000-1000-4000-8000-000000000001','99600000-2000-4000-8000-000000000001','👍');raise exception 'FAIL: revoked device reached private reactions';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.user_encryption_identities) or exists(select 1 from public.conversation_key_envelopes) then raise exception 'Revoked device read encryption material';end if;
 update public.user_encryption_identities set backup_iv=repeat('C',16) where user_id='cipher-1';
 if found then raise exception 'Revoked device changed the encrypted backup';end if;
 begin perform public.establish_private_conversation_key('friend','99600000-1000-4000-8000-000000000001',pg_temp.envelopes('cipher-1','cipher-2',2,1));raise exception 'FAIL: revoked device changed conversation keys';exception when insufficient_privilege then null;end;
 begin perform public.reset_my_encryption_identity('{"kty":"EC","crv":"P-256","x":"x","y":"y"}',repeat('A',64),repeat('A',16),repeat('A',24),600000);raise exception 'FAIL: revoked device reset identity';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Friend recovery, current envelope versions, unrelated-key/ciphertext preservation, private observer scope and revoked-session denial pass; synthetic fixtures rolled back' result;

