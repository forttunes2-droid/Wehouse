\set ON_ERROR_STOP on
begin;
\ir private_message_fixture_helpers.sql
-- Synthetic metadata only; no uploaded bytes or live identities are touched.
set local storage.allow_delete_query='true';
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
create function pg_temp.denied(statement text,fragment text) returns boolean language plpgsql as $$
begin execute statement;return false;exception when others then
 if strpos(sqlerrm,fragment)=0 then raise exception 'Unexpected denial: %',sqlerrm;end if;return true;end $$;
grant execute on function pg_temp.expect(boolean,text),pg_temp.denied(text,text) to authenticated;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,username,role,profile_complete,account_kind) values
('9755a000-0000-4000-8000-000000000001','authority-owner@example.invalid','authority-owner','authority_owner','user',true,'consumer'),
('9755a000-0000-4000-8000-000000000002','authority-target@example.invalid','authority-target','authority_target','user',true,'consumer'),
('9755a000-0000-4000-8000-000000000003','authority-a@example.invalid','authority-a','authority_a','user',true,'consumer'),
('9755a000-0000-4000-8000-000000000004','authority-b@example.invalid','authority-b','authority_b','user',true,'consumer'),
('9755a000-0000-4000-8000-000000000005','authority-admin@example.invalid','authority-admin','authority_admin','admin',true,'consumer'),
('9755a000-0000-4000-8000-000000000006','authority-creator@example.invalid','authority-creator','authority_creator','creator',true,'consumer');
select pg_temp.prepare_private_message_fixture(array['9755a000']);
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values
('9755a000-9000-4000-8000-000000000005','9755a000-0000-4000-8000-000000000005','totp','verified',now(),now()),
('9755a000-9000-4000-8000-000000000006','9755a000-0000-4000-8000-000000000006','totp','verified',now(),now());
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,status) values
('authority-admin','admin','branch','Lagos','Ikeja','active'),
('authority-creator','creator','global',null,null,'active'),
('authority-owner','property_partner','global',null,null,'active');
insert into public.hotels(hotel_id,name,state,city,owner_id,status)
values(97550001,'Authority Hotel','Lagos','Ikeja','authority-owner','active');
insert into public.hotel_team_members(id,hotel_id,member_user_id,hotel_role,status,capabilities,invited_by) values
('9755a000-1000-4000-8000-000000000001',97550001,'authority-target','front_desk','invited',array['stay.read'],'authority-owner');
insert into public.resource_invitations(invitation_id,resource_type,resource_id,role_key,permission_profile,delivery,
 inviter_user_id,intended_user_id,subject_assignment_id,status,expires_at) values
('9755a000-2000-4000-8000-000000000001','hotel','97550001','hotel_front_desk','front_desk','direct',
 'authority-owner','authority-target','9755a000-1000-4000-8000-000000000001','pending',now()+interval '1 day');
insert into public.resource_invitations(invitation_id,resource_type,resource_id,role_key,permission_profile,delivery,
 inviter_user_id,token_hash,status,expires_at,created_at) values
('9755a000-2000-4000-8000-000000000002','hotel','97550001','hotel_front_desk','front_desk','link',
 'authority-owner',public._invitation_token_hash(repeat('a',64)),'pending',now()+interval '1 day',now()-interval '1 day');
