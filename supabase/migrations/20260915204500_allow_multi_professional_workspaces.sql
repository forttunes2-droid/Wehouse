begin;

-- Product vocabulary calls the `worker` workspace "Service Provider".  Keep the
-- database key for backwards-compatible history, migrations and API contracts.
-- Workspace activation is additive: it must never replace the Personal identity
-- or block a person from also holding another professional/assigned workspace.

create or replace function public.activate_my_worker_workspace()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and account_kind='consumer'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;

  if v_profile.user_id is null then
    raise exception 'Active Personal account required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('service-provider:'||v_profile.user_id,1));

  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at
  ) values(
    v_profile.user_id,'worker','global','active',now(),now(),now()
  )
  on conflict(user_id,workspace_role) where status='active'
  do update set updated_at=public.workspace_role_assignments.updated_at;

  -- Compatibility profile columns remain data fields only.  Do not replace the
  -- person's Personal identity or overwrite another compatibility role.
  update public.profiles
  set worker_status=coalesce(worker_status,'pending'),
      account_kind='consumer',
      updated_at=now()
  where user_id=v_profile.user_id;

  return jsonb_build_object(
    'success',true,
    'workspace','worker',
    'product_label','Service Provider',
    'state','onboarding',
    'free',true
  );
end;
$$;

revoke all on function public.activate_my_worker_workspace() from public,anon;
grant execute on function public.activate_my_worker_workspace() to authenticated,service_role;

create or replace function public.activate_my_property_partner_workspace()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_partner_code text;
begin
  select * into v_profile
  from public.profiles
  where auth_id=(select auth.uid())::text
    and account_kind='consumer'
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;

  if v_profile.user_id is null then
    raise exception 'Active Personal account required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('property-partner:'||v_profile.user_id,2));

  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,status,granted_at,created_at,updated_at
  ) values(
    v_profile.user_id,'property_partner','global','active',now(),now(),now()
  )
  on conflict(user_id,workspace_role) where status='active'
  do update set updated_at=public.workspace_role_assignments.updated_at;

  update public.profiles
  set account_kind='consumer',updated_at=now()
  where user_id=v_profile.user_id;

  v_partner_code:='WHP-'||replace(v_profile.user_id,'WHU-','')||'-'||
    upper(substr(md5(v_profile.user_id||clock_timestamp()::text),1,4));

  insert into public.property_partners(
    profile_id,partner_code,status,commission_rate,total_earnings,
    total_paid_out,properties_count,created_at,updated_at
  ) values(
    v_profile.user_id,v_partner_code,'pending_verification',0,0,0,0,now(),now()
  )
  on conflict(profile_id) do update
    set updated_at=public.property_partners.updated_at;

  return jsonb_build_object(
    'success',true,
    'workspace','property_partner',
    'state','onboarding'
  );
end;
$$;

revoke all on function public.activate_my_property_partner_workspace() from public,anon;
grant execute on function public.activate_my_property_partner_workspace() to authenticated,service_role;

comment on function public.activate_my_worker_workspace() is
  'Starts or resumes the Service Provider onboarding workspace on the existing Personal identity. Internal key worker is retained for compatibility.';
comment on function public.activate_my_property_partner_workspace() is
  'Starts or resumes Property Partner onboarding on the existing Personal identity without replacing any other workspace.';

commit;
