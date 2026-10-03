-- Add the same compatibility explanation to incoming roommate requests.
-- This is a migration file only; it is not applied to a live project by this change.
drop function if exists public.get_my_received_roommate_interests();

create function public.get_my_received_roommate_interests()
returns table(
  interest_id uuid,
  sender_user_id text,
  match_score integer,
  sent_at timestamptz,
  username text,
  full_name text,
  avatar_url text,
  city text,
  state text,
  school text,
  bio text,
  match_highlights text[],
  discuss_before_deciding text[],
  compared_answers integer
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor public.profiles;
  v_actor_prefs public.roommate_preferences;
  v_compat jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text limit 1;

  if v_actor is null or not public.current_actor_has_personal_workspace()
     or coalesce(v_actor.deleted,false)
     or coalesce(v_actor.suspended,false)
     or coalesce(v_actor.banned,false)
    then raise exception 'Active regular user required'; end if;

  select * into v_actor_prefs from public.roommate_preferences
  where user_id=v_actor.user_id limit 1;

  return query
  select
    incoming.id,
    incoming.searcher_id,
    (public._roommate_practical_pair(v_actor.user_id,incoming.searcher_id)->>'score')::integer,
    incoming.updated_at,
    sender.username,
    sender.full_name,
    sender.avatar_url,
    sender_prefs.preferred_lga,
    sender_prefs.preferred_state,
    case
      when coalesce(v_actor_prefs.school_match,false)
       and coalesce(sender_prefs.school_match,false)
       and lower(regexp_replace(btrim(coalesce(v_actor_prefs.school_name,v_actor.school,'')),'\s+',' ','g'))
         = lower(regexp_replace(btrim(coalesce(sender_prefs.school_name,sender.school,'')),'\s+',' ','g'))
      then nullif(btrim(coalesce(sender_prefs.school_name,sender.school,'')),'')
      else null
    end,
    sender.bio,
    coalesce((public._roommate_practical_pair(v_actor.user_id,incoming.searcher_id)->'highlights')::text[],'{}'::text[]),
    coalesce((public._roommate_practical_pair(v_actor.user_id,incoming.searcher_id)->'discuss')::text[],'{}'::text[]),
    coalesce((public._roommate_practical_pair(v_actor.user_id,incoming.searcher_id)->>'compared_answers')::integer,0)
  from public.roommate_search_results incoming
  join public.profiles sender on sender.user_id=incoming.searcher_id
  left join public.roommate_preferences sender_prefs
    on sender_prefs.user_id=sender.user_id
  left join public.roommate_search_results response
    on response.searcher_id=v_actor.user_id
   and response.matched_user_id=incoming.searcher_id
  where incoming.matched_user_id=v_actor.user_id
    and incoming.status='accepted'
    and public._roommate_pair_open(v_actor.user_id,incoming.searcher_id)
    and coalesce(response.status,'new') not in('accepted','declined')
    and not coalesce(sender.deleted,false)
    and not coalesce(sender.suspended,false)
    and not coalesce(sender.banned,false)
    and coalesce(sender.privacy_profile_visible,true)
    and not exists(
      select 1 from public.roommate_user_blocks blocked_pair
      where (blocked_pair.blocker_user_id=v_actor.user_id
          and blocked_pair.blocked_user_id=sender.user_id)
        or (blocked_pair.blocker_user_id=sender.user_id
          and blocked_pair.blocked_user_id=v_actor.user_id)
    )
    and not exists(
      select 1 from public.conversations conversation
      where conversation.conversation_type='roommate'
        and conversation.status='active'
        and ((conversation.participant_a=v_actor.user_id
            and conversation.participant_b=incoming.searcher_id)
          or (conversation.participant_b=v_actor.user_id
            and conversation.participant_a=incoming.searcher_id))
    )
  order by incoming.updated_at desc;
end
$$;

revoke all on function public.get_my_received_roommate_interests() from public,anon;
grant execute on function public.get_my_received_roommate_interests() to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  p.oid::regprocedure::text,
  p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  'approved_client_rpc',
  'Incoming roommate requests include the same compatibility explanation shown after a mutual match',
  now()
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='get_my_received_roommate_interests'
on conflict(function_signature) do update set
  authenticated_allowed=excluded.authenticated_allowed,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=excluded.captured_at;
