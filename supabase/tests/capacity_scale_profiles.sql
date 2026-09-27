\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
-- Profile cardinality only. No real auth users, passwords or login sessions.
insert into public.profiles (auth_id,email,user_id,role,profile_complete)
select 'load-auth-'||g,'load-'||g||'@example.invalid','load-user-'||g,'user',true
from generate_series(:start,:end) g;
commit;
