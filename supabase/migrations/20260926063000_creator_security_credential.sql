-- Separate Creator security credential from the normal WeHouse login password.
-- TOTP remains an independent factor. Passkeys can be added after their recovery
-- and relying-party configuration are accepted without changing this boundary.

create table if not exists public.creator_security_credentials(
  creator_user_id text primary key references public.profiles(user_id) on delete cascade,
  auth_user_id text not null unique,
  secret_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz,
  constraint creator_security_failed_attempts_check check(failed_attempts between 0 and 20)
);
alter table public.creator_security_credentials enable row level security;
revoke all on public.creator_security_credentials from anon,authenticated;

create or replace function public.creator_security_status()
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare
  v_profile public.profiles;
  v_enrolled boolean;
  v_totp boolean;
  v_locked timestamptz;
begin
  select * into v_profile from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_profile.user_id is null
     or not public.user_has_active_workspace(v_profile.user_id,'creator') then
    raise exception 'Creator authority required';
  end if;

  select true,locked_until into v_enrolled,v_locked
  from public.creator_security_credentials
  where creator_user_id=v_profile.user_id;
  select exists(
    select 1 from auth.mfa_factors f
    where f.user_id=auth.uid()
      and f.factor_type::text='totp'
      and f.status::text='verified'
  ) into v_totp;

  return jsonb_build_object(
    'enrolled',coalesce(v_enrolled,false),
    'totp_enrolled',coalesce(v_totp,false),
    'locked_until',case when v_locked>now() then v_locked else null end
  );
end
$$;
revoke all on function public.creator_security_status() from public,anon;
grant execute on function public.creator_security_status() to authenticated,service_role;

create or replace function public.set_creator_security_secret_from_service(
  p_auth_user_id uuid,p_secret text
) returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare v_profile public.profiles;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  if char_length(coalesce(p_secret,''))<12 or char_length(p_secret)>128 then
    raise exception 'Creator security password must be 12 to 128 characters';
  end if;
  select * into v_profile from public.profiles p
  where p.auth_id=p_auth_user_id::text
    and exists(
      select 1 from public.workspace_role_assignments w
      where w.user_id=p.user_id and w.workspace_role='creator'
        and w.status='active' and w.revoked_at is null and w.scope_type='global'
    )
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;
  if v_profile.user_id is null then raise exception 'Creator authority required'; end if;

  insert into public.creator_security_credentials(
    creator_user_id,auth_user_id,secret_hash,failed_attempts,locked_until,
    enrolled_at,updated_at,last_verified_at
  ) values(
    v_profile.user_id,p_auth_user_id::text,
    extensions.crypt(p_secret,extensions.gen_salt('bf',12)),
    0,null,now(),now(),null
  ) on conflict(creator_user_id) do update set
    auth_user_id=excluded.auth_user_id,
    secret_hash=excluded.secret_hash,
    failed_attempts=0,
    locked_until=null,
    updated_at=now(),
    last_verified_at=null;

  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
  values(
    v_profile.user_id,'creator_security_credential_set','creator_security',
    v_profile.user_id,jsonb_build_object('auth_user_id',p_auth_user_id)::text,now()
  );
  return true;
end
$$;
revoke all on function public.set_creator_security_secret_from_service(uuid,text)
from public,anon,authenticated;
grant execute on function public.set_creator_security_secret_from_service(uuid,text) to service_role;

