\set ON_ERROR_STOP on
begin;

set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,username,role,profile_complete,full_name,account_kind)
values ('f7110000-0000-4000-8000-000000000001','managed-owner@example.invalid','managed-owner','managed-owner','user',true,'Managed Owner','consumer');
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values ('managed-owner','property_partner','global','active');
insert into public.inspection_requests(id,request_code,owner_id,owner_email,property_type,property_address,property_city,property_state,status)
values ('f7110000-1000-4000-8000-000000000001','WHIR-MANAGEMENT','managed-owner','managed-owner@example.invalid','apartment','1 Test Street','Ikeja','Lagos','pending');
insert into public.listings(id,listing_id,title,sub_type,state,city,status,availability_status,owner_id,partner_id,inspection_request_id,management_updated_at)
values ('f7110000-2000-4000-8000-000000000001','managed-draft-home','Managed draft home','short_let','Lagos','Ikeja','available','available','managed-owner','managed-owner','f7110000-1000-4000-8000-000000000001',now());
update public.inspection_requests set draft_listing_id='f7110000-2000-4000-8000-000000000001'
where id='f7110000-1000-4000-8000-000000000001';
insert into public.property_host_assignments(assignment_id,listing_id,user_id,assignment_role,status,invited_by,accepted_at,access_level)
values ('f7110000-3000-4000-8000-000000000001','f7110000-2000-4000-8000-000000000001','managed-owner','owner','active','managed-owner',now(),'full_hosting');
set local session_replication_role=origin;

do $$ begin
  begin
    update public.listings set approved_at=now() where id='f7110000-2000-4000-8000-000000000001';
    raise exception 'Published without management choice';
  exception when raise_exception then
    if sqlerrm not like 'Property Partner must choose%' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f7110000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
  perform public.set_my_property_request_management_mode('f7110000-1000-4000-8000-000000000001','host');
  if (select management_mode from public.listings where id='f7110000-2000-4000-8000-000000000001') <> 'host'
     or (select management_updated_at from public.listings where id='f7110000-2000-4000-8000-000000000001') is null then
    raise exception 'Prepublication choice was not applied to the linked draft';
  end if;
end $$;
reset role;
update public.listings set approved_at=now() where id='f7110000-2000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  begin
    perform public.set_my_property_management_mode('f7110000-2000-4000-8000-000000000001','wehouse');
    raise exception 'Live operator changed without a reviewed handoff';
  exception when raise_exception then
    if sqlerrm not like 'This live home has an operator%' then raise; end if;
  end;
  begin
    perform public.set_my_property_request_management_mode('f7110000-1000-4000-8000-000000000001','wehouse');
    raise exception 'Published request changed operator';
  exception when raise_exception then
    if sqlerrm not like 'A live home cannot change operator%' then raise; end if;
  end;
end $$;

reset role;
do $$ begin
  if exists(select 1 from storage.buckets where id in ('listing-videos','worker-showcase','listing-candidates')
    and file_size_limit <> 13000000) then
    raise exception 'Public media bucket is not bounded';
  end if;
  if exists(select 1 from storage.buckets where id in ('property-access-private','worker-verification-videos','worker-files')
    and file_size_limit <> 13000000) then
    raise exception 'Private evidence video bucket is not bounded';
  end if;
end $$;
rollback;
