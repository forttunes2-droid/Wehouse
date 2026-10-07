create or replace function public.get_my_received_roommate_interests_v2()
returns setof jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  actor public.profiles;
  actor_prefs public.roommate_preferences;
begin
  select * into actor from public.profiles
  where auth_id=(select auth.uid())::text limit 1;
  if actor is null or not public.current_actor_has_personal_workspace()
     or coalesce(actor.deleted,false) or coalesce(actor.suspended,false) or coalesce(actor.banned,false)
  then raise exception 'Active regular user required'; end if;

  select * into actor_prefs from public.roommate_preferences
  where user_id=actor.user_id limit 1;

  return query
  select jsonb_build_object(
    'interest_id', incoming.id,
    'sender_user_id', incoming.searcher_id,
    'match_score', (compatibility->>'score')::integer,
    'sent_at', incoming.updated_at,
    'username', sender.username,
    'full_name', sender.full_name,
    'avatar_url', sender.avatar_url,
    'city', sender_prefs.preferred_lga,
    'state', sender_prefs.preferred_state,
    'school', case
      when coalesce(actor_prefs.school_match,false)
       and coalesce(sender_prefs.school_match,false)
       and public._roommate_normalize(coalesce(actor_prefs.school_name,actor.school,''))
         = public._roommate_normalize(coalesce(sender_prefs.school_name,sender.school,''))
      then nullif(btrim(coalesce(sender_prefs.school_name,sender.school,'')),'')
      else null end,
    'bio', sender.bio,
    'match_highlights', coalesce(compatibility->'highlights','[]'::jsonb),
    'discuss_before_deciding', coalesce(compatibility->'discuss','[]'::jsonb),
    'compared_answers', coalesce(compatibility->'compared_answers','0'::jsonb)
  )
  from public.roommate_search_results incoming
  join public.profiles sender on sender.user_id=incoming.searcher_id
  left join public.roommate_preferences sender_prefs on sender_prefs.user_id=sender.user_id
  cross join lateral public._roommate_practical_pair(actor.user_id,incoming.searcher_id) compatibility
  left join public.roommate_search_results response
    on response.searcher_id=actor.user_id and response.matched_user_id=incoming.searcher_id
  where incoming.matched_user_id=actor.user_id
    and incoming.status='accepted'
    and public._roommate_pair_open(actor.user_id,incoming.searcher_id)
    and coalesce(response.status,'new') not in('accepted','declined')
    and not coalesce(sender.deleted,false) and not coalesce(sender.suspended,false) and not coalesce(sender.banned,false)
    and coalesce(sender.privacy_profile_visible,true)
    and not exists(
      select 1 from public.roommate_user_blocks blocked_pair
      where (blocked_pair.blocker_user_id=actor.user_id and blocked_pair.blocked_user_id=sender.user_id)
         or (blocked_pair.blocker_user_id=sender.user_id and blocked_pair.blocked_user_id=actor.user_id)
    )
    and not exists(
      select 1 from public.conversations conversation
      where conversation.conversation_type='roommate' and conversation.status='active'
        and ((conversation.participant_a=actor.user_id and conversation.participant_b=incoming.searcher_id)
          or (conversation.participant_b=actor.user_id and conversation.participant_a=incoming.searcher_id))
    )
  order by incoming.updated_at desc;
end
$$;

revoke all on function public.get_my_received_roommate_interests_v2() from public,anon;
grant execute on function public.get_my_received_roommate_interests_v2() to authenticated,service_role;