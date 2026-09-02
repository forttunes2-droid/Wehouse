-- A roommate block is relationship-wide. History remains readable, but neither
-- participant may be rediscovered, message, or call while either side blocks.
create or replace function public.enforce_roommate_match_not_blocked()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if exists (
    select 1 from public.roommate_user_blocks b
    where (b.blocker_user_id = new.searcher_id and b.blocked_user_id = new.matched_user_id)
       or (b.blocker_user_id = new.matched_user_id and b.blocked_user_id = new.searcher_id)
  ) then return null; end if;
  return new;
end $$;

drop trigger if exists roommate_match_reject_blocked on public.roommate_search_results;
create trigger roommate_match_reject_blocked before insert or update on public.roommate_search_results
for each row execute function public.enforce_roommate_match_not_blocked();

create or replace function public.enforce_roommate_message_not_blocked()
returns trigger language plpgsql security definer set search_path to '' as $$
declare peer text;
begin
  select case when c.participant_a = new.sender_id then c.participant_b else c.participant_a end
    into peer from public.conversations c
    where c.id = new.conversation_id and c.conversation_type = 'roommate'
      and new.sender_id in (c.participant_a,c.participant_b);
  if peer is not null and exists (
    select 1 from public.roommate_user_blocks b
    where (b.blocker_user_id = new.sender_id and b.blocked_user_id = peer)
       or (b.blocker_user_id = peer and b.blocked_user_id = new.sender_id)
  ) then raise exception 'This roommate connection is blocked'; end if;
  return new;
end $$;

drop trigger if exists roommate_message_reject_blocked on public.messages;
create trigger roommate_message_reject_blocked before insert on public.messages
for each row execute function public.enforce_roommate_message_not_blocked();

create or replace function public.enforce_roommate_call_not_blocked()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.context_type = 'roommate' and exists (
    select 1 from public.roommate_user_blocks b
    where (b.blocker_user_id = new.caller_id and b.blocked_user_id = new.callee_id)
       or (b.blocker_user_id = new.callee_id and b.blocked_user_id = new.caller_id)
  ) then raise exception 'This roommate connection is blocked'; end if;
  return new;
end $$;

drop trigger if exists roommate_call_reject_blocked on public.private_calls;
create trigger roommate_call_reject_blocked before insert on public.private_calls
for each row execute function public.enforce_roommate_call_not_blocked();

create or replace function public.set_my_roommate_block(p_user_id text,p_blocked boolean)
returns boolean language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare actor public.profiles;
begin
  actor := public._current_comm_actor();
  if actor is null or not public.current_actor_has_personal_workspace() or actor.user_id=p_user_id then
    raise exception 'Invalid roommate block request';
  end if;
  if not exists(select 1 from public.conversations c where c.conversation_type='roommate'
    and actor.user_id in(c.participant_a,c.participant_b) and p_user_id in(c.participant_a,c.participant_b)) then
    raise exception 'Roommate connection unavailable';
  end if;
  if p_blocked then
    insert into public.roommate_user_blocks(blocker_user_id,blocked_user_id)
    values(actor.user_id,p_user_id) on conflict do nothing;
    delete from public.roommate_search_results
      where (searcher_id=actor.user_id and matched_user_id=p_user_id)
         or (searcher_id=p_user_id and matched_user_id=actor.user_id);
    update public.private_calls set status=case when status='ringing' then 'declined' else 'ended' end,
      ended_at=coalesce(ended_at,now())
      where context_type='roommate' and status in('ringing','accepted')
        and ((caller_id=actor.user_id and callee_id=p_user_id) or (caller_id=p_user_id and callee_id=actor.user_id));
  else
    delete from public.roommate_user_blocks where blocker_user_id=actor.user_id and blocked_user_id=p_user_id;
  end if;
  return p_blocked;
end $$;

revoke all on function public.enforce_roommate_match_not_blocked(),public.enforce_roommate_message_not_blocked(),public.enforce_roommate_call_not_blocked() from public,anon,authenticated;
revoke all on function public.set_my_roommate_block(text,boolean) from public,anon;
grant execute on function public.set_my_roommate_block(text,boolean) to authenticated;
