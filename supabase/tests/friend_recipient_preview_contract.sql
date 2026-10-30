\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean, description text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',description; end if;end$$;
grant execute on function pg_temp.expect(boolean,text) to authenticated;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,username,role,profile_complete,account_kind,full_name,state,city,local_government) values
('97200000-0000-4000-8000-000000000001','preview-a@example.invalid','preview-a','preview_a','user',true,'consumer','Ada','Lagos','Ikeja','Ikeja'),
('97200000-0000-4000-8000-000000000002','preview-b@example.invalid','preview-b','preview_b','user',true,'consumer','Bola','Lagos','Ikeja','Ikeja');
set local session_replication_role=origin;
select pg_temp.expect(not has_function_privilege('anon','public.preview_friend_recipient(text)','execute'),'anonymous lookup denied');
select set_config('request.jwt.claims','{"sub":"97200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(public.preview_friend_recipient(' PREVIEW_B ')=jsonb_build_object('user_id','preview-b','username','preview_b','full_name','Bola'),'exact case insensitive preview exposes only display identity');
select pg_temp.expect(public.preview_friend_recipient('preview_a')?'error','self rejected');
select pg_temp.expect(public.preview_friend_recipient('preview_')?'error','prefix search rejected');
reset role;
select pg_temp.expect(not exists(select 1 from public.friends where user_low='preview-a'),'preview sends nothing');
update public.profiles set username='preview_b_renamed' where user_id='preview-b';
set local role authenticated;
select pg_temp.expect(public.send_friend_request('preview-b')->>'status'='pending','confirmed immutable recipient survives username change');
select public.block_friend('preview-b');
select pg_temp.expect(public.preview_friend_recipient('preview_b_renamed')?'error','blocked recipient not disclosed');
reset role;
update public.user_action_rate_limits set attempt_count=20 where user_key='preview-a' and action='friend_recipient_preview';
set local role authenticated;
select pg_temp.expect(public.preview_friend_recipient('missing')->>'error'='Too many lookups. Wait a minute and try again.','lookup cap applies to failed searches');
reset role;
select pg_temp.expect((select attempt_count=21 from public.user_action_rate_limits where user_key='preview-a' and action='friend_recipient_preview'),'denied lookup consumes attempt');
rollback;
