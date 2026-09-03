drop function if exists public.get_private_encrypted_messages(text, uuid);

create function public.get_private_encrypted_messages(
  p_conversation_kind text,
  p_conversation_id uuid
) returns table(
  id uuid,
  sender_id text,
  ciphertext text,
  encryption_iv text,
  encryption_version integer,
  encrypted_attachments jsonb,
  created_at timestamptz,
  legacy_content text,
  is_read boolean
)
language plpgsql
security definer
set search_path=''
as $$
declare
  actor text := public.current_profile_user_id();
begin
  if actor is null then
    raise exception 'Active WeHouse profile required';
  end if;

  if p_conversation_kind = 'roommate' then
    if not exists (
      select 1
      from public.conversations c
      where c.id = p_conversation_id
        and actor in (c.participant_a, c.participant_b)
        and c.conversation_type = 'roommate'
        and coalesce(c.status, 'active') = 'active'
    ) then
      raise exception 'Conversation access denied';
    end if;

    return query
    select m.id, m.sender_id, m.ciphertext, m.encryption_iv,
      m.encryption_version, coalesce(m.encrypted_attachments, '[]'::jsonb),
      m.created_at, case when m.ciphertext is null then m.content else null end,
      coalesce(m.seen, false)
    from public.messages m
    where m.conversation_id = p_conversation_id
      and not (actor = any(coalesce(m.hidden_for, '{}'::text[])))
    order by m.created_at;
  elsif p_conversation_kind = 'worker' then
    if not exists (
      select 1
      from public.booking_conversations c
      where c.id = p_conversation_id
        and actor in (c.user_id, c.worker_id)
    ) then
      raise exception 'Conversation access denied';
    end if;

    return query
    select m.id, m.sender_id, m.ciphertext, m.encryption_iv,
      m.encryption_version, coalesce(m.encrypted_attachments, '[]'::jsonb),
      m.created_at, case when m.ciphertext is null then m.content else null end,
      coalesce(m.is_read, false)
    from public.booking_messages m
    where m.conversation_id = p_conversation_id
      and not (actor = any(coalesce(m.hidden_for, '{}'::text[])))
    order by m.created_at;
  else
    raise exception 'Unsupported private conversation kind';
  end if;
end
$$;

revoke all on function public.get_private_encrypted_messages(text, uuid) from public, anon;
grant execute on function public.get_private_encrypted_messages(text, uuid) to authenticated;
