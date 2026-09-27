-- A provider recovery is bound to a previously linked identity and a NEW Auth session.
-- This verifies renewed provider-account ownership; it does not claim a fresh biometric scan.
begin;
alter table public.identity_provider_password_recovery_attempts
 add column if not exists linked_identity_id uuid,
 add column if not exists linked_provider_id text,
 add column if not exists cleanup_completed_at timestamptz;
-- Existing attempts do not have a frozen identity and cannot be used after upgrade.
create or replace function public.begin_identity_provider_password_recovery(
  p_identifier text,
  p_provider text default 'google'
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare
  v_attempt_id uuid:=gen_random_uuid();
  v_identifier text:=lower(nullif(btrim(p_identifier),''));
  v_provider text:=lower(nullif(btrim(p_provider),''));
  v_target_auth_id text;
  v_identity_id uuid;
  v_provider_id text;
begin
  if v_identifier is null or v_provider not in('google','apple') then
    return v_attempt_id;
  end if;

  select profile.auth_id into v_target_auth_id
  from public.profiles profile
  where (
      lower(coalesce(profile.email,''))=v_identifier
      or lower(coalesce(profile.username,''))=v_identifier
    )
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
    and exists(
      select 1
      from auth.identities identity_row
      where identity_row.user_id::text=profile.auth_id
        and identity_row.provider=v_provider
    )
  limit 1;

  -- Return the same shape for unknown, unlinked and rate-limited accounts.
  if v_target_auth_id is null then return v_attempt_id; end if;
  perform pg_advisory_xact_lock(hashtextextended('provider-recovery:'||v_target_auth_id,0));
  select id,provider_id into v_identity_id,v_provider_id from auth.identities
    where user_id::text=v_target_auth_id and provider=v_provider order by created_at,id limit 1;
  if v_identity_id is null or v_provider_id is null then return v_attempt_id; end if;
  if (
    select count(*)
    from public.identity_provider_password_recovery_attempts attempt
    where attempt.target_auth_id=v_target_auth_id
      and attempt.requested_at>now()-interval '15 minutes'
  )>=5 then return v_attempt_id; end if;

  insert into public.identity_provider_password_recovery_attempts(
    attempt_id,target_auth_id,provider,linked_identity_id,linked_provider_id
  ) values(v_attempt_id,v_target_auth_id,v_provider,v_identity_id,v_provider_id);
  return v_attempt_id;
end
$$;


create or replace function public._recovery_proof_is_current(p_attempt_id uuid)
returns boolean language sql stable security definer
set search_path='pg_catalog','public','auth' as $$
 select exists(
  select 1 from public.identity_provider_password_recovery_attempts a
  join auth.identities i on i.id=a.linked_identity_id and i.provider_id=a.linked_provider_id
   and i.provider=a.provider and i.user_id::text=a.target_auth_id
  join auth.sessions s on s.user_id=i.user_id and s.id::text=auth.jwt()->>'session_id'
  join public.profiles p on p.auth_id=a.target_auth_id
  where a.attempt_id=p_attempt_id and a.target_auth_id=auth.uid()::text
   and a.expires_at>now() and a.provider in('google','apple')
   and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
   and s.created_at>=a.requested_at and (s.not_after is null or s.not_after>now())
   and i.last_sign_in_at>=a.requested_at
   and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr')='array' then auth.jwt()->'amr' else '[]'::jsonb end) m
    where m->>'method'='oauth' and case when (m->>'timestamp') ~ '^[0-9]{1,12}$'
      then (m->>'timestamp')::bigint>=floor(extract(epoch from a.requested_at))
        and (m->>'timestamp')::bigint<=ceil(extract(epoch from now()))+30 else false end)
 );
$$;
revoke all on function public._recovery_proof_is_current(uuid) from public,anon,authenticated;
grant execute on function public._recovery_proof_is_current(uuid) to service_role;

