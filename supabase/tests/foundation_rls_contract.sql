\set ON_ERROR_STOP on

begin;

-- Synthetic users are inserted as fixtures and rolled back.  Once the attacker
-- role is selected, normal authenticated RLS/policies apply exactly as they do
-- through the API.
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
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','rls-victim-a','[encrypted]','ciphertext','iv',1
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

-- Give the attacker structurally valid encrypted payloads so these writes reach
-- participant RLS instead of being rejected earlier by E2EE-format validation.
do $$
declare
  blocked boolean:=false;
  state text;
begin
  begin
    insert into public.messages(
      conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version
    ) values(
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','rls-attacker',
      '[encrypted]','attacker-ciphertext','attacker-iv',1
    );
  exception when others then
    get stacked diagnostics state=returned_sqlstate;
    blocked:=state='42501';
  end;
  if not blocked then
    raise exception 'RLS write isolation was not the reason an unrelated private-message insert was rejected';
  end if;
end;
$$;

do $$
declare
  blocked boolean:=false;
  state text;
begin
  begin
    insert into public.private_call_signals(call_id,sender_id,signal_type,payload)
    values('cccccccc-1111-4111-8111-cccccccccccc','rls-attacker','ice','{}'::jsonb);
  exception when others then
    get stacked diagnostics state=returned_sqlstate;
    blocked:=state='42501';
  end;
  if not blocked then
    raise exception 'RLS write isolation was not the reason an unrelated call-signal insert was rejected';
  end if;
end;
$$;

reset role;
rollback;
