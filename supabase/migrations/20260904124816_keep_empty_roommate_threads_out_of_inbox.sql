-- Roommate connections live on the Roommates surface. Opening the composer is
-- allowed immediately, but Inbox should receive the thread only after either
-- person sends the first message.
create or replace function public.get_user_conversations(p_user_id text)
returns setof public.conversations
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  actor public.profiles;
begin
  actor := public._current_comm_actor();
  if actor is null then
    raise exception 'Authentication required';
  end if;
  if p_user_id is distinct from actor.user_id then
    raise exception 'User identity mismatch';
  end if;

  return query
    select conversation.*
    from public.conversations conversation
    where (conversation.participant_a = actor.user_id or conversation.participant_b = actor.user_id)
      and public._can_access_conversation(conversation.id)
      and public._conversation_route_allowed(conversation.id, actor.user_id)
      and exists (
        select 1
        from public.messages message
        where message.conversation_id = conversation.id
      )
      and (
        (conversation.participant_a = actor.user_id and (conversation.hidden_at_a is null or conversation.last_message_at > conversation.hidden_at_a))
        or
        (conversation.participant_b = actor.user_id and (conversation.hidden_at_b is null or conversation.last_message_at > conversation.hidden_at_b))
      )
    order by conversation.last_message_at desc nulls last, conversation.created_at desc;
end;
$$;

revoke all on function public.get_user_conversations(text) from public;
grant execute on function public.get_user_conversations(text) to authenticated;
grant execute on function public.get_user_conversations(text) to service_role;
