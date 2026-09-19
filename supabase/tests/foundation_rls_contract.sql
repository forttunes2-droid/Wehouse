\set ON_ERROR_STOP on

begin;

-- A hosted restore must not inherit broad Supabase function defaults. These
-- anonymous SECURITY DEFINER endpoints are the explicit public API surface.
do $$
declare
  unexpected text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into unexpected
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prosecdef
    and has_function_privilege('anon',p.oid,'execute')
    and p.oid::regprocedure::text <> all(array[
      'begin_identity_provider_password_recovery(text,text)',
      'get_current_legal_documents()', 'get_discoverable_homes()',
      'get_discoverable_hotels()', 'get_discoverable_listings()',
      'get_public_hotel_detail(integer)', 'get_public_listing_detail(text)',
      'get_short_let_date_availability(text,date,date)'
    ]);
  if unexpected is not null then
    raise exception 'Unexpected anonymous privileged RPC access: %',unexpected;
  end if;
end;
$$;

create function public.wh_contract_default_grant_probe() returns integer
language sql security definer as 'select 1';
do $$
begin
  if has_function_privilege('anon','public.wh_contract_default_grant_probe()','execute')
    or has_function_privilege('authenticated','public.wh_contract_default_grant_probe()','execute') then
    raise exception 'New privileged functions must require explicit API grants';
  end if;
end;
$$;

-- Synthetic users are inserted as fixtures and rolled back. Once the attacker
-- role is selected, normal authenticated RLS/policies and participant guards
-- apply exactly as they do through the API.
set local session_replication_role=replica;

insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name,account_kind)
values
 ('11111111-1111-4111-8111-111111111111','rls-victim-a@example.invalid','rls-victim-a','user',true,'RLS Victim A','consumer'),
 ('22222222-2222-4222-8222-222222222222','rls-attacker@example.invalid','rls-attacker','user',true,'RLS Attacker','consumer'),
 ('33333333-3333-4333-8333-333333333333','rls-victim-c@example.invalid','rls-victim-c','user',true,'RLS Victim C','consumer');

insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values('rls-victim-a','worker','global','active');

insert into public.wallets(owner_id,owner_type,available_balance,pending_balance,frozen_balance)
values('rls-victim-a','worker',1234,50,25);

insert into public.bank_accounts(user_id,account_number,bank_code,bank_name,account_name,is_default,is_active)
values('rls-victim-a','0000000001','999','Contract Test Bank','RLS Victim A',true,true);

insert into public.user_encryption_identities(
  user_id,key_version,public_key_jwk,encrypted_private_key,backup_iv,backup_salt,kdf_iterations
) values(
  'rls-victim-a',1,'{}'::jsonb,'private-ciphertext','iv','salt',600000
);

insert into public.conversations(id,participant_a,participant_b,status,conversation_type,last_message)
values(
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','rls-victim-a','rls-victim-c','matched','direct','private preview'
);
insert into public.messages(id,conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version)
values(
  'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','rls-victim-a','[Encrypted message]','ciphertext','iv',1
);

insert into public.private_calls(
  id,context_type,context_id,caller_id,callee_id,call_type,status
) values(
  'cccccccc-1111-4111-8111-cccccccccccc','roommate',
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','rls-victim-a','rls-victim-c','video','accepted'
);
insert into public.private_call_signals(call_id,sender_id,signal_type,payload)
values(
  'cccccccc-1111-4111-8111-cccccccccccc','rls-victim-a','offer','{"sdp":"secret"}'::jsonb
);

set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

-- Positive control: the attacker is a valid authenticated account, so an
-- all-deny policy or broken fixture cannot make the privacy assertions pass.
do $$
begin
  if not exists(select 1 from public.profiles where user_id='rls-attacker') then
    raise exception 'Positive control failed: account cannot read its own profile';
  end if;
  update public.profiles set bio='Allowed ordinary profile edit' where user_id='rls-attacker';
  if not exists(select 1 from public.profiles where user_id='rls-attacker' and bio='Allowed ordinary profile edit') then
    raise exception 'Positive control failed: account cannot edit its own biography';
  end if;
