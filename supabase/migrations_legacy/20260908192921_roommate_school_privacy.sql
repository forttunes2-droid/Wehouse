-- A school is private unless both roommate participants explicitly enabled
-- same-school matching and the normalized school names are equal.

create or replace function public.get_my_received_roommate_interests()
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
  bio text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor public.profiles;
  v_actor_prefs public.roommate_preferences;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
  limit 1;

  if v_actor is null
     or not public.current_actor_has_personal_workspace()
     or coalesce(v_actor.deleted,false)
     or coalesce(v_actor.suspended,false)
     or coalesce(v_actor.banned,false) then
    raise exception 'Active regular user required';
  end if;

  select * into v_actor_prefs
  from public.roommate_preferences
  where user_id=v_actor.user_id
  limit 1;

  return query
  select
    incoming.id,
    incoming.searcher_id,
    incoming.match_score,
    incoming.updated_at,
    sender.username,
    sender.full_name,
    sender.avatar_url,
    sender.city,
    sender.state,
    case
      when coalesce(v_actor_prefs.school_match,false)
       and coalesce(sender_prefs.school_match,false)
       and lower(regexp_replace(btrim(coalesce(v_actor_prefs.school_name,v_actor.school,'')),'\s+',' ','g'))
           = lower(regexp_replace(btrim(coalesce(sender_prefs.school_name,sender.school,'')),'\s+',' ','g'))
      then nullif(btrim(coalesce(sender_prefs.school_name,sender.school,'')),'')
      else null
    end,
    sender.bio
  from public.roommate_search_results incoming
  join public.profiles sender on sender.user_id=incoming.searcher_id
  left join public.roommate_preferences sender_prefs on sender_prefs.user_id=sender.user_id
  left join public.roommate_search_results response
    on response.searcher_id=v_actor.user_id
   and response.matched_user_id=incoming.searcher_id
  where incoming.matched_user_id=v_actor.user_id
    and incoming.status='accepted'
    and coalesce(response.status,'new') not in ('accepted','declined')
    and coalesce(sender.deleted,false)=false
    and coalesce(sender.suspended,false)=false
    and coalesce(sender.banned,false)=false
    and coalesce(sender.privacy_profile_visible,true)=true
    and not exists(
      select 1
      from public.conversations c
      where c.conversation_type='roommate'
        and c.status='active'
        and ((c.participant_a=v_actor.user_id and c.participant_b=incoming.searcher_id)
          or (c.participant_b=v_actor.user_id and c.participant_a=incoming.searcher_id))
    )
  order by incoming.updated_at desc;
end
$$;

create or replace function public.get_my_roommate_peer_details()
returns table(
  conversation_id uuid,
  user_id text,
  full_name text,
  username text,
  avatar_url text,
  bio text,
  city text,
  state text,
  school text,
  occupation text,
  is_student boolean,
  is_blocked boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  actor public.profiles;
  actor_prefs public.roommate_preferences;
begin
  actor := public._current_comm_actor();
  if actor is null or not public.current_actor_has_personal_workspace() then
    raise exception 'Regular user account required';
  end if;

  select * into actor_prefs
  from public.roommate_preferences
  where user_id=actor.user_id
  limit 1;

  return query
  select
    c.id,
    p.user_id,
    p.full_name,
    p.username,
    p.avatar_url,
    p.bio,
    p.city,
    p.state,
    case
      when coalesce(actor_prefs.school_match,false)
       and coalesce(peer_prefs.school_match,false)
       and lower(regexp_replace(btrim(coalesce(actor_prefs.school_name,actor.school,'')),'\s+',' ','g'))
           = lower(regexp_replace(btrim(coalesce(peer_prefs.school_name,p.school,'')),'\s+',' ','g'))
      then nullif(btrim(coalesce(peer_prefs.school_name,p.school,'')),'')
      else null
    end,
    p.occupation,
    p.is_student,
    exists(
      select 1
      from public.roommate_user_blocks b
      where b.blocker_user_id=actor.user_id
        and b.blocked_user_id=p.user_id
    )
  from public.conversations c
  join public.profiles p
    on p.user_id=case when c.participant_a=actor.user_id then c.participant_b else c.participant_a end
  left join public.roommate_preferences peer_prefs on peer_prefs.user_id=p.user_id
  where c.conversation_type='roommate'
    and coalesce(c.status,'active')='active'
    and actor.user_id in (c.participant_a,c.participant_b)
    and coalesce(p.deleted,false)=false
    and coalesce(p.suspended,false)=false
    and coalesce(p.banned,false)=false
    and p.account_kind='consumer'
    and public._conversation_route_allowed(c.id,actor.user_id)
  order by c.last_message_at desc nulls last,c.created_at desc;
end
$$;
