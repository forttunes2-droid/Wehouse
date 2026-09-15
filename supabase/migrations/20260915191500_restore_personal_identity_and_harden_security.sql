begin;

-- Canonical identity model: one Personal consumer identity may carry additive
-- Worker, Property Partner, Hotel Team or WeHouse Team workspaces. A privileged
-- compatibility role never turns the person into a separate account type.
update public.profiles
set account_kind='consumer',updated_at=now()
where account_kind is distinct from 'consumer';

create or replace function public.get_my_workspace_access()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select jsonb_build_object(
    'identity',jsonb_build_object(
      'user_id',profile.user_id,
      'account_kind','consumer',
      'compatibility_role',profile.role
    ),
    'personal_workspace',
      not coalesce(profile.deleted,false)
      and not coalesce(profile.suspended,false)
      and not coalesce(profile.banned,false),
    'privileged_workspaces',coalesce((
      select jsonb_agg(workspace.item order by workspace.item->>'role')
      from (
        select jsonb_build_object(
          'role',assignment.workspace_role,
          'scope_type',assignment.scope_type,
          'state',assignment.scope_state,
          'lga',assignment.scope_lga
        ) as item
        from public.workspace_role_assignments assignment
        where assignment.user_id=profile.user_id
          and assignment.status='active'
          and assignment.workspace_role in(
            'worker','property_partner','staff','admin','creator'
          )
        union all
        select jsonb_build_object(
          'role','hotel','scope_type','hotel','state',null,'lga',null
        )
        where exists(
          select 1 from public.hotel_team_members team
          where team.member_user_id=profile.user_id and team.status='active'
        )
      ) workspace
    ),'[]'::jsonb)
  )
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text;
$$;

revoke all on function public.get_my_workspace_access() from public,anon;
grant execute on function public.get_my_workspace_access() to authenticated,service_role;

