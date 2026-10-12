-- Companion rules (C-029, C-030): a bucket of at most 5, cancel with a 30-day wait, and a private encrypted chat.
-- There is no block: Companion is a connection state that either side can cancel.
-- Nothing here reads or writes Roommate tables. The server only stores ciphertext.

create table if not exists public.companion_messages (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.companions(id) on delete cascade,
  sender_id text not null,
  ciphertext text not null,
  encryption_iv text not null,
  encryption_version integer not null default 1,
  encrypted_attachments jsonb not null default '[]'::jsonb,
  reply_to_id uuid references public.companion_messages(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists companion_messages_thread_idx on public.companion_messages(companion_id, created_at);

alter table public.companion_messages enable row level security;
revoke all on table public.companion_messages from public, anon, authenticated;
grant all on table public.companion_messages to service_role;

-- Bucket size: accepted Companions plus requests the user has sent and not yet had answered.
create or replace function public.companion_bucket_count(p_user_id text)
returns integer language sql stable security definer set search_path = 'pg_catalog','public' as $$
  select count(*)::integer from public.companions c
  where p_user_id in (c.user_low, c.user_high)
    and (c.status = 'accepted' or (c.status = 'pending' and c.requested_by = p_user_id))
$$;
revoke all on function public.companion_bucket_count(text) from public, anon, authenticated;
grant execute on function public.companion_bucket_count(text) to service_role;

-- The one place to change how long a cancelled or declined pair must wait before asking again.
create or replace function public.companion_rerequest_wait()
returns interval language sql immutable set search_path = 'pg_catalog' as $$ select interval '30 days' $$;
revoke all on function public.companion_rerequest_wait() from public, anon, authenticated;
grant execute on function public.companion_rerequest_wait() to service_role;

create or replace function public.send_companion_request(p_user_id text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  lo text; hi text; c public.companions;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if p_user_id is null or p_user_id = actor then
    raise exception 'Choose another person';
  end if;
  if not exists(select 1 from public.profiles p where p.user_id = p_user_id and p.account_kind = 'consumer'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
    raise exception 'That person cannot receive a companion request';
  end if;
  -- Serialise bucket changes for both people so concurrent requests cannot push a list past 5.
  perform pg_advisory_xact_lock(hashtext('companion_bucket:' || least(actor, p_user_id)));
  perform pg_advisory_xact_lock(hashtext('companion_bucket:' || greatest(actor, p_user_id)));

  lo := least(actor, p_user_id); hi := greatest(actor, p_user_id);
  select * into c from public.companions where user_low = lo and user_high = hi for update;
  if c.id is not null and c.status in ('pending','accepted') then
    return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
  end if;
  if c.id is not null and c.status in ('declined','removed') and c.responded_at > now() - public.companion_rerequest_wait() then
    raise exception 'That person cannot receive a companion request';
  end if;
  if public.companion_bucket_count(actor) >= 5 then
    raise exception 'Your Companion list is full. Remove a Companion to add another';
  end if;
  if public.companion_bucket_count(p_user_id) >= 5 then
    raise exception 'That person cannot receive a companion request';
  end if;

  if c.id is null then
    insert into public.companions(user_low, user_high, requested_by) values (lo, hi, actor) returning * into c;
  else
    update public.companions set status = 'pending', requested_by = actor, responded_at = null, updated_at = now()
    where id = c.id returning * into c;
  end if;
  return jsonb_build_object('id', c.id, 'status', c.status, 'requested_by_me', c.requested_by = actor);
end $$;

create or replace function public.respond_to_companion_request(p_companion_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.companions;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  select * into c from public.companions where id = p_companion_id;
  if c.id is not null then
    perform pg_advisory_xact_lock(hashtext('companion_bucket:' || c.user_low));
    perform pg_advisory_xact_lock(hashtext('companion_bucket:' || c.user_high));
  end if;
  select * into c from public.companions where id = p_companion_id for update;
  if c.id is null or c.status <> 'pending' or c.requested_by = actor or actor not in (c.user_low, c.user_high) then
    raise exception 'Pending companion request not found';
  end if;
  if p_accept then
    if public.companion_bucket_count(actor) >= 5 then
      raise exception 'Your Companion list is full. Remove a Companion to add another';
    end if;
  end if;
  update public.companions
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now(), updated_at = now()
  where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;

create or replace function public.send_companion_encrypted_message(
  p_companion_id uuid, p_ciphertext text, p_encryption_iv text,
  p_encrypted_attachments jsonb default '[]'::jsonb, p_reply_to_id uuid default null)
returns uuid language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.companions; peer text; mid uuid;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if nullif(p_ciphertext, '') is null or nullif(p_encryption_iv, '') is null then
    raise exception 'Encrypted payload is required';
  end if;
  select * into c from public.companions where id = p_companion_id;
  if c.id is null or c.status <> 'accepted' or actor not in (c.user_low, c.user_high) then
    raise exception 'Conversation access denied';
  end if;
  peer := case when c.user_low = actor then c.user_high else c.user_low end;
  if p_reply_to_id is not null and not exists(
    select 1 from public.companion_messages where id = p_reply_to_id and companion_id = c.id) then
    raise exception 'Reply target is not in this conversation';
  end if;
  insert into public.companion_messages(companion_id, sender_id, ciphertext, encryption_iv, encrypted_attachments, reply_to_id)
  values (c.id, actor, p_ciphertext, p_encryption_iv, coalesce(p_encrypted_attachments, '[]'::jsonb), p_reply_to_id)
  returning id into mid;
  return mid;
end $$;

create or replace function public.get_companion_encrypted_messages(p_companion_id uuid)
returns table(id uuid, sender_id text, ciphertext text, encryption_iv text, encryption_version integer,
  encrypted_attachments jsonb, reply_to_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); c public.companions;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  select * into c from public.companions where companions.id = p_companion_id;
  if c.id is null or c.status <> 'accepted' or actor not in (c.user_low, c.user_high) then
    raise exception 'Conversation access denied';
  end if;
  return query
    select m.id, m.sender_id, m.ciphertext, m.encryption_iv, m.encryption_version,
           m.encrypted_attachments, m.reply_to_id, m.created_at
    from public.companion_messages m where m.companion_id = c.id order by m.created_at;
end $$;

revoke all on function public.send_companion_encrypted_message(uuid,text,text,jsonb,uuid),
  public.get_companion_encrypted_messages(uuid) from public, anon, authenticated;
grant execute on function public.send_companion_encrypted_message(uuid,text,text,jsonb,uuid),
  public.get_companion_encrypted_messages(uuid) to authenticated, service_role;
