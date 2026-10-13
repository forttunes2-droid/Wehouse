-- Friend chat gets what Roommate chat has: encrypted images and voice notes, reactions, reply and delete for me.
-- Separate Friend functions: nothing here changes how Roommate or worker chats work.
-- While a Friend is blocked, both people can still read the old chat but nobody can send, react or upload.

alter table public.companion_messages
  add column if not exists reactions jsonb not null default '{}'::jsonb,
  add column if not exists hidden_for text[] not null default '{}'::text[];

-- Encrypted media paths: e2ee/companion/<companion id>/<file>.bin
create or replace function private.can_access_chat_cipher_object(p_name text,p_write boolean)
returns boolean language plpgsql stable security definer set search_path='pg_catalog','public'
as $$
declare p text[]:=string_to_array(p_name,'/'); c uuid; a text:=public.current_profile_user_id(); peer text;
begin
 if a is null or cardinality(p)<>4 or p[1]<>'e2ee' or p[4] !~ '^[a-zA-Z0-9_-]+\.bin$' then return false; end if;
 begin c:=p[3]::uuid; exception when invalid_text_representation then return false; end;
 if p[2]='roommate' then
  select case when participant_a=a then participant_b else participant_a end into peer from public.conversations
   where id=c and a in(participant_a,participant_b) and conversation_type='roommate'
    and coalesce(status,'active') in('active','accepted');
  if peer is null or exists(select 1 from public.roommate_user_blocks b where (b.blocker_user_id=a and b.blocked_user_id=peer) or (b.blocker_user_id=peer and b.blocked_user_id=a)) then return false; end if;
 elsif p[2]='worker' then
  select case when bc.user_id=a then bc.worker_id else bc.user_id end into peer from public.booking_conversations bc
   join public.worker_bookings b on b.id=bc.booking_id where bc.id=c and a in(bc.user_id,bc.worker_id)
    and (not p_write or b.status not in('approved_released','cancelled','refunded'));
  if peer is null or exists(select 1 from public.worker_user_blocks b where (b.blocker_user_id=a and b.blocked_user_id=peer) or (b.blocker_user_id=peer and b.blocked_user_id=a)) then return false; end if;
 elsif p[2]='companion' then
  if not exists(select 1 from public.companions f where f.id=c and a in(f.user_low,f.user_high)
      and (f.status='accepted' or (not p_write and f.status='blocked' and f.status_before_block='accepted'))) then return false; end if;
 else return false; end if;
 return true;
end $$;
revoke all on function private.can_access_chat_cipher_object(text,boolean) from public,anon;
grant execute on function private.can_access_chat_cipher_object(text,boolean) to authenticated;

create or replace function private.friend_chat_access(p_companion_id uuid, p_write boolean)
returns public.companions language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.current_profile_user_id(); c public.companions;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  select * into c from public.companions where id=p_companion_id;
  if c.id is null or actor not in (c.user_low,c.user_high)
     or not (c.status='accepted' or (not p_write and c.status='blocked' and c.status_before_block='accepted')) then
    raise exception 'Conversation access denied';
  end if;
  return c;
end $$;
revoke all on function private.friend_chat_access(uuid,boolean) from public,anon;
grant execute on function private.friend_chat_access(uuid,boolean) to authenticated;

create or replace function public.send_companion_encrypted_message(
  p_companion_id uuid, p_ciphertext text, p_encryption_iv text,
  p_encrypted_attachments jsonb default '[]'::jsonb, p_reply_to_id uuid default null)
