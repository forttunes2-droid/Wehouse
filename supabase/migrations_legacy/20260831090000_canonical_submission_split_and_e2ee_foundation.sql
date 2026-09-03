-- Canonical property submission, roommate split-payment and private-chat E2EE foundation.
-- Additive by design: existing production rows and legacy read paths remain valid during rollout.

alter table public.inspection_requests
  add column if not exists submission_schema_version integer not null default 1,
  add column if not exists hotel_program jsonb,
  add column if not exists submission_batch_id uuid;

create table if not exists public.property_submission_batches (
  id uuid primary key default gen_random_uuid(),
  partner_user_id text not null,
  status text not null default 'draft' check (status in ('draft','submitting','submitted','cancelled')),
  active_item integer not null default 0 check (active_item >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists public.property_submission_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.property_submission_batches(id) on delete cascade,
  position integer not null check (position >= 0),
  property_type text not null default 'apartment' check (property_type in ('apartment','hotel')),
  draft_payload jsonb not null default '{}'::jsonb,
  inspection_request_id uuid references public.inspection_requests(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','ready','submitted','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(batch_id, position)
);

create index if not exists property_submission_batches_partner_idx
  on public.property_submission_batches(partner_user_id, updated_at desc);
create index if not exists property_submission_items_batch_idx
  on public.property_submission_items(batch_id, position);

alter table public.property_submission_batches enable row level security;
alter table public.property_submission_items enable row level security;

drop policy if exists property_submission_batches_owner_all on public.property_submission_batches;
create policy property_submission_batches_owner_all on public.property_submission_batches
  for all to authenticated
  using (partner_user_id = (select auth.uid())::text)
  with check (partner_user_id = (select auth.uid())::text);

drop policy if exists property_submission_items_owner_all on public.property_submission_items;
create policy property_submission_items_owner_all on public.property_submission_items
  for all to authenticated
  using (exists (
    select 1 from public.property_submission_batches b
    where b.id = batch_id and b.partner_user_id = (select auth.uid())::text
  ))
  with check (exists (
    select 1 from public.property_submission_batches b
    where b.id = batch_id and b.partner_user_id = (select auth.uid())::text
  ));

grant select, insert, update, delete on public.property_submission_batches to authenticated;
grant select, insert, update, delete on public.property_submission_items to authenticated;

-- A shared home is separate from an optional individual rent plan.
create table if not exists public.shared_housing_groups (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  created_by text not null,
  status text not null default 'inviting' check (status in ('inviting','ready','payment_pending','paid','cancelled','expired')),
  member_limit integer not null default 2 check (member_limit between 2 and 6),
  total_amount numeric(12,2) not null check (total_amount > 0),
  split_method text not null default 'equal' check (split_method = 'equal'),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  reservation_id text references public.reservations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_housing_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.shared_housing_groups(id) on delete cascade,
  user_id text not null,
  invitation_status text not null default 'invited' check (invitation_status in ('invited','accepted','declined','removed')),
  share_amount numeric(12,2) not null default 0 check (share_amount >= 0),
  payment_status text not null default 'not_started' check (payment_status in ('not_started','pending','paid','failed','refunded')),
  payment_reference text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id, user_id)
);

create index if not exists shared_housing_members_user_idx on public.shared_housing_members(user_id, created_at desc);
alter table public.shared_housing_groups enable row level security;
alter table public.shared_housing_members enable row level security;

drop policy if exists shared_housing_groups_member_read on public.shared_housing_groups;
create policy shared_housing_groups_member_read on public.shared_housing_groups
  for select to authenticated using (
    created_by = (select auth.uid())::text or exists (
      select 1 from public.shared_housing_members m
      where m.group_id = id and m.user_id = (select auth.uid())::text
    )
  );
drop policy if exists shared_housing_members_member_read on public.shared_housing_members;
create policy shared_housing_members_member_read on public.shared_housing_members
  for select to authenticated using (user_id = (select auth.uid())::text);

grant select on public.shared_housing_groups, public.shared_housing_members to authenticated;

-- E2EE applies only to roommate and worker conversations. Support remains intentionally excluded.
create table if not exists public.user_encryption_identities (
  user_id text primary key,
  key_version integer not null default 1 check (key_version > 0),
  public_key_jwk jsonb not null,
  encrypted_private_key text not null,
  backup_iv text not null,
  backup_salt text not null,
  kdf_name text not null default 'PBKDF2-SHA-256' check (kdf_name = 'PBKDF2-SHA-256'),
  kdf_iterations integer not null default 600000 check (kdf_iterations >= 600000),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_key_envelopes (
  id uuid primary key default gen_random_uuid(),
  conversation_kind text not null check (conversation_kind in ('roommate','worker')),
  conversation_id uuid not null,
  recipient_user_id text not null,
  recipient_key_version integer not null,
  sender_ephemeral_public_key_jwk jsonb not null,
  wrapped_key text not null,
  wrap_iv text not null,
  algorithm text not null default 'ECDH-P256+A256GCM',
  created_at timestamptz not null default now(),
  unique(conversation_kind, conversation_id, recipient_user_id, recipient_key_version)
);

alter table public.messages
  add column if not exists ciphertext text,
  add column if not exists encryption_iv text,
  add column if not exists encryption_version integer,
  add column if not exists encrypted_attachments jsonb;
alter table public.booking_messages
  add column if not exists ciphertext text,
  add column if not exists encryption_iv text,
  add column if not exists encryption_version integer,
  add column if not exists encrypted_attachments jsonb;

alter table public.user_encryption_identities enable row level security;
alter table public.conversation_key_envelopes enable row level security;

drop policy if exists encryption_identity_owner_read on public.user_encryption_identities;
create policy encryption_identity_owner_read on public.user_encryption_identities
  for select to authenticated using (user_id = (select auth.uid())::text);
drop policy if exists encryption_identity_owner_insert on public.user_encryption_identities;
create policy encryption_identity_owner_insert on public.user_encryption_identities
  for insert to authenticated with check (user_id = (select auth.uid())::text);
drop policy if exists encryption_identity_owner_update on public.user_encryption_identities;
create policy encryption_identity_owner_update on public.user_encryption_identities
  for update to authenticated
  using (user_id = (select auth.uid())::text)
  with check (user_id = (select auth.uid())::text);

drop policy if exists conversation_key_envelope_recipient_read on public.conversation_key_envelopes;
create policy conversation_key_envelope_recipient_read on public.conversation_key_envelopes
  for select to authenticated using (recipient_user_id = (select auth.uid())::text);
drop policy if exists conversation_key_envelope_participant_insert on public.conversation_key_envelopes;
create policy conversation_key_envelope_participant_insert on public.conversation_key_envelopes
  for insert to authenticated with check (
    (conversation_kind = 'roommate' and exists (
      select 1 from public.conversations c where c.id = conversation_id
      and (c.participant_a = (select auth.uid())::text or c.participant_b = (select auth.uid())::text)
      and (c.participant_a = recipient_user_id or c.participant_b = recipient_user_id)
    )) or
    (conversation_kind = 'worker' and exists (
      select 1 from public.booking_conversations c where c.id = conversation_id
      and (c.user_id = (select auth.uid())::text or c.worker_id = (select auth.uid())::text)
      and (c.user_id = recipient_user_id or c.worker_id = recipient_user_id)
    ))
  );

grant select, insert, update on public.user_encryption_identities to authenticated;
grant select, insert on public.conversation_key_envelopes to authenticated;

create or replace function public.get_private_chat_peer_public_key(
  p_conversation_kind text,
  p_conversation_id uuid,
  p_peer_user_id text
) returns table(user_id text, key_version integer, public_key_jwk jsonb)
language plpgsql security definer set search_path = '' as $$
declare actor text := (select auth.uid())::text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_conversation_kind = 'roommate' then
    if not exists (
      select 1 from public.conversations c where c.id = p_conversation_id
      and (c.participant_a = actor or c.participant_b = actor)
      and (c.participant_a = p_peer_user_id or c.participant_b = p_peer_user_id)
    ) then raise exception 'Conversation access denied'; end if;
  elsif p_conversation_kind = 'worker' then
    if not exists (
      select 1 from public.booking_conversations c where c.id = p_conversation_id
      and (c.user_id = actor or c.worker_id = actor)
      and (c.user_id = p_peer_user_id or c.worker_id = p_peer_user_id)
    ) then raise exception 'Conversation access denied'; end if;
  else raise exception 'Unsupported private conversation kind';
  end if;
  return query select i.user_id, i.key_version, i.public_key_jwk
    from public.user_encryption_identities i where i.user_id = p_peer_user_id;
end $$;
revoke all on function public.get_private_chat_peer_public_key(text,uuid,text) from public,anon;
grant execute on function public.get_private_chat_peer_public_key(text,uuid,text) to authenticated;

create or replace function public.send_private_encrypted_message(
  p_conversation_kind text,
  p_conversation_id uuid,
  p_ciphertext text,
  p_encryption_iv text,
  p_encrypted_attachments jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor text := (select auth.uid())::text; message_id uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nullif(p_ciphertext,'') is null or nullif(p_encryption_iv,'') is null then
    raise exception 'Encrypted payload is required';
  end if;
  if p_conversation_kind = 'roommate' then
    if not exists (select 1 from public.conversations c where c.id=p_conversation_id
      and (c.participant_a=actor or c.participant_b=actor)) then raise exception 'Conversation access denied'; end if;
    insert into public.messages(conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version,encrypted_attachments)
      values(p_conversation_id,actor,'[Encrypted message]',p_ciphertext,p_encryption_iv,1,coalesce(p_encrypted_attachments,'[]'::jsonb)) returning id into message_id;
    update public.conversations set last_message='Encrypted message',last_message_at=now(),
      unread_a=case when participant_a=actor then unread_a else coalesce(unread_a,0)+1 end,
      unread_b=case when participant_b=actor then unread_b else coalesce(unread_b,0)+1 end
      where id=p_conversation_id;
  elsif p_conversation_kind = 'worker' then
    if not exists (select 1 from public.booking_conversations c where c.id=p_conversation_id
      and (c.user_id=actor or c.worker_id=actor)) then raise exception 'Conversation access denied'; end if;
    insert into public.booking_messages(conversation_id,sender_id,content,ciphertext,encryption_iv,encryption_version,encrypted_attachments)
      values(p_conversation_id,actor,'[Encrypted message]',p_ciphertext,p_encryption_iv,1,coalesce(p_encrypted_attachments,'[]'::jsonb)) returning id into message_id;
    update public.booking_conversations set updated_at=now() where id=p_conversation_id;
  else raise exception 'Unsupported private conversation kind';
  end if;
  return message_id;
end $$;

create or replace function public.get_private_encrypted_messages(
  p_conversation_kind text,
  p_conversation_id uuid
) returns table(
  id uuid, sender_id text, ciphertext text, encryption_iv text,
  encryption_version integer, encrypted_attachments jsonb, created_at timestamptz,
  legacy_content text
) language plpgsql security definer set search_path = '' as $$
declare actor text := (select auth.uid())::text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_conversation_kind = 'roommate' then
    if not exists (select 1 from public.conversations c where c.id=p_conversation_id
      and (c.participant_a=actor or c.participant_b=actor)) then raise exception 'Conversation access denied'; end if;
    return query select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,
      coalesce(m.encrypted_attachments,'[]'::jsonb),m.created_at,
      case when m.ciphertext is null then m.content else null end
      from public.messages m where m.conversation_id=p_conversation_id
      and not (actor=any(coalesce(m.hidden_for,'{}'::text[]))) order by m.created_at;
  elsif p_conversation_kind = 'worker' then
    if not exists (select 1 from public.booking_conversations c where c.id=p_conversation_id
      and (c.user_id=actor or c.worker_id=actor)) then raise exception 'Conversation access denied'; end if;
    return query select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,
      coalesce(m.encrypted_attachments,'[]'::jsonb),m.created_at,
      case when m.ciphertext is null then m.content else null end
      from public.booking_messages m where m.conversation_id=p_conversation_id
      and not (actor=any(coalesce(m.hidden_for,'{}'::text[]))) order by m.created_at;
  else raise exception 'Unsupported private conversation kind';
  end if;
end $$;

revoke all on function public.send_private_encrypted_message(text,uuid,text,text,jsonb),
  public.get_private_encrypted_messages(text,uuid) from public,anon;
grant execute on function public.send_private_encrypted_message(text,uuid,text,text,jsonb),
  public.get_private_encrypted_messages(text,uuid) to authenticated;

-- The challenge table is accessed only through guarded RPCs; give RLS an explicit deny baseline.
drop policy if exists property_access_challenges_no_direct_access on public.property_access_challenges;
create policy property_access_challenges_no_direct_access on public.property_access_challenges
  for all to authenticated using (false) with check (false);

comment on table public.user_encryption_identities is
  'Client-generated ECDH public key and Recovery-PIN-encrypted private-key backup. The server never receives plaintext private keys or PINs.';
comment on table public.conversation_key_envelopes is
  'Per-participant wrapped AES conversation keys for private roommate and worker chats only.';
