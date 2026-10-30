begin;
-- Short-lived proofs only. Accounts and device history retain their existing authorities.
create table public.email_account_challenges(
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check(purpose in ('device_confirmation','password_recovery')),
  device_session_id uuid references public.user_sessions(id) on delete cascade,
  device_id text,
  auth_session_id uuid,
  code_hash text not null check(code_hash ~ '^[0-9a-f]{64}$'),
  proof_verified_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '10 minutes',
  attempts integer not null default 0 check(attempts between 0 and 5),
  status text not null default 'sending' check(status in ('sending','pending','processing','consumed')),
  cleanup_completed_at timestamptz,
  check((purpose='device_confirmation' and device_session_id is not null and device_id is not null and auth_session_id is not null)
    or (purpose='password_recovery' and device_session_id is null and device_id is null and auth_session_id is null))
);
create index email_account_challenges_expiry_idx on public.email_account_challenges(expires_at);
alter table public.email_account_challenges enable row level security;
revoke all on public.email_account_challenges from public,anon,authenticated;
grant all on public.email_account_challenges to service_role;

create function public.claim_email_account_challenge(p_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.email_account_challenges;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
  update public.email_account_challenges set attempts=attempts+1,status='processing'
  where id=p_id and purpose=p_purpose and status='pending' and attempts<5 and expires_at>now()
  returning * into c;
  if c.id is null then return null; end if;
  return to_jsonb(c);
end; $$;

create function public.finish_email_device_confirmation(p_id uuid,p_auth_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare c public.email_account_challenges; target public.user_sessions;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
  select * into c from public.email_account_challenges where id=p_id for update;
  if c.id is null or c.purpose<>'device_confirmation' or c.status<>'processing' or c.expires_at<=now()
    or c.proof_verified_at is null or p_auth_session_id is distinct from c.auth_session_id then
    raise exception 'Confirmation expired. Request a new code';
  end if;
  if not exists(select 1 from auth.sessions s
    where s.id=p_auth_session_id and s.user_id=c.auth_id and (s.not_after is null or s.not_after>now())
      ) then
    raise exception 'Fresh email confirmation required';
  end if;
  select * into target from public.user_sessions where id=c.device_session_id
    and auth_id=c.auth_id::text and auth_session_id=c.auth_session_id::text
    and device_id=c.device_id and is_active and trust_status='pending' for update;
  if target.id is null then raise exception 'This device login is no longer pending'; end if;
  if not exists(select 1 from public.profiles where user_id=target.user_id and auth_id=c.auth_id::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then
    raise exception 'Active account required';
  end if;
  update public.user_sessions set trust_status='trusted',trust_reviewed_at=now(),
    auth_session_id=p_auth_session_id::text,is_current=true,last_seen=now() where id=target.id;
  update public.notifications set type='new_device_login',title='New device signed in',
    read=false,read_at=null,destination_route='security',
    message=concat_ws(' · ',target.device,target.os,target.browser),
    destination_params=coalesce(destination_params,'{}'::jsonb)||jsonb_build_object('decision','unreviewed')
    where recipient_id=target.user_id and source_id=target.id::text
      and type in ('new_device_login','device_confirmation_pending');
  update public.email_account_challenges set status='consumed',cleanup_completed_at=now() where id=c.id;
  return jsonb_build_object('session_id',target.id,'trust_status','trusted');
end; $$;

create function public.finish_email_password_recovery(p_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare c public.email_account_challenges; profile_id text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
  select * into c from public.email_account_challenges where id=p_id for update;
  if c.id is null or c.purpose<>'password_recovery' then return false; end if;
  if c.status='consumed' then return c.cleanup_completed_at is not null; end if;
  if c.status<>'processing' or c.proof_verified_at is null then return false; end if;
  if exists(select 1 from auth.sessions where user_id=c.auth_id) then return false; end if;
  update public.user_sessions set is_active=false,is_current=false,logout_time=now()
    where auth_id=c.auth_id::text and is_active;
  select user_id into profile_id from public.profiles where auth_id=c.auth_id::text;
  if profile_id is not null then
    insert into public.user_activity(user_id,auth_id,action_type,details)
      values(profile_id,c.auth_id::text,'password_change',jsonb_build_object('source','email_recovery','attempt_id',c.id));
  end if;
  update public.email_account_challenges set status='consumed',cleanup_completed_at=now() where id=c.id;
  return true;
end; $$;
revoke all on function public.claim_email_account_challenge(uuid,text) from public,anon,authenticated;
revoke all on function public.finish_email_device_confirmation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_email_password_recovery(uuid) from public,anon,authenticated;
grant execute on function public.claim_email_account_challenge(uuid,text) to service_role;
grant execute on function public.finish_email_device_confirmation(uuid,uuid) to service_role;
grant execute on function public.finish_email_password_recovery(uuid) to service_role;
-- Provider sign-in is not an alternative route around the email device proof.
revoke execute on function public.confirm_current_device_with_google(uuid,text) from public,anon,authenticated;
commit;
