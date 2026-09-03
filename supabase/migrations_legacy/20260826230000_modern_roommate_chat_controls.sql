create table if not exists public.roommate_user_blocks (
  blocker_user_id text not null references public.profiles(user_id) on delete cascade,
  blocked_user_id text not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint roommate_user_blocks_not_self check (blocker_user_id <> blocked_user_id)
);
alter table public.roommate_user_blocks enable row level security;
revoke all on public.roommate_user_blocks from anon, authenticated;
create policy "roommate blocks private select" on public.roommate_user_blocks for select to authenticated using (false);
create policy "roommate blocks private insert" on public.roommate_user_blocks for insert to authenticated with check (false);
create policy "roommate blocks private update" on public.roommate_user_blocks for update to authenticated using (false) with check (false);
create policy "roommate blocks private delete" on public.roommate_user_blocks for delete to authenticated using (false);

CREATE OR REPLACE FUNCTION public.get_my_roommate_peer_details()
 RETURNS TABLE(conversation_id uuid, user_id text, full_name text, username text, avatar_url text, bio text, city text, state text, school text, occupation text, is_student boolean, is_blocked boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor public.profiles;
begin
  actor := public._current_comm_actor();
  if actor is null or actor.role <> 'user' then
    raise exception 'Regular user account required';
  end if;

  return query
  select c.id, p.user_id, p.full_name, p.username, p.avatar_url,
    p.bio, p.city, p.state, p.school, p.occupation, p.is_student,
    exists(
      select 1 from public.roommate_user_blocks b
      where b.blocker_user_id = actor.user_id and b.blocked_user_id = p.user_id
    )
  from public.conversations c
  join public.profiles p
    on p.user_id = case when c.participant_a = actor.user_id then c.participant_b else c.participant_a end
  where c.conversation_type = 'roommate'
    and coalesce(c.status, 'active') = 'active'
    and actor.user_id in (c.participant_a, c.participant_b)
    and coalesce(p.deleted, false) = false
    and coalesce(p.suspended, false) = false
    and coalesce(p.banned, false) = false
    and p.role = 'user'
    and public._conversation_route_allowed(c.id, actor.user_id)
  order by c.last_message_at desc nulls last, c.created_at desc;
end;
$function$


CREATE OR REPLACE FUNCTION public.send_my_roommate_message_v2(p_conversation_id uuid, p_content text DEFAULT ''::text, p_attachments text[] DEFAULT '{}'::text[], p_attachment_types text[] DEFAULT '{}'::text[])
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor public.profiles;
  conv public.conversations;
  outgoing public.messages;
  peer_id text;
  attachment_path text;
  attachment_type text;
  i integer;
begin
  actor := public._current_comm_actor();
  if actor is null or actor.role <> 'user' then raise exception 'Regular user account required'; end if;
  select * into conv from public.conversations where id = p_conversation_id;
  if conv is null or conv.conversation_type <> 'roommate'
     or actor.user_id not in (conv.participant_a, conv.participant_b)
     or not public._can_access_conversation(p_conversation_id) then
    raise exception 'Roommate conversation unavailable';
  end if;
  peer_id := case when conv.participant_a = actor.user_id then conv.participant_b else conv.participant_a end;
  if exists (
    select 1 from public.roommate_user_blocks b
    where (b.blocker_user_id = actor.user_id and b.blocked_user_id = peer_id)
       or (b.blocker_user_id = peer_id and b.blocked_user_id = actor.user_id)
  ) then
    raise exception 'Messages are blocked in this conversation';
  end if;
  if nullif(btrim(coalesce(p_content, '')), '') is null and coalesce(cardinality(p_attachments), 0) = 0 then
    raise exception 'Message, photo or voice note is required';
  end if;
  if coalesce(cardinality(p_attachments), 0) > 6 then raise exception 'A maximum of 6 attachments can be sent at once'; end if;
  if coalesce(cardinality(p_attachments), 0) <> coalesce(cardinality(p_attachment_types), 0) then raise exception 'Attachment metadata mismatch'; end if;
  if coalesce(cardinality(p_attachments), 0) > 0 then
    for i in 1..cardinality(p_attachments) loop
      attachment_path := p_attachments[i]; attachment_type := coalesce(p_attachment_types[i], '');
      if attachment_path is null or attachment_path not like p_conversation_id::text || '/%' then raise exception 'Invalid attachment path'; end if;
      if attachment_type not like 'image/%' and attachment_type not like 'audio/%' then raise exception 'Roommate chat supports photos and voice notes only'; end if;
    end loop;
  end if;
  insert into public.messages(conversation_id, sender_id, content, seen, created_at, attachments, attachment_types)
  values(p_conversation_id, actor.user_id, coalesce(btrim(p_content), ''), false, now(), coalesce(p_attachments, '{}'::text[]), coalesce(p_attachment_types, '{}'::text[]))
  returning * into outgoing;
  return outgoing;
end;
$function$


CREATE OR REPLACE FUNCTION public.set_my_roommate_block(p_user_id text, p_blocked boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor public.profiles;
begin
  actor := public._current_comm_actor();
  if actor is null or actor.role <> 'user' or actor.user_id = p_user_id then
    raise exception 'Invalid roommate block request';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.conversation_type = 'roommate'
      and coalesce(c.status, 'active') = 'active'
      and actor.user_id in (c.participant_a, c.participant_b)
      and p_user_id in (c.participant_a, c.participant_b)
  ) then
    raise exception 'Roommate conversation unavailable';
  end if;

  if p_blocked then
    insert into public.roommate_user_blocks(blocker_user_id, blocked_user_id)
    values(actor.user_id, p_user_id) on conflict do nothing;
  else
    delete from public.roommate_user_blocks
    where blocker_user_id = actor.user_id and blocked_user_id = p_user_id;
  end if;
  return p_blocked;
end;
$function$


revoke all on function public.get_my_roommate_peer_details() from public, anon;
revoke all on function public.set_my_roommate_block(text, boolean) from public, anon;
revoke all on function public.send_my_roommate_message_v2(uuid, text, text[], text[]) from public, anon;
grant execute on function public.get_my_roommate_peer_details() to authenticated;
grant execute on function public.set_my_roommate_block(text, boolean) to authenticated;
grant execute on function public.send_my_roommate_message_v2(uuid, text, text[], text[]) to authenticated;