end;
$$;

do $$
begin
  if exists(select 1 from public.profiles where user_id='rls-victim-a') then
    raise exception 'RLS leak: unrelated user can read another private profile row';
  end if;
  if exists(select 1 from public.workspace_role_assignments where user_id='rls-victim-a') then
    raise exception 'RLS leak: unrelated user can read another workspace grant';
  end if;
  if exists(select 1 from public.wallets where owner_id='rls-victim-a') then
    raise exception 'RLS leak: unrelated user can read another wallet';
  end if;
  if exists(select 1 from public.bank_accounts where user_id='rls-victim-a') then
    raise exception 'RLS leak: unrelated user can read another bank account';
  end if;
  if exists(select 1 from public.user_encryption_identities where user_id='rls-victim-a') then
    raise exception 'RLS leak: unrelated user can read another encrypted private-key backup';
  end if;
  if exists(select 1 from public.conversations where id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') then
    raise exception 'RLS leak: unrelated user can read another private conversation';
  end if;
  if exists(select 1 from public.messages where id='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb') then
    raise exception 'RLS leak: unrelated user can read another private message';
  end if;
  if exists(select 1 from public.private_calls where id='cccccccc-1111-4111-8111-cccccccccccc') then
    raise exception 'RLS leak: unrelated user can read another private call';
  end if;
  if exists(select 1 from public.private_call_signals where call_id='cccccccc-1111-4111-8111-cccccccccccc') then
    raise exception 'RLS leak: unrelated user can read another call signal';
  end if;
end;
$$;

-- The attacker supplies an encrypted-looking payload for another user's thread.
-- Any server-side security layer may reject it first (E2EE canonicalization,
-- participant guard, trigger, or RLS). The invariant we care about is that the
-- unauthorized write never succeeds.
do $$
declare
  blocked boolean:=false;
begin
  begin
    insert into public.messages(
      conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version
    ) values(
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','rls-attacker',
      '[Encrypted message]','attacker-ciphertext','attacker-iv',1
    );
  exception when others then
    blocked:=true;
  end;
  if not blocked then
    raise exception 'Cross-user write bypass: unrelated user inserted a private message';
  end if;
end;
$$;

-- The signaling payload is valid for an existing active call. The unrelated
-- user must not be able to add ICE/signaling data to a call they do not own.
do $$
declare
  blocked boolean:=false;
begin
  begin
    insert into public.private_call_signals(call_id,sender_id,signal_type,payload)
    values('cccccccc-1111-4111-8111-cccccccccccc','rls-attacker','ice','{}'::jsonb);
  exception when others then
    blocked:=true;
  end;
  if not blocked then
    raise exception 'Cross-user write bypass: unrelated user inserted a call signal';
  end if;
end;
$$;

reset role;

-- User-editable JWT metadata cannot turn a Personal account into Creator.
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','22222222-2222-4222-8222-222222222222','role','authenticated',
  'user_metadata',jsonb_build_object('role','creator','is_admin',true)
)::text,true);
set local role authenticated;
do $$
declare
  affected integer;
begin
  begin
    update public.profiles set role='creator' where user_id='rls-attacker';
  exception when insufficient_privilege or raise_exception then
    null;
  end;
  if exists(select 1 from public.profiles where user_id='rls-attacker' and role<>'user') then
    raise exception 'Privilege escalation: Personal account changed its own role';
  end if;
  begin
    update public.bank_accounts set account_name='Attacker replacement' where user_id='rls-victim-a';
    get diagnostics affected=row_count;
    if affected<>0 then raise exception 'Cross-user bank account mutation succeeded'; end if;
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
do $$
begin
  if (select role from public.profiles where user_id='rls-attacker') is distinct from 'user' then
    raise exception 'Privilege escalation changed the stored profile role';
  end if;
  if (select account_name from public.bank_accounts where user_id='rls-victim-a') is distinct from 'RLS Victim A' then
    raise exception 'Unauthorized write changed the stored bank account';
  end if;
end;
$$;
rollback;
