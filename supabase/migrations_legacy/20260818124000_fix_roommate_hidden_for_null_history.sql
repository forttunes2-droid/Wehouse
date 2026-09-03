-- Preserve existing Roommate messages whose hidden_for value predates per-user hiding.
create or replace function public.get_roommate_messages_v2(p_conversation_id uuid)
returns table(
  id uuid,
  conversation_id uuid,
  sender_id text,
  content text,
  seen boolean,
  created_at timestamptz,
  edited_at timestamptz,
  file_url text,
  file_name text,
  file_type text,
  attachments text[],
  attachment_types text[]
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor public.profiles;
begin
  v_actor := public._current_comm_actor();
  if v_actor is null or not public._can_access_conversation(p_conversation_id) then
    raise exception 'Not authorized for this conversation';
  end if;

  return query
  select m.id,m.conversation_id,m.sender_id,m.content,m.seen,m.created_at,m.edited_at,
         m.file_url,m.file_name,m.file_type,m.attachments,m.attachment_types
  from public.messages m
  where m.conversation_id = p_conversation_id
    and not (
      v_actor.user_id = any(coalesce(m.hidden_for, '{}'::text[]))
    )
  order by m.created_at;
end
$function$;

revoke all on function public.get_roommate_messages_v2(uuid) from public, anon;
grant execute on function public.get_roommate_messages_v2(uuid) to authenticated;