insert into public.friends(id,user_low,user_high,requested_by,status)
values('9755a000-3000-4000-8000-000000000001','authority-a','authority-b','authority-a','accepted');
insert into public.listings(id,listing_id,title,sub_type,state,city,status,availability_status,owner_id,partner_id) values
('9755a000-4000-4000-8000-000000000001','authority-home-in','Authority local home','long_stay','Lagos','Ikeja','available','available','authority-owner','authority-owner'),
('9755a000-4000-4000-8000-000000000002','authority-home-branch','Authority other branch','long_stay','Lagos','Lekki','available','available','authority-owner','authority-owner'),
('9755a000-4000-4000-8000-000000000003','authority-home-state','Authority other state','long_stay','FCT','Abuja','available','available','authority-owner','authority-owner');
insert into storage.objects(id,bucket_id,name,owner_id,metadata)
select ('9755a000-5000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'listing-images',
 'listings/9755a000-4000-4000-8000-'||lpad(n::text,12,'0')||'/fixture.jpg','9755a000-0000-4000-8000-000000000005',
 '{"mimetype":"image/jpeg","size":1}'::jsonb from generate_series(1,3) n;
set local session_replication_role=origin;

select set_config('request.jwt.claims','{"sub":"9755a000-0000-4000-8000-000000000001","session_id":"9755a000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(public.owner_revoke_hotel_team_member('9755a000-1000-4000-8000-000000000001'),'owner can revoke the invitation');
reset role;
select pg_temp.expect((select status='revoked' from public.resource_invitations where invitation_id='9755a000-2000-4000-8000-000000000001'),'revocation closes the tracked direct invitation');
select set_config('request.jwt.claims','{"sub":"9755a000-0000-4000-8000-000000000002","session_id":"9755a000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect(pg_temp.denied($q$select public.respond_to_hotel_team_invitation('9755a000-1000-4000-8000-000000000001',true)$q$,'no longer available'),'legacy response cannot restore revoked access');
select pg_temp.expect(pg_temp.denied($q$select public.respond_to_resource_invitation('9755a000-2000-4000-8000-000000000001',true,null)$q$,'no longer pending'),'canonical response cannot restore revoked access');
select pg_temp.expect(pg_temp.denied($q$select public.respond_to_resource_invitation('9755a000-2000-4000-8000-000000000002',true,repeat('a',64))$q$,'Hotel access changed'),'an old link cannot restore revoked access');
select set_config('request.jwt.claims','{"sub":"9755a000-0000-4000-8000-000000000001","session_id":"9755a000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.fresh_hotel_invitation',(public.create_hotel_team_invitation(97550001,'front_desk','authority_target','direct')->>'invitation_id'),true);
select set_config('request.jwt.claims','{"sub":"9755a000-0000-4000-8000-000000000002","session_id":"9755a000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.expect((public.respond_to_resource_invitation(current_setting('test.fresh_hotel_invitation')::uuid,true,null)->>'accepted')::boolean,'a fresh owner invitation can grant access');

select set_config('request.jwt.claims','{"sub":"9755a000-0000-4000-8000-000000000003","session_id":"9755a000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.block_friend('authority-b');
select set_config('request.jwt.claims','{"sub":"9755a000-0000-4000-8000-000000000004","session_id":"9755a000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select public.block_friend('authority-a');
select pg_temp.expect(jsonb_array_length(public.list_my_friends())=1,'the second blocker can manage their own block');
select set_config('request.jwt.claims','{"sub":"9755a000-0000-4000-8000-000000000003","session_id":"9755a000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.expect((public.unblock_friend('authority-b')->>'unblocked')::boolean,'one person can withdraw their own block');
select pg_temp.expect(jsonb_array_length(public.list_my_friends())=0,'the peer block still prevents restoring the connection');
select pg_temp.expect(not (public.unblock_friend('authority-b')->>'unblocked')::boolean,'one person cannot withdraw the remaining peer block');
reset role;
select pg_temp.expect((select status='blocked' and blocked_by='authority-b' and user_low_blocked_at is null and user_high_blocked_at is not null from public.friends where id='9755a000-3000-4000-8000-000000000001'),'independent peer block persists');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"9755a000-0000-4000-8000-000000000004","session_id":"9755a000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.expect((public.unblock_friend('authority-a')->>'restored')::boolean,'the last blocker can restore the accepted friendship');

select set_config('request.jwt.claims','{"sub":"9755a000-0000-4000-8000-000000000005","session_id":"9755a000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}',true);
select pg_temp.expect(private.admin_can_mutate_listing_media('listing-images','listings/9755a000-4000-4000-8000-000000000001/fixture.jpg'),'branch Admin can manage local media');
select pg_temp.expect(not private.admin_can_mutate_listing_media('listing-images','listings/9755a000-4000-4000-8000-000000000002/fixture.jpg'),'branch Admin cannot manage another branch');
select pg_temp.expect(not private.admin_can_mutate_listing_media('listing-images','listings/9755a000-4000-4000-8000-000000000003/fixture.jpg'),'branch Admin cannot manage another state');
select pg_temp.expect(pg_temp.denied($q$select public.reserve_my_media_upload('listing-images','listings/9755a000-4000-4000-8000-000000000003/new.jpg')$q$,'cannot upload'),'out-of-scope media is rejected before reserving budget');
with removed as(delete from storage.objects where id in('9755a000-5000-4000-8000-000000000001','9755a000-5000-4000-8000-000000000002','9755a000-5000-4000-8000-000000000003') returning id)
select pg_temp.expect(count(*)=1,'Storage DELETE applies the branch scope; removed '||count(*)) from removed;
with changed as(update storage.objects set name=name||'.changed' where id='9755a000-5000-4000-8000-000000000002' returning id)
select pg_temp.expect(count(*)=0,'Storage UPDATE cannot move another branch media') from changed;
select set_config('request.jwt.claims','{"sub":"9755a000-0000-4000-8000-000000000006","session_id":"9755a000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',true);
with removed as(delete from storage.objects where id in('9755a000-5000-4000-8000-000000000002','9755a000-5000-4000-8000-000000000003') returning id)
select pg_temp.expect(count(*)=2,'global Creator retains authorised recovery access') from removed;
reset role;
rollback;
