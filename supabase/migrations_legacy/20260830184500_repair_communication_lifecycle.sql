-- Repair the authenticated booking-message lifecycle. The table-returning
-- function exposes an output column named `id`, so every source-column
-- reference must be qualified to avoid PL/pgSQL ambiguity.
create or replace function public.get_booking_messages(p_conversation_id uuid)
returns table(id uuid,sender_id text,sender_name text,sender_role text,content text,attachments text[],is_read boolean,created_at timestamptz)
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_conv public.booking_conversations;
begin
  v_actor := public._current_comm_actor();
  if v_actor is null then raise exception 'Authentication required'; end if;

  select bc.*
  into v_conv
  from public.booking_conversations bc
  where bc.id = p_conversation_id;

  if v_conv is null or v_actor.user_id not in (v_conv.user_id, v_conv.worker_id) then
    raise exception 'Not authorized for this booking conversation';
  end if;

  return query
  select bm.id, bm.sender_id, p.full_name, p.role, bm.content, bm.attachments, bm.is_read, bm.created_at
  from public.booking_messages bm
  join public.profiles p on p.user_id = bm.sender_id
  where bm.conversation_id = p_conversation_id
    and not (v_actor.user_id = any(coalesce(bm.hidden_for, array[]::text[])))
  order by bm.created_at;
end
$$;

revoke all on function public.get_booking_messages(uuid) from public, anon;
grant execute on function public.get_booking_messages(uuid) to authenticated, service_role;

-- This helper is referenced by the announcement-recipient SELECT policy.
-- It remains unavailable to PUBLIC/anon and returns only whether the current
-- authenticated profile sent the supplied announcement.
revoke all on function public.is_current_announcement_sender(bigint) from public, anon;
grant execute on function public.is_current_announcement_sender(bigint) to authenticated, service_role;