-- Creator bootstrap is service-only, exact-identity, one-time and audited. The
-- Creator authority is an additive workspace on the same Personal identity.
create or replace function public.bootstrap_first_creator_from_service(
  p_auth_user_id uuid,
  p_expected_email text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','auth'
as $$
declare
  v_auth_email text;
  v_auth_confirmed_at timestamptz;
  v_profile public.profiles;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_auth_user_id is null or nullif(lower(btrim(p_expected_email)),'') is null then
    raise exception 'Exact Auth user ID and email are required';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 12 then
    raise exception 'A specific bootstrap reason is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('wehouse:first-creator-bootstrap'));

  select lower(btrim(auth_user.email)),auth_user.email_confirmed_at
  into v_auth_email,v_auth_confirmed_at
  from auth.users auth_user
  where auth_user.id=p_auth_user_id;
  if v_auth_email is null then raise exception 'Auth user not found'; end if;
  if v_auth_confirmed_at is null then
    raise exception 'Creator email must be confirmed first';
  end if;
  if v_auth_email<>lower(btrim(p_expected_email)) then
    raise exception 'Auth user ID and expected email do not match';
  end if;

  select * into v_profile
  from public.profiles profile
  where profile.auth_id=p_auth_user_id::text
  for update;
  if v_profile.user_id is null then
    raise exception 'Create the Personal identity before Creator bootstrap';
  end if;
  if lower(btrim(v_profile.email))<>v_auth_email then
    raise exception 'Personal identity and Auth email do not match';
  end if;
  if coalesce(v_profile.deleted,false)
     or coalesce(v_profile.suspended,false)
     or coalesce(v_profile.banned,false) then
    raise exception 'Creator bootstrap requires an active Personal identity';
  end if;
  if exists(
    select 1 from public.workspace_role_assignments assignment
    where assignment.user_id=v_profile.user_id
      and assignment.status='active'
      and assignment.workspace_role in('worker','property_partner')
  ) then
    raise exception 'Bootstrap a clean Personal identity, not a marketplace professional workspace';
  end if;
  if exists(
    select 1 from public.workspace_role_assignments assignment
    where assignment.workspace_role='creator'
      and assignment.status='active'
      and assignment.user_id<>v_profile.user_id
  ) then
    raise exception 'A different active Creator is already configured';
  end if;

  update public.profiles
  set role='creator',account_kind='consumer',updated_at=now()
  where user_id=v_profile.user_id;

  insert into public.workspace_role_assignments(
    user_id,workspace_role,scope_type,scope_state,scope_lga,status,
    granted_by,granted_at,created_at,updated_at
  ) values(
    v_profile.user_id,'creator','global',null,null,'active',
    null,now(),now(),now()
  )
  on conflict(user_id,workspace_role) where status='active'
  do update set
    scope_type='global',scope_state=null,scope_lga=null,updated_at=now();

  insert into public.admin_audit_log(
    admin_id,admin_email,action,target_type,target_id,details,created_at
  ) values(
    v_profile.user_id,v_auth_email,'FIRST_CREATOR_BOOTSTRAPPED',
    'creator_identity',v_profile.user_id,
    jsonb_build_object(
      'auth_user_id',p_auth_user_id,
      'reason',btrim(p_reason),
      'method','service_role_exact_identity',
      'personal_workspace_retained',true
    )::text,now()
  );

  return jsonb_build_object(
    'success',true,
    'user_id',v_profile.user_id,
    'email',v_auth_email,
    'workspace','creator',
    'scope','global',
    'account_kind','consumer',
    'personal_workspace',true
  );
end
$$;

revoke all on function public.bootstrap_first_creator_from_service(uuid,text,text)
from public,anon,authenticated;
grant execute on function public.bootstrap_first_creator_from_service(uuid,text,text)
to service_role;

-- Public account creation always creates Personal only. The p_role argument is
-- retained for compatibility with older clients but is deliberately ignored.
create or replace function public.create_my_profile(
  p_email text,
  p_role text default 'user'
)
returns public.profiles
language plpgsql
security definer
set search_path to 'pg_catalog','public','extensions'
as $$
declare
  v_profile public.profiles;
  v_auth_id text:=(select auth.uid())::text;
  v_email text:=lower(trim(coalesce((select auth.jwt()->>'email'),p_email)));
  v_user_id text;
  v_username text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into v_profile from public.profiles where auth_id=v_auth_id;
  if v_profile.user_id is not null then return v_profile; end if;
  if v_email is null or v_email='' then raise exception 'Authenticated email is required'; end if;
  if exists(
    select 1 from public.profiles profile
    where lower(profile.email)=v_email and profile.auth_id<>v_auth_id
  ) then
    raise exception 'This email is already linked to another WeHouse identity. Contact WeHouse Support.';
  end if;

  v_user_id:='WHU-'||lpad(nextval('public.wehouse_user_id_seq')::text,8,'0');
  v_username:=regexp_replace(split_part(v_email,'@',1),'[^a-z0-9_]','','g');
  if length(v_username)<3 then v_username:='member'; end if;
  v_username:=left(v_username,15)||substr(v_user_id,length(v_user_id)-4);

  insert into public.profiles(
    auth_id,email,username,role,user_id,profile_complete,worker_status,account_kind
  ) values(
    v_auth_id,v_email,v_username,'user',v_user_id,false,null,'consumer'
  ) returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.create_my_profile(text,text) from public,anon;
grant execute on function public.create_my_profile(text,text) to authenticated,service_role;

-- Payment verification and arbitrary wallet credits are server-authoritative.
-- They must never be direct browser RPCs, even if their bodies also self-check.
revoke all on function public.confirm_booking_payment(text,text,numeric,text,text)
from public,anon,authenticated;
grant execute on function public.confirm_booking_payment(text,text,numeric,text,text)
to service_role;

revoke all on function public.credit_wallet(uuid,numeric,text,text)
from public,anon,authenticated;
grant execute on function public.credit_wallet(uuid,numeric,text,text)
to service_role;

-- Trigger helpers are not RPCs. Date-of-birth entry is authenticated self-service.
revoke execute on function public.require_adult_before_profile_completion()
from public,anon,authenticated;
grant execute on function public.require_adult_before_profile_completion() to service_role;
revoke execute on function public.set_my_date_of_birth(date) from public,anon;
grant execute on function public.set_my_date_of_birth(date) to authenticated,service_role;

-- A forgotten Inbox passcode cannot decrypt the old private key. Reset therefore
-- rotates the user's E2EE identity and clears conversation-key envelopes involving
-- that user so future messages can establish fresh keys. Existing ciphertext is
-- preserved but may be unreadable after the user deliberately resets the passcode.
create or replace function public.reset_my_encryption_identity(
  p_public_key_jwk jsonb,
  p_encrypted_private_key text,
  p_backup_iv text,
  p_backup_salt text,
  p_kdf_iterations integer default 600000
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text:=public.current_profile_user_id();
  v_next_version integer;
begin
  if v_user_id is null then raise exception 'Authenticated profile required'; end if;
  if p_kdf_iterations<>600000 then raise exception 'Unsupported key derivation settings'; end if;
  if coalesce(p_public_key_jwk->>'kty','')<>'EC'
     or coalesce(p_public_key_jwk->>'crv','')<>'P-256'
     or nullif(p_public_key_jwk->>'x','') is null
     or nullif(p_public_key_jwk->>'y','') is null then
    raise exception 'Invalid encryption public key';
  end if;
  if length(coalesce(p_encrypted_private_key,''))<32
     or length(p_encrypted_private_key)>20000
     or length(coalesce(p_backup_iv,''))<8
     or length(p_backup_iv)>256
     or length(coalesce(p_backup_salt,''))<8
     or length(p_backup_salt)>256 then
    raise exception 'Invalid encrypted recovery material';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('e2ee-reset:'||v_user_id,0));

  select identity.key_version+1 into v_next_version
  from public.user_encryption_identities identity
  where identity.user_id=v_user_id
  for update;
  if v_next_version is null then
    raise exception 'Secure messaging has not been set up';
  end if;

  delete from public.conversation_key_envelopes envelope
  where (
      envelope.conversation_kind='roommate'
      and exists(
        select 1 from public.conversations conversation
        where conversation.id=envelope.conversation_id
          and v_user_id in(conversation.participant_a,conversation.participant_b)
      )
    ) or (
      envelope.conversation_kind='worker'
      and exists(
        select 1 from public.booking_conversations conversation
        where conversation.id=envelope.conversation_id
          and v_user_id in(conversation.user_id,conversation.worker_id)
      )
    );

  update public.user_encryption_identities
  set key_version=v_next_version,
      public_key_jwk=p_public_key_jwk,
      encrypted_private_key=p_encrypted_private_key,
      backup_iv=p_backup_iv,
      backup_salt=p_backup_salt,
      kdf_name='PBKDF2-SHA-256',
      kdf_iterations=p_kdf_iterations,
      rotated_at=now(),
      updated_at=now()
  where user_id=v_user_id;

  return v_next_version;
end;
$$;

revoke all on function public.reset_my_encryption_identity(jsonb,text,text,text,integer)
from public,anon;
grant execute on function public.reset_my_encryption_identity(jsonb,text,text,text,integer)
to authenticated,service_role;

-- Keep execution registry aligned with the actual grants where the registry exists.
do $$
begin
  if to_regclass('public.function_execution_registry') is not null then
    update public.function_execution_registry
    set authenticated_allowed=false,
        service_role_allowed=true,
        review_state='approved_service_only',
        rationale='Server-authoritative financial mutation; browser execution revoked',
        captured_at=now()
    where function_name in('confirm_booking_payment','credit_wallet');

    update public.function_execution_registry
    set authenticated_allowed=true,
        anon_allowed=false,
        public_allowed=false,
        service_role_allowed=true,
        review_state='approved_client_rpc',
        rationale='Authenticated Personal identity bootstrap always creates role=user; requested role is ignored',
        captured_at=now()
    where function_name='create_my_profile';
  end if;
end
$$;

comment on function public.get_my_workspace_access() is
  'Returns Personal for every active consumer identity plus additive authorised workspaces; internal module assignments do not become extra tiles.';
comment on function public.bootstrap_first_creator_from_service(uuid,text,text) is
  'One-time service-only Creator bootstrap on an existing Personal identity; Personal access is retained.';
comment on function public.create_my_profile(text,text) is
  'Creates exactly one Personal user identity. Worker and Property Partner are activated later as additive workspaces.';
comment on function public.reset_my_encryption_identity(jsonb,text,text,text,integer) is
  'Authenticated forgotten-Inbox-passcode reset. Rotates the E2EE identity without requiring the old passcode; old private ciphertext may become unreadable.';

commit;