returns uuid language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.companions; mid uuid; item jsonb; items jsonb := coalesce(p_encrypted_attachments, '[]'::jsonb);
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if nullif(p_ciphertext, '') is null or nullif(p_encryption_iv, '') is null then
    raise exception 'Encrypted payload is required';
  end if;
  c := private.friend_chat_access(p_companion_id, true);
  if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>6 then raise exception 'Invalid media list' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item)<>'object'
       or coalesce(item->>'path','') !~ ('^e2ee/companion/'||c.id::text||'/[a-zA-Z0-9_-]+\.bin$')
       or coalesce(item->>'file_iv','') !~ '^[A-Za-z0-9+/]{16}$'
       or coalesce(item->>'metadata_iv','') !~ '^[A-Za-z0-9+/]{16}$'
       or length(coalesce(item->>'metadata_ciphertext','')) not between 24 and 8192
       or coalesce(item->>'metadata_ciphertext','') !~ '^[A-Za-z0-9+/]+={0,2}$' then
      raise exception 'Invalid media for this conversation' using errcode='42501';
    end if;
  end loop;
  if p_reply_to_id is not null and not exists(
    select 1 from public.companion_messages where id = p_reply_to_id and companion_id = c.id) then
    raise exception 'Reply target is not in this conversation';
  end if;
  insert into public.companion_messages(companion_id, sender_id, ciphertext, encryption_iv, encrypted_attachments, reply_to_id)
  values (c.id, actor, p_ciphertext, p_encryption_iv, items, p_reply_to_id)
  returning id into mid;
  return mid;
end $$;

drop function if exists public.get_companion_encrypted_messages(uuid);
create or replace function public.get_companion_encrypted_messages(p_companion_id uuid)
returns table(id uuid, sender_id text, ciphertext text, encryption_iv text, encryption_version integer,
  encrypted_attachments jsonb, reply_to_id uuid, created_at timestamptz, reactions jsonb)
language plpgsql stable security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); c public.companions;
begin
  c := private.friend_chat_access(p_companion_id, false);
  return query
    select m.id, m.sender_id, m.ciphertext, m.encryption_iv, m.encryption_version,
           m.encrypted_attachments, m.reply_to_id, m.created_at, m.reactions
    from public.companion_messages m
    where m.companion_id = c.id and not (actor = any(m.hidden_for))
    order by m.created_at, m.id;
end $$;

create or replace function public.set_companion_message_reaction(p_companion_id uuid, p_message_id uuid, p_emoji text)
returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); c public.companions; result jsonb;
begin
  if nullif(btrim(coalesce(p_emoji,'')),'') is not null and not public._valid_reaction(p_emoji) then
    raise exception 'Choose a valid emoji reaction';
  end if;
  c := private.friend_chat_access(p_companion_id, true);
  update public.companion_messages
     set reactions = case when nullif(btrim(coalesce(p_emoji,'')),'') is null
       then coalesce(reactions,'{}'::jsonb) - actor
       else jsonb_set(coalesce(reactions,'{}'::jsonb), array[actor], to_jsonb(btrim(p_emoji)), true) end
   where id = p_message_id and companion_id = c.id
   returning reactions into result;
  if result is null then raise exception 'Message was not found'; end if;
  return result;
end $$;

create or replace function public.delete_companion_message_for_me(p_companion_id uuid, p_message_id uuid)
returns boolean language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare actor text := public.current_profile_user_id(); c public.companions;
begin
  c := private.friend_chat_access(p_companion_id, false);
  update public.companion_messages set hidden_for = array_append(hidden_for, actor)
   where id = p_message_id and companion_id = c.id and not (actor = any(hidden_for));
  return true;
end $$;

revoke all on function public.send_companion_encrypted_message(uuid,text,text,jsonb,uuid),
  public.get_companion_encrypted_messages(uuid), public.set_companion_message_reaction(uuid,uuid,text),
  public.delete_companion_message_for_me(uuid,uuid) from public, anon;
grant execute on function public.send_companion_encrypted_message(uuid,text,text,jsonb,uuid),
  public.get_companion_encrypted_messages(uuid), public.set_companion_message_reaction(uuid,uuid,text),
  public.delete_companion_message_for_me(uuid,uuid) to authenticated, service_role;
