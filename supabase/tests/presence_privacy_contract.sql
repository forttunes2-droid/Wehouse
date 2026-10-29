-- Synthetic identities; actual authenticated commands; every row rolls back.
begin;
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('99600000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','presence-'||n||'@example.invalid',now(),now() from generate_series(1,3) n;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,privacy_activity_visible)
select '99600000-0000-4000-8000-00000000000'||n,'presence-'||n||'@example.invalid','presence-'||n,'user',true,true from generate_series(1,3) n;
insert into auth.sessions(id,user_id,created_at,updated_at)
select auth_id::uuid,auth_id::uuid,now(),now() from public.profiles where user_id in('presence-1','presence-2','presence-3');
insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
select user_id,auth_id,auth_id,'presence-contract-'||user_id,'Synthetic browser',true,'trusted' from public.profiles where user_id in('presence-1','presence-2','presence-3');
insert into public.friends(user_low,user_high,requested_by,status) values('presence-1','presence-2','presence-1','accepted');
insert into public.workspace_role_assignments(user_id,workspace_role,status) values('presence-1','worker','active');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"99600000-0000-4000-8000-000000000002","session_id":"99600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.touch_my_presence(true);
reset role;
select set_config('request.jwt.claims','{"sub":"99600000-0000-4000-8000-000000000001","session_id":"99600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare receipt jsonb;begin
 receipt:=public.get_chat_peer_presence('presence-2');
 if receipt->>'visible'<>'true' or receipt->>'online'<>'true' or receipt->>'last_seen' is null then raise exception 'Accepted Friend presence missing';end if;
 if public.get_chat_peer_presence('presence-3')<>'{"visible":false,"online":false,"last_seen":null}'::jsonb then raise exception 'Unrelated person presence exposed';end if;
 if has_function_privilege('anon','public.get_chat_peer_presence(text)','EXECUTE') or has_function_privilege('authenticated','private.presence_actor()','EXECUTE') then raise exception 'Presence grants exposed';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"99600000-0000-4000-8000-000000000002","session_id":"99600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$declare saved public.profiles;begin
 saved:=public.update_my_privacy('{"privacy_activity_visible":false}');
 if saved.user_id<>'presence-2' or saved.privacy_activity_visible or saved.is_online then raise exception 'Own privacy choice not saved';end if;
 if public.touch_my_presence(true) is not null then raise exception 'Hidden presence still writes activity';end if;
 begin perform public.update_my_privacy('{"privacy_activity_visible":"false"}');raise exception 'FAIL: string privacy value accepted';exception when invalid_parameter_value then null;end;
 begin perform public.update_my_privacy('{"user_id":"presence-1"}');raise exception 'FAIL: another profile addressed';exception when invalid_parameter_value then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"99600000-0000-4000-8000-000000000001","session_id":"99600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$begin if public.get_chat_peer_presence('presence-2')<>'{"visible":false,"online":false,"last_seen":null}'::jsonb then raise exception 'Hidden activity timestamp exposed';end if;end $$;
reset role;
update public.friends set status='blocked',blocked_by='presence-1' where user_low='presence-1' and user_high='presence-2';
update public.profiles set privacy_activity_visible=true,is_online=true where user_id='presence-2';
set local role authenticated;
do $$begin if public.get_chat_peer_presence('presence-2')<>'{"visible":false,"online":false,"last_seen":null}'::jsonb then raise exception 'Blocked Friendship still exposes activity';end if;end $$;
reset role;
insert into private.workspace_restrictions(user_id,workspace,restricted,public_reason,changed_by)
 values('presence-1','personal',true,'Synthetic Personal-only restriction','presence-3');
set local role authenticated;
do $$begin
 if public.current_actor_has_personal_workspace() or public.user_has_active_workspace('presence-1','personal') then raise exception 'Personal-only restriction bypassed';end if;
 if not public.user_has_active_workspace('presence-1','worker') then raise exception 'Personal restriction incorrectly revoked Worker access';end if;
 begin perform public.send_friend_request('presence-3');raise exception 'FAIL: restricted Personal account requested a Friend';
 exception when insufficient_privilege then null;
 when raise_exception then if sqlerrm<>'Active Personal account required' then raise;end if;end;
end $$;
reset role;
do $$begin
 if exists(select 1 from public.friends where user_low='presence-1' and user_high='presence-3') then raise exception 'Denied Friend request still stored';end if;
end $$;
update public.user_sessions set is_active=false where user_id='presence-1';
set local role authenticated;
do $$begin
 begin perform public.get_chat_peer_presence('presence-2');raise exception 'FAIL: revoked session read presence';exception when insufficient_privilege then null;end;
 begin perform public.touch_my_presence(true);raise exception 'FAIL: revoked session wrote presence';exception when insufficient_privilege then null;end;
 begin perform public.update_my_privacy('{"privacy_activity_visible":false}');raise exception 'FAIL: revoked session changed privacy';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Presence privacy, accepted/blocked/unrelated peers, owner updates and session revocation pass; fixtures rolled back' as result;
