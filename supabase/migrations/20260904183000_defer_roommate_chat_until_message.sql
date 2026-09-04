-- Mutual roommate acceptance is a durable connection, not an Inbox thread.
-- A conversation is created only when either person explicitly opens Message;
-- get_user_conversations continues to hide it until the first message exists.

create or replace function public.ensure_my_roommate_conversation(p_peer_user_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_conversation_id uuid;
  v_pair_key text;
begin
  v_actor := public._current_comm_actor();
  if v_actor is null or not public.current_actor_has_personal_workspace()
     or coalesce(v_actor.deleted, false) or coalesce(v_actor.suspended, false) or coalesce(v_actor.banned, false) then
    raise exception 'Active regular user required';
  end if;
  if nullif(btrim(p_peer_user_id), '') is null or p_peer_user_id = v_actor.user_id then
    raise exception 'Roommate connection unavailable';
  end if;
  if not exists (
    select 1
    from public.roommate_search_results mine
    join public.roommate_search_results theirs
      on theirs.searcher_id = mine.matched_user_id
     and theirs.matched_user_id = mine.searcher_id
     and theirs.status = 'accepted'
    where mine.searcher_id = v_actor.user_id
      and mine.matched_user_id = p_peer_user_id
      and mine.status = 'accepted'
  ) then
    raise exception 'Both people must accept before messaging';
  end if;
  if exists (
    select 1 from public.roommate_user_blocks block
    where (block.blocker_user_id = v_actor.user_id and block.blocked_user_id = p_peer_user_id)
       or (block.blocker_user_id = p_peer_user_id and block.blocked_user_id = v_actor.user_id)
  ) then
    raise exception 'This roommate connection is blocked';
  end if;

  v_pair_key := least(v_actor.user_id, p_peer_user_id) || '|' || greatest(v_actor.user_id, p_peer_user_id);
  perform pg_advisory_xact_lock(hashtextextended(v_pair_key, 0));

  select conversation.id into v_conversation_id
  from public.conversations conversation
  where conversation.conversation_type = 'roommate'
    and ((conversation.participant_a = v_actor.user_id and conversation.participant_b = p_peer_user_id)
      or (conversation.participant_b = v_actor.user_id and conversation.participant_a = p_peer_user_id))
  order by (conversation.status = 'active') desc, conversation.created_at
  limit 1;

  if v_conversation_id is null then
    insert into public.conversations(
      participant_a, participant_b, status, conversation_type, subject,
      created_at, last_message_at, unread_a, unread_b
    ) values (
      v_actor.user_id, p_peer_user_id, 'active', 'roommate', 'Roommate Match',
      now(), now(), 0, 0
    ) returning id into v_conversation_id;
  else
    update public.conversations
    set status = 'active'
    where id = v_conversation_id and status is distinct from 'active';
  end if;

  return v_conversation_id;
end;
$$;

revoke all on function public.ensure_my_roommate_conversation(text) from public, anon;
grant execute on function public.ensure_my_roommate_conversation(text) to authenticated, service_role;

create or replace function public.update_my_roommate_match_status(p_match_id uuid, p_status text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_match public.roommate_search_results;
  v_reverse public.roommate_search_results;
  v_conversation_id uuid;
begin
  if p_status not in ('new', 'viewed', 'accepted', 'declined') then raise exception 'Invalid match status'; end if;
  select * into v_actor from public.profiles where auth_id = auth.uid()::text limit 1;
  if v_actor is null or v_actor.role <> 'user' or coalesce(v_actor.deleted, false)
     or coalesce(v_actor.suspended, false) or coalesce(v_actor.banned, false) then
    raise exception 'Active regular user required';
  end if;
  select * into v_match from public.roommate_search_results
  where id = p_match_id and searcher_id = v_actor.user_id for update;
  if v_match is null then raise exception 'Match not found'; end if;

  update public.roommate_search_results
  set status = p_status, updated_at = now()
  where id = p_match_id;

  if p_status = 'accepted' then
    if v_match.status is distinct from 'accepted' then
      insert into public.notifications(recipient_id, type, title, message, related_id, read)
      select v_match.matched_user_id, 'roommate_interest', 'New roommate interest',
        coalesce(nullif(v_actor.full_name, ''), nullif(v_actor.username, ''), 'Someone') || ' is interested in being roommates with you.',
        v_match.id::text, false
      where not exists (
        select 1 from public.notifications notification
        where notification.recipient_id = v_match.matched_user_id
          and notification.type = 'roommate_interest'
          and notification.related_id = v_match.id::text
          and not notification.read
      );
    end if;

    select * into v_reverse from public.roommate_search_results
    where searcher_id = v_match.matched_user_id
      and matched_user_id = v_actor.user_id
      and status = 'accepted'
    limit 1;

    if v_reverse is not null then
      select conversation.id into v_conversation_id
      from public.conversations conversation
      where conversation.conversation_type = 'roommate'
        and ((conversation.participant_a = v_actor.user_id and conversation.participant_b = v_match.matched_user_id)
          or (conversation.participant_b = v_actor.user_id and conversation.participant_a = v_match.matched_user_id))
      order by (conversation.status = 'active') desc, conversation.created_at
      limit 1;

      update public.notifications set read = true
      where recipient_id = v_match.matched_user_id
        and type = 'roommate_interest'
        and related_id = v_match.id::text;

      insert into public.notifications(recipient_id, type, title, message, related_id, read, destination_route)
      select v_match.matched_user_id, 'roommate_match', 'You have a roommate match',
        'You both expressed interest. Open Roommates when you want to start a conversation.',
        coalesce(v_conversation_id::text, v_match.id::text), false, 'roommate'
      where not exists (
        select 1 from public.notifications notification
        where notification.recipient_id = v_match.matched_user_id
          and notification.type = 'roommate_match'
          and notification.related_id = coalesce(v_conversation_id::text, v_match.id::text)
      );
    end if;
  end if;
  return v_conversation_id;
end;
$$;

create or replace function public.respond_to_my_roommate_interest(p_interest_id uuid, p_response text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_interest public.roommate_search_results;
  v_conversation_id uuid;
begin
  if p_response not in ('accepted', 'declined') then raise exception 'Response must be accepted or declined'; end if;
  select * into v_actor from public.profiles where auth_id = auth.uid()::text limit 1;
  if v_actor is null or not public.current_actor_has_personal_workspace()
     or coalesce(v_actor.deleted, false) or coalesce(v_actor.suspended, false) or coalesce(v_actor.banned, false) then
    raise exception 'Active regular user required';
  end if;
  select * into v_interest from public.roommate_search_results
  where id = p_interest_id and matched_user_id = v_actor.user_id and status = 'accepted'
  for update;
  if v_interest is null then raise exception 'Roommate interest not found'; end if;

  insert into public.roommate_search_results(searcher_id, matched_user_id, match_score, status, created_at, updated_at)
  values(v_actor.user_id, v_interest.searcher_id, v_interest.match_score, p_response, now(), now())
  on conflict(searcher_id, matched_user_id) do update
  set status = excluded.status, updated_at = now();

  update public.notifications set read = true
  where recipient_id = v_actor.user_id and type = 'roommate_interest' and related_id = v_interest.id::text;

  if p_response = 'accepted' then
    select conversation.id into v_conversation_id
    from public.conversations conversation
    where conversation.conversation_type = 'roommate'
      and ((conversation.participant_a = v_actor.user_id and conversation.participant_b = v_interest.searcher_id)
        or (conversation.participant_b = v_actor.user_id and conversation.participant_a = v_interest.searcher_id))
    order by (conversation.status = 'active') desc, conversation.created_at
    limit 1;

    insert into public.notifications(recipient_id, type, title, message, related_id, read, destination_route)
    select v_interest.searcher_id, 'roommate_match', 'Roommate interest accepted',
      coalesce(nullif(v_actor.full_name, ''), nullif(v_actor.username, ''), 'Your match') ||
        ' accepted your interest. Open Roommates when you want to start a conversation.',
      coalesce(v_conversation_id::text, v_interest.id::text), false, 'roommate'
    where not exists (
      select 1 from public.notifications notification
      where notification.recipient_id = v_interest.searcher_id
        and notification.type = 'roommate_match'
        and notification.related_id = coalesce(v_conversation_id::text, v_interest.id::text)
    );
  end if;
  return v_conversation_id;
end;
$$;

revoke all on function public.update_my_roommate_match_status(uuid, text) from public, anon;
revoke all on function public.respond_to_my_roommate_interest(uuid, text) from public, anon;
grant execute on function public.update_my_roommate_match_status(uuid, text) to authenticated, service_role;
grant execute on function public.respond_to_my_roommate_interest(uuid, text) to authenticated, service_role;