create or replace function public.verify_creator_security_secret_from_service(
  p_auth_user_id uuid,p_secret text
) returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_profile public.profiles;
  v_credential public.creator_security_credentials;
  v_ok boolean:=false;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  select * into v_profile from public.profiles p
  where p.auth_id=p_auth_user_id::text
    and exists(
      select 1 from public.workspace_role_assignments w
      where w.user_id=p.user_id and w.workspace_role='creator'
        and w.status='active' and w.revoked_at is null and w.scope_type='global'
    )
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;
  if v_profile.user_id is null then return false; end if;

  select * into v_credential from public.creator_security_credentials
  where creator_user_id=v_profile.user_id for update;
  if v_credential.creator_user_id is null then return false; end if;
  if v_credential.locked_until is not null and v_credential.locked_until>now() then
    return false;
  end if;

  v_ok:=extensions.crypt(coalesce(p_secret,''),v_credential.secret_hash)=v_credential.secret_hash;
  if v_ok then
    update public.creator_security_credentials
    set failed_attempts=0,locked_until=null,last_verified_at=now(),updated_at=now()
    where creator_user_id=v_profile.user_id;
    return true;
  end if;

  update public.creator_security_credentials
  set failed_attempts=least(failed_attempts+1,20),
      locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else null end,
      updated_at=now()
  where creator_user_id=v_profile.user_id;
  return false;
end
$$;
revoke all on function public.verify_creator_security_secret_from_service(uuid,text)
from public,anon,authenticated;
grant execute on function public.verify_creator_security_secret_from_service(uuid,text) to service_role;

create or replace function public.issue_creator_elevation_from_service(
  p_auth_user_id uuid,
  p_auth_session_id text,
  p_action_classes text[],
  p_verification_method text,
  p_ip_hash text default null
) returns uuid language plpgsql security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare
  v_creator public.profiles;
  v_id uuid;
  v_totp boolean;
  v_expected text;
  v_high_risk boolean;
begin
  if (select auth.role())<>'service_role' then raise exception 'service role required'; end if;
  if coalesce(cardinality(p_action_classes),0)=0 then
    raise exception 'At least one action class is required';
  end if;

  select * into v_creator from public.profiles p
  where p.auth_id=p_auth_user_id::text
    and exists(
      select 1 from public.workspace_role_assignments w
      where w.user_id=p.user_id and w.workspace_role='creator'
        and w.status='active' and w.revoked_at is null and w.scope_type='global'
    )
    and exists(
      select 1 from public.creator_security_credentials c
      where c.creator_user_id=p.user_id
    )
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;
  if v_creator.user_id is null then raise exception 'Creator security enrollment required'; end if;

  select exists(
    select 1 from auth.mfa_factors f
    where f.user_id=p_auth_user_id
      and f.factor_type::text='totp'
      and f.status::text='verified'
  ) into v_totp;
  v_expected:=case when v_totp then 'creator_secret_mfa' else 'creator_secret' end;
  if p_verification_method<>v_expected then
    raise exception 'Creator security assurance does not match enrolled factors';
  end if;

  v_high_risk:=exists(
    select 1 from unnest(p_action_classes) action_name
    where action_name in ('staff_authority','finance_exception','clean_launch_reset')
  );
  if v_high_risk and not v_totp then
    raise exception 'Authenticator verification is required for this Creator action';
  end if;

  update public.creator_elevation_grants
  set revoked_at=now()
  where auth_user_id=p_auth_user_id
    and auth_session_id=p_auth_session_id
    and revoked_at is null;

  insert into public.creator_elevation_grants(
    creator_user_id,auth_user_id,auth_session_id,action_classes,
    issued_at,expires_at,verification_method,issued_ip_hash
  ) values(
    v_creator.user_id,p_auth_user_id,p_auth_session_id,
    array(select distinct unnest(p_action_classes)),
    now(),now()+interval '10 minutes',v_expected,p_ip_hash
  ) returning creator_elevation_id into v_id;

  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_creator.user_id,'creator_elevation_issued','creator_session',
    p_auth_session_id,jsonb_build_object(
      'creator_elevation_id',v_id,
      'action_classes',p_action_classes,
      'verification_method',v_expected,
      'expires_at',now()+interval '10 minutes'
    )::text,now()
  );
  return v_id;
end
$$;
revoke all on function public.issue_creator_elevation_from_service(
  uuid,text,text[],text,text
) from public,anon,authenticated;
grant execute on function public.issue_creator_elevation_from_service(
  uuid,text,text[],text,text
) to service_role;
