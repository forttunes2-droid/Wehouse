\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete) values
('aaaaaaaa-2209-4000-8000-000000000001','help-a@example.invalid','help-a','worker',true),
('aaaaaaaa-2209-4000-8000-000000000002','help-b@example.invalid','help-b','worker',true),
('aaaaaaaa-2209-4000-8000-000000000003','help-c@example.invalid','help-c','user',true);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status) values
('help-a','worker','global','active'),('help-b','worker','global','active');
insert into public.worker_bookings(id,user_id,worker_id,service_type,status) values
('bbbbbbbb-2209-4000-8000-000000000001','help-a','help-b','Abandoned attempt','cancelled'),
('bbbbbbbb-2209-4000-8000-000000000002','help-a','help-b','Failed payment','pending'),
('bbbbbbbb-2209-4000-8000-000000000003','help-a','help-b','Paid cancellation','cancelled'),
('bbbbbbbb-2209-4000-8000-000000000004','help-a','help-b','No payment attempt','pending'),
('bbbbbbbb-2209-4000-8000-000000000005','help-c','help-b','Another customer','pending'),
('bbbbbbbb-2209-4000-8000-000000000006','help-c','help-a','Provider work','pending');
insert into public.booking_payments(payment_reference,worker_booking_id,user_id,payer_user_id,amount,status,paid_at) values
('help-contract-abandoned','bbbbbbbb-2209-4000-8000-000000000001','help-a','help-a',100,'cancelled',null),
('help-contract-failed','bbbbbbbb-2209-4000-8000-000000000002','help-a','help-a',100,'failed',null),
('help-contract-paid','bbbbbbbb-2209-4000-8000-000000000003','help-a','help-a',100,'cancelled',now()),
('help-contract-foreign','bbbbbbbb-2209-4000-8000-000000000005','help-c','help-c',100,'paid',now()),
('help-contract-provider','bbbbbbbb-2209-4000-8000-000000000006','help-c','help-c',100,'failed',null);
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aaaaaaaa-2209-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare rows jsonb;
begin
  if has_function_privilege('anon','public.get_my_workspace_help_targets(text)','EXECUTE') then
    raise exception 'Anonymous Help access';
  end if;
  rows:=public.get_my_workspace_help_targets('personal');
  if jsonb_array_length(rows->'worker_jobs')<>4 then raise exception 'Help read removed historical jobs'; end if;
  if jsonb_array_length(rows->'payment_targets')<>2
    or not rows->'payment_targets' @> '[{"subject_id":"bbbbbbbb-2209-4000-8000-000000000002"},{"subject_id":"bbbbbbbb-2209-4000-8000-000000000003"}]'::jsonb then
    raise exception 'Payment Help lost a failed/paid attempt or included an abandoned/nonexistent/foreign payment';
  end if;
  if exists(select 1 from jsonb_array_elements(rows->'payment_targets') item
    where nullif(item->>'record_reference','') is null or item->>'record_date' is null) then
    raise exception 'Payment choices cannot distinguish repeated jobs';
  end if;
  if rows::text like '%booking_code%' or rows::text like '%payment_reference%' then
    raise exception 'Help projection leaked secret/provider references';
  end if;
  rows:=public.get_my_workspace_help_targets('worker');
  if jsonb_array_length(rows->'payment_targets')<>1
    or rows->'payment_targets'->0->>'subject_id'<>'bbbbbbbb-2209-4000-8000-000000000006' then
    raise exception 'Provider Help mixes customer purchases';
  end if;
  perform set_config('request.jwt.claim.sub','aaaaaaaa-2209-4000-8000-000000000003',true);
  rows:=public.get_my_workspace_help_targets('personal');
  if rows->'payment_targets' @> '[{"subject_id":"bbbbbbbb-2209-4000-8000-000000000003"}]'::jsonb then
    raise exception 'Another account can read a payment help target';
  end if;
  begin perform public.get_my_workspace_help_targets('worker'); raise exception 'Unassigned workspace access';
  exception when raise_exception then if sqlerrm<>'Workspace access required' then raise; end if; end;
end $$;
reset role;
update public.workspace_role_assignments set status='revoked',revoked_at=now()
where user_id='help-a' and workspace_role='worker';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-2209-4000-8000-000000000001',true);
do $$ begin
  begin perform public.get_my_workspace_help_targets('worker'); raise exception 'Revoked workspace access';
  exception when raise_exception then if sqlerrm<>'Workspace access required' then raise; end if; end;
  if jsonb_array_length(public.get_my_workspace_help_targets('personal')->'payment_targets')<>2 then
    raise exception 'Workspace revocation removed personal payment help';
  end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.worker_bookings where user_id in ('help-a','help-c'))<>6
    or (select count(*) from public.booking_payments where payment_reference like 'help-contract-%')<>5 then
    raise exception 'Help reads changed source records';
  end if;
end $$;
rollback;
