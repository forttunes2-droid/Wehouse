-- A Friend chat message can carry a client-made id. A retry after a bad network or a
-- double tap with the same id returns the first message instead of sending a second one.
drop function if exists public.send_companion_encrypted_message(uuid,text,text,jsonb,uuid);

create or replace function public.send_companion_encrypted_message(
  p_companion_id uuid, p_ciphertext text, p_encryption_iv text,
  p_encrypted_attachments jsonb default '[]'::jsonb, p_reply_to_id uuid default null,
  p_client_message_id uuid default null)
returns uuid language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor text := public.current_profile_user_id();
  c public.companions; mid uuid; item jsonb; items jsonb := coalesce(p_encrypted_attachments, '[]'::jsonb);
  v_existing public.companion_messages;
begin
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Active Personal account required';
  end if;
  if nullif(p_ciphertext, '') is null or nullif(p_encryption_iv, '') is null then
    raise exception 'Encrypted payload is required';
  end if;
  c := private.friend_chat_access(p_companion_id, true);
  if p_client_message_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('friend-msg:' || p_client_message_id::text, 0));
    select * into v_existing from public.companion_messages where id = p_client_message_id;
    if v_existing.id is not null then
      if v_existing.companion_id <> c.id or v_existing.sender_id <> actor then
        raise exception 'This message id is already used' using errcode='22023';
      end if;
      return v_existing.id;
    end if;
  end if;
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
  insert into public.companion_messages(id, companion_id, sender_id, ciphertext, encryption_iv, encrypted_attachments, reply_to_id)
  values (coalesce(p_client_message_id, gen_random_uuid()), c.id, actor, p_ciphertext, p_encryption_iv, items, p_reply_to_id)
  returning id into mid;
  return mid;
end $$;

revoke all on function public.send_companion_encrypted_message(uuid,text,text,jsonb,uuid,uuid) from public, anon;
grant execute on function public.send_companion_encrypted_message(uuid,text,text,jsonb,uuid,uuid) to authenticated, service_role;
