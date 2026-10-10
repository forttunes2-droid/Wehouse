begin;

-- Withdraw only a one-sided roommate interest. The request disappears from the
-- recipient's actionable queue, while its notification is retained as read
-- history so Activity never keeps presenting a withdrawn request as pending.
create or replace function public.cancel_my_roommate_interest(p_match_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor public.profiles;
  v_match public.roommate_search_results;
  v_reverse_status text;
begin
  select * into v_actor
  from public.profiles
  where auth_id = (select auth.uid())::text
  limit 1;

  if v_actor is null
     or not public.current_actor_has_personal_workspace()
     or coalesce(v_actor.deleted, false)
     or coalesce(v_actor.suspended, false)
     or coalesce(v_actor.banned, false) then
    raise exception 'Active regular user required';
  end if;

  select * into v_match
  from public.roommate_search_results
  where id = p_match_id and searcher_id = v_actor.user_id
  for update;

  if v_match.id is null then
    raise exception 'Roommate request not found';
  end if;
  if v_match.status is distinct from 'accepted' then
    raise exception 'Only a pending roommate request can be cancelled';
  end if;

  select response.status into v_reverse_status
  from public.roommate_search_results response
  where response.searcher_id = v_match.matched_user_id
    and response.matched_user_id = v_actor.user_id
  limit 1
  for update;

  if v_reverse_status in ('accepted', 'declined') then
    raise exception 'This roommate request has already been answered';
  end if;

  if exists (
    select 1 from public.conversations conversation
    where conversation.conversation_type = 'roommate'
      and conversation.status in ('active', 'accepted')
      and (
        (conversation.participant_a = v_actor.user_id and conversation.participant_b = v_match.matched_user_id)
        or (conversation.participant_b = v_actor.user_id and conversation.participant_a = v_match.matched_user_id)
      )
  ) then
    raise exception 'This connection already exists; its conversation was not changed';
  end if;

  update public.roommate_search_results
  set status = 'viewed', updated_at = now()
  where id = v_match.id and searcher_id = v_actor.user_id;

  update public.notifications
  set type = 'roommate_interest_withdrawn',
      title = 'Roommate request withdrawn',
      message = 'The sender withdrew this request before a match was made.',
      read = true,
      read_at = coalesce(read_at, now()),
      destination_route = 'roommate',
      destination_params = jsonb_build_object('interest_id', v_match.id, 'request_status', 'withdrawn')
  where recipient_id = v_match.matched_user_id
    and type = 'roommate_interest'
    and related_id = v_match.id::text;

  return true;
end;
$$;

-- The mirror must run when a legacy notification changes event type, otherwise
-- its old roommate_interest event would remain an actionable canonical Activity row.
drop trigger if exists notification_canonical_activity_mirror on public.notifications;
create trigger notification_canonical_activity_mirror
after insert or update of type, read, read_at, title, message, destination_route, destination_params
on public.notifications
for each row execute function public.mirror_notification_to_activity();

revoke all on function public.cancel_my_roommate_interest(uuid) from public, anon;
grant execute on function public.cancel_my_roommate_interest(uuid) to authenticated, service_role;

insert into public.function_execution_registry(
  function_signature, function_name, security_mode, public_allowed, anon_allowed,
  authenticated_allowed, service_role_allowed, review_state, rationale, captured_at
)
select
  p.oid::regprocedure::text, p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public', p.oid, 'execute'),
  has_function_privilege('anon', p.oid, 'execute'),
  has_function_privilege('authenticated', p.oid, 'execute'),
  has_function_privilege('service_role', p.oid, 'execute'),
  'approved_client_rpc',
  'Allows a sender to withdraw a pending one-sided roommate interest; preserves established connections and resolves recipient Activity.',
  now()
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cancel_my_roommate_interest'
on conflict(function_signature) do update set
  authenticated_allowed = excluded.authenticated_allowed,
  public_allowed = excluded.public_allowed,
  anon_allowed = excluded.anon_allowed,
  service_role_allowed = excluded.service_role_allowed,
  review_state = excluded.review_state,
  rationale = excluded.rationale,
  captured_at = excluded.captured_at;

commit;
