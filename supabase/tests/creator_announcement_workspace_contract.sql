\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,state,local_government)
values
  ('77777777-2222-4222-8222-000000000901','creator-announcement@example.invalid','announcement-creator','creator',true,'creator','Lagos','Ikeja'),
  ('77777777-2222-4222-8222-000000000902','announcement-user@example.invalid','announcement-user','user',true,'consumer','Lagos','Ikeja'),
  ('77777777-2222-4222-8222-000000000903','announcement-worker@example.invalid','announcement-worker','user',true,'consumer','Lagos','Ikeja'),
  ('77777777-2222-4222-8222-000000000904','announcement-worker-outside@example.invalid','announcement-worker-outside','user',true,'consumer','Lagos','Epe'),
  ('77777777-2222-4222-8222-000000000905','announcement-staff@example.invalid','announcement-staff','user',true,'consumer','Lagos','Ikeja'),
  ('77777777-2222-4222-8222-000000000906','announcement-staff-state@example.invalid','announcement-staff-state','user',true,'consumer','Lagos','Yaba'),
  ('77777777-2222-4222-8222-000000000907','announcement-dual@example.invalid','announcement-dual','user',true,'consumer','Lagos','Ikeja'),
  ('77777777-2222-4222-8222-000000000908','announcement-staff-outside@example.invalid','announcement-staff-outside','user',true,'consumer','Lagos','Epe'),
  ('77777777-2222-4222-8222-000000000909','announcement-revoked@example.invalid','announcement-revoked','user',true,'consumer','Lagos','Ikeja');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,status)
values
  ('announcement-worker','worker','global',null,null,'active'),
  ('announcement-worker-outside','worker','global',null,null,'active'),
  ('announcement-staff','staff','branch','Lagos','Ikeja','active'),
  ('announcement-staff-state','staff','state','Lagos',null,'active'),
  ('announcement-dual','worker','global',null,null,'active'),
  ('announcement-dual','staff','branch','Lagos','Ikeja','active'),
  ('announcement-staff-outside','staff','branch','Lagos','Epe','active'),
  ('announcement-revoked','worker','global',null,null,'revoked');
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','77777777-2222-4222-8222-000000000901',true);
set local role authenticated;
do $$
declare
  count_value bigint;
  sent jsonb;
  delivered integer;
begin
  count_value:=public.creator_count_announcement_recipients(array['user'],'Lagos','Ikeja');
  if count_value<>1 then raise exception 'Consumer-only audience included additive workspaces or missed its scoped consumer: %',count_value; end if;

  count_value:=public.creator_count_announcement_recipients(array['worker'],'Lagos','Ikeja');
  if count_value<>2 then raise exception 'Worker audience did not follow active Worker workspaces and profile locations: %',count_value; end if;

  count_value:=public.creator_count_announcement_recipients(array['staff'],'Lagos','Ikeja');
  if count_value<>3 then raise exception 'Staff audience did not use branch/state workspace coverage: %',count_value; end if;

  count_value:=public.creator_count_announcement_recipients(array['worker','staff'],'Lagos','Ikeja');
  if count_value<>4 then raise exception 'Combined audience count double-counted a multi-workspace person or included an out-of-area recipient: %',count_value; end if;

  count_value:=public.creator_count_announcement_recipients(array['user'],null,null,array['announcement-worker']);
  if count_value<>1 then raise exception 'Specific-recipient count incorrectly depended on the primary profile role: %',count_value; end if;

  sent:=public.creator_send_announcement('Scoped operations update','Test message',array['worker','staff'],null,'Lagos','Ikeja');
  if (sent->>'recipient_count')::integer<>4 then raise exception 'Send result differs from preview count: %',sent; end if;
  select count(*) into delivered from public.announcement_recipients where announcement_id=(sent->>'id')::bigint;
  if delivered<>4 then raise exception 'Announcement fan-out differs from its result: %',delivered; end if;

  sent:=public.creator_send_announcement('Direct update','Selected person only',array['user'],array['announcement-worker'],null,null);
  if (sent->>'recipient_count')::integer<>1 then raise exception 'Selected recipient was excluded by their profile role: %',sent; end if;
end
$$;
reset role;
select set_config('request.jwt.claim.sub','77777777-2222-4222-8222-000000000902',true);
set local role authenticated;
do $$
begin
  begin
    perform public.creator_count_announcement_recipients(array['user']);
    raise exception 'A non-Creator counted announcement recipients';
  exception when raise_exception then
    if sqlerrm<>'Creator workspace required' then raise; end if;
  end;
end
$$;
reset role;
rollback;