create or replace function public.verify_identity_provider_password_recovery(p_attempt_id uuid,p_provider text default 'google')
returns jsonb language plpgsql security definer set search_path='pg_catalog','public','auth' as $$
begin
 if not public._recovery_proof_is_current(p_attempt_id) then
  raise exception 'Start recovery again and confirm with your previously linked provider'; end if;
 update public.identity_provider_password_recovery_attempts a set status='verified',verified_at=now(),
  verified_session_id=auth.jwt()->>'session_id'
 where a.attempt_id=p_attempt_id and a.target_auth_id=auth.uid()::text
  and a.provider=lower(btrim(p_provider)) and a.status='requested' and a.expires_at>now();
 if not found then raise exception 'Recovery confirmation expired or does not match'; end if;
 return jsonb_build_object('success',true,'provider',lower(btrim(p_provider)));
end $$;

create or replace function public.claim_identity_provider_password_recovery(p_attempt_id uuid)
returns text language plpgsql security definer set search_path='pg_catalog','public','auth' as $$
declare result text;
begin
 if not public._recovery_proof_is_current(p_attempt_id) then raise exception 'Fresh provider confirmation required'; end if;
 update public.identity_provider_password_recovery_attempts a set status='processing',processing_at=now()
 where a.attempt_id=p_attempt_id and a.target_auth_id=auth.uid()::text and a.status='verified'
  and a.verified_session_id=auth.jwt()->>'session_id' and a.expires_at>now()
 returning a.target_auth_id into result;
 if result is null then raise exception 'Verified recovery confirmation required'; end if;
 return result;
end $$;

create or replace function public.finish_identity_provider_password_recovery(p_attempt_id uuid,p_auth_id text,p_succeeded boolean)
returns boolean language plpgsql security definer set search_path='pg_catalog','public','auth' as $$
declare a public.identity_provider_password_recovery_attempts; profile_id text;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
 select * into a from public.identity_provider_password_recovery_attempts
  where attempt_id=p_attempt_id and target_auth_id=p_auth_id for update;
 if a.attempt_id is null then return false; end if;
 if a.status='consumed' then return p_succeeded and a.cleanup_completed_at is not null; end if;
 if a.status<>'processing' then return false; end if;
 -- Never reopen a claim after an uncertain network outcome. New proof is required.
 if not p_succeeded then
  update public.identity_provider_password_recovery_attempts set status='consumed',consumed_at=now()
   where attempt_id=p_attempt_id;
  return true;
 end if;
 -- Verify the real Auth session store, not only our device-history table or a returned HTTP status.
 if exists(select 1 from auth.sessions where user_id::text=p_auth_id) then return false; end if;
 update public.user_sessions set is_active=false,is_current=false,logout_time=now()
  where auth_id=p_auth_id and is_active=true;
 select user_id into profile_id from public.profiles where auth_id=p_auth_id limit 1;
 if profile_id is not null then
  insert into public.user_activity(user_id,auth_id,action_type,details)
   values(profile_id,p_auth_id,'password_change',jsonb_build_object('source','linked_identity_recovery','attempt_id',p_attempt_id));
 end if;
 update public.identity_provider_password_recovery_attempts set status='consumed',consumed_at=now(),cleanup_completed_at=now()
  where attempt_id=p_attempt_id;
 return true;
end $$;

create or replace function public.auth_session_is_active(p_auth_id uuid,p_session_id uuid)
returns boolean language sql stable security definer set search_path='pg_catalog','auth' as $$
 select exists(select 1 from auth.sessions where id=p_session_id and user_id=p_auth_id
  and (not_after is null or not_after>now()));
$$;
revoke all on function public.auth_session_is_active(uuid,uuid) from public,anon,authenticated;
grant execute on function public.auth_session_is_active(uuid,uuid) to service_role;

insert into public.function_execution_registry(function_signature,function_name,security_mode,public_allowed,anon_allowed,authenticated_allowed,service_role_allowed,review_state,rationale,captured_at)
select p.oid::regprocedure::text,p.proname,'definer',false,false,false,true,'approved_service_only',
 'Recovery proof and sensitive-operation session validation; never a public session enumeration endpoint',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in('_recovery_proof_is_current','auth_session_is_active')
on conflict(function_signature) do update set public_allowed=false,anon_allowed=false,authenticated_allowed=false,
 service_role_allowed=true,review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();
commit;
