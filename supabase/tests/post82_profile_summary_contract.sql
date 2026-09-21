\set ON_ERROR_STOP on
begin;

set local session_replication_role=replica;
insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,account_kind,state,city,local_government
) values (
  '77777777-8215-4000-8000-000000000001',
  'post82-creator@example.invalid',
  'post82-creator',
  'user',true,'consumer','Nasarawa','Lafia','Lafia'
);
insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,status
) values ('post82-creator','creator','global','active');
set local session_replication_role=origin;

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','77777777-8215-4000-8000-000000000001',true);
set local role authenticated;

select set_config(
  'wh.post82.worker_baseline',
  public.creator_get_dashboard_summary()::text,
  true
);

reset role;
set local session_replication_role=replica;

insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,account_kind,state,city,local_government,
  worker_status,worker_verified
) values
(
  '77777777-8215-4000-8000-000000000010',
  'post82-staff@example.invalid',
  'post82-staff',
  'user',true,'consumer','Nasarawa','Lafia','Lafia',null,false
),
(
  '77777777-8215-4000-8000-000000000011',
  'post82-reviewed-worker@example.invalid',
  'post82-reviewed-worker',
  'user',true,'consumer','Nasarawa','Lafia','Lafia','verified',true
),
(
  '77777777-8215-4000-8000-000000000012',
  'post82-review-worker@example.invalid',
  'post82-review-worker',
  'user',true,'consumer','Nasarawa','Lafia','Lafia','profile_under_review',false
);

insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,scope_state,scope_lga,status
) values
('post82-staff','staff','branch','Nasarawa','Lafia','active'),
('post82-reviewed-worker','worker','global',null,null,'active'),
('post82-review-worker','worker','global',null,null,'active');

insert into public.staff_permissions(
  staff_id,permission,granted_by,is_active
) values ('post82-staff','operations','post82-creator',true);

set local session_replication_role=origin;
set local role authenticated;

do $$
declare
  profile_record jsonb;
  baseline jsonb:=current_setting('wh.post82.worker_baseline')::jsonb;
  summary jsonb;
begin
  profile_record:=public.get_internal_profile_record('post82-staff');

  if jsonb_array_length(coalesce(profile_record->'wehouse_team','[]'::jsonb))<>1 then
    raise exception 'Internal Staff profile did not return exactly one active Team grant';
  end if;

  if profile_record#>>'{wehouse_team,0,permission}'<>'operations' then
    raise exception 'Internal Staff profile did not read the current granted permission';
  end if;

  summary:=public.creator_get_dashboard_summary();

  if (summary->>'workers')::bigint<>(baseline->>'workers')::bigint+2 then
    raise exception 'Worker total did not count identities once';
  end if;
  if (summary->>'workers_reviewed')::bigint
       <>coalesce((baseline->>'workers_reviewed')::bigint,0)+1 then
    raise exception 'Reviewed Worker bucket is not mutually understandable';
  end if;
  if (summary->>'workers_under_review')::bigint
       <>coalesce((baseline->>'workers_under_review')::bigint,0)+1 then
    raise exception 'In-review Worker bucket is not mutually understandable';
  end if;
  if (summary->>'pending_reviews')::bigint
       <> (summary->>'workers_under_review')::bigint then
    raise exception 'Pending review compatibility count diverged from In review';
  end if;
end
$$;

rollback;
