-- Creator ruling: a block hides both people from each other's signed-in
-- discovery. Existing conversations/obligations remain readable only where the
-- job, shared housing, payment or review lifecycle requires them.

create or replace function public.get_public_workers(
  p_state text default null,
  p_city text default null,
  p_occupation text default null
)
returns table(
  user_id text,full_name text,username text,avatar_url text,bio text,
  state text,city text,local_government text,area text,
  worker_occupation text,worker_skills jsonb,worker_price integer,
  worker_bio text,worker_experience text,rating numeric,review_count integer,
  is_online boolean,last_seen timestamptz,services jsonb,coverage jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id();
begin
  return query
  select
    profile.user_id,profile.full_name,profile.username,profile.avatar_url,
    profile.bio,profile.state,profile.city,profile.local_government,
    profile.area,profile.worker_occupation,profile.worker_skills,
    profile.worker_price,profile.worker_bio,profile.worker_experience,
    profile.rating,profile.review_count,profile.is_online,profile.last_seen,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',service.service_name,'price',service.price,
        'price_type',service.price_type
      )) from public.worker_services service
      where service.worker_id=profile.user_id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'state',coverage.state,'lga',coverage.lga,'areas',coverage.areas
      )) from public.worker_service_coverage coverage
      where coverage.worker_id=profile.user_id
    ),'[]'::jsonb)
  from public.profiles profile
  where public.user_has_active_workspace(profile.user_id,'worker')
    and profile.worker_status='verified'
    and profile.worker_verified=true
    and profile.available=true
    and not profile.deleted and not profile.suspended and not profile.banned
    and public.worker_identity_is_current(profile.user_id)
    and (p_state is null
      or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state))
    and (p_city is null or profile.city ilike p_city
      or profile.local_government ilike p_city)
    and (p_occupation is null
      or profile.worker_occupation ilike p_occupation)
    and not exists(
      select 1 from public.worker_user_blocks blocked_pair
      where v_actor is not null and (
        (blocked_pair.blocker_user_id=v_actor
          and blocked_pair.blocked_user_id=profile.user_id)
        or (blocked_pair.blocker_user_id=profile.user_id
          and blocked_pair.blocked_user_id=v_actor)
      )
    )
  order by profile.rating desc nulls last,
    profile.review_count desc nulls last;
end
$$;

create or replace function public.get_my_roommate_matches_page(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(
  id uuid,matched_user_id text,match_score integer,status text,
  created_at timestamptz,username text,full_name text,avatar_url text,
  gender text,city text,state text,bio text,school text,
  area_preference text,budget_score integer,location_score integer,
  cleanliness_score integer,noise_score integer,visitors_score integer,
  stay_score integer,mutual_accepted boolean,conversation_id uuid
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles; v_prefs public.roommate_preferences; v_school text;
  v_state text; v_lga text;
  v_limit integer:=greatest(1,least(coalesce(p_limit,24),50));
  v_offset integer:=greatest(0,coalesce(p_offset,0));
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text limit 1;
  if v_actor is null or not public.current_actor_has_personal_workspace()
    then raise exception 'Regular user required'; end if;
  if coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false)
     or coalesce(v_actor.banned,false)
    then raise exception 'Account is not active'; end if;
  select * into v_prefs from public.roommate_preferences
  where user_id=v_actor.user_id limit 1;
  if v_prefs is null then raise exception 'Roommate preferences required'; end if;
  v_school:=nullif(btrim(coalesce(v_prefs.school_name,v_actor.school,'')),'');
  v_state:=nullif(btrim(coalesce(v_actor.state,'')),'');
  v_lga:=nullif(btrim(coalesce(v_actor.local_government,v_actor.city,'')),'');
  if v_state is null or v_lga is null
    then raise exception 'State and LGA are required for roommate matching'; end if;

  return query with scored as (
    select
      result.id result_id,result.matched_user_id result_user_id,
      result.status result_status,result.created_at result_created_at,
      peer.username profile_username,peer.full_name profile_full_name,
      peer.avatar_url profile_avatar_url,peer.gender profile_gender,
      peer.city profile_city,peer.state profile_state,peer.bio profile_bio,
      case when coalesce(v_prefs.school_match,false)
        and coalesce(peer_prefs.school_match,false)
        then coalesce(peer_prefs.school_name,peer.school) else null end profile_school,
      peer_prefs.area_preference preference_area,
      round(30*(greatest(0,least(peer_prefs.budget_max,v_prefs.budget_max)
        -greatest(peer_prefs.budget_min,v_prefs.budget_min)+1)::numeric
        /greatest(1,least(peer_prefs.budget_max-peer_prefs.budget_min+1,
          v_prefs.budget_max-v_prefs.budget_min+1))))::integer budget_points,
      20::integer location_points,
      case when lower(coalesce(peer_prefs.cleanliness,''))=
        lower(coalesce(v_prefs.cleanliness,'')) then 15 else 0 end cleanliness_points,
      case when lower(coalesce(peer_prefs.noise_level,''))=
        lower(coalesce(v_prefs.noise_level,'')) then 15 else 0 end noise_points,
      case when lower(coalesce(peer_prefs.visitors,''))=
        lower(coalesce(v_prefs.visitors,'')) then 10 else 0 end visitors_points,
      case when lower(coalesce(peer_prefs.stay_duration,''))=
        lower(coalesce(v_prefs.stay_duration,'')) then 10 else 0 end stay_points
    from public.roommate_search_results result
    join public.profiles peer on peer.user_id=result.matched_user_id
    join public.roommate_preferences peer_prefs on peer_prefs.user_id=peer.user_id
    where result.searcher_id=v_actor.user_id and result.status<>'declined'
      and not coalesce(peer.deleted,false)
      and not coalesce(peer.suspended,false)
      and not coalesce(peer.banned,false)
      and lower(btrim(coalesce(peer.state,'')))=lower(v_state)
      and lower(btrim(coalesce(peer.local_government,peer.city,'')))=lower(v_lga)
      and (not coalesce(v_prefs.school_match,false)
        or lower(regexp_replace(btrim(coalesce(peer_prefs.school_name,peer.school,'')),'\s+',' ','g'))
          =lower(regexp_replace(v_school,'\s+',' ','g')))
      and (result.status='accepted' or (
        coalesce(peer.privacy_search_visible,true)
        and coalesce(peer.privacy_profile_visible,true)
        and coalesce(peer_prefs.active,false)
        and peer_prefs.search_status='active'))
      and not exists(
        select 1 from public.roommate_user_blocks blocked_pair
        where (blocked_pair.blocker_user_id=v_actor.user_id
            and blocked_pair.blocked_user_id=peer.user_id)
          or (blocked_pair.blocker_user_id=peer.user_id
            and blocked_pair.blocked_user_id=v_actor.user_id)
      )
  ), ranked as (
    select scored.*,
      least(100,budget_points+location_points+cleanliness_points
        +noise_points+visitors_points+stay_points)::integer current_score
    from scored
  )
  select
    ranked.result_id,ranked.result_user_id,ranked.current_score,
    ranked.result_status,ranked.result_created_at,ranked.profile_username,
    ranked.profile_full_name,ranked.profile_avatar_url,ranked.profile_gender,
    ranked.profile_city,ranked.profile_state,ranked.profile_bio,
    ranked.profile_school,ranked.preference_area,ranked.budget_points,
    ranked.location_points,ranked.cleanliness_points,ranked.noise_points,
    ranked.visitors_points,ranked.stay_points,
    exists(select 1 from public.roommate_search_results response
      where response.searcher_id=ranked.result_user_id
        and response.matched_user_id=v_actor.user_id
        and response.status='accepted'),
    (select conversation.id from public.conversations conversation
      where conversation.conversation_type='roommate'
        and conversation.status='active'
        and ((conversation.participant_a=v_actor.user_id
            and conversation.participant_b=ranked.result_user_id)
          or (conversation.participant_b=v_actor.user_id
            and conversation.participant_a=ranked.result_user_id)) limit 1)
  from ranked
  order by ranked.current_score desc,ranked.result_created_at desc,
    ranked.result_id limit v_limit offset v_offset;
end
$$;

create or replace function public.get_my_received_roommate_interests()
returns table(
  interest_id uuid,sender_user_id text,match_score integer,sent_at timestamptz,
  username text,full_name text,avatar_url text,city text,state text,
  school text,bio text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_actor_prefs public.roommate_preferences;
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
    incoming.id,incoming.searcher_id,incoming.match_score,incoming.updated_at,
    sender.username,sender.full_name,sender.avatar_url,sender.city,sender.state,
    case
      when coalesce(v_actor_prefs.school_match,false)
       and coalesce(sender_prefs.school_match,false)
       and lower(regexp_replace(btrim(coalesce(v_actor_prefs.school_name,v_actor.school,'')),'\s+',' ','g'))
         =lower(regexp_replace(btrim(coalesce(sender_prefs.school_name,sender.school,'')),'\s+',' ','g'))
      then nullif(btrim(coalesce(sender_prefs.school_name,sender.school,'')),'')
      else null
    end,
    sender.bio
  from public.roommate_search_results incoming
  join public.profiles sender on sender.user_id=incoming.searcher_id
  left join public.roommate_preferences sender_prefs
    on sender_prefs.user_id=sender.user_id
  left join public.roommate_search_results response
    on response.searcher_id=v_actor.user_id
   and response.matched_user_id=incoming.searcher_id
  where incoming.matched_user_id=v_actor.user_id
    and incoming.status='accepted'
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

revoke all on function public.get_public_workers(text,text,text) from public;
grant execute on function public.get_public_workers(text,text,text)
to anon,authenticated,service_role;
revoke all on function public.get_my_roommate_matches_page(integer,integer)
from public,anon;
grant execute on function public.get_my_roommate_matches_page(integer,integer)
to authenticated,service_role;
revoke all on function public.get_my_received_roommate_interests()
from public,anon;
grant execute on function public.get_my_received_roommate_interests()
to authenticated,service_role;

update public.function_execution_registry registry set
  public_allowed=has_function_privilege('public',registry.function_signature,'execute'),
  anon_allowed=has_function_privilege('anon',registry.function_signature,'execute'),
  authenticated_allowed=has_function_privilege(
    'authenticated',registry.function_signature,'execute'
  ),
  service_role_allowed=has_function_privilege(
    'service_role',registry.function_signature,'execute'
  ),
  review_state=case when registry.function_name='get_public_workers'
    then 'approved_public_projection' else 'approved_client_rpc' end,
  rationale=case when registry.function_name='get_public_workers'
    then 'Redacted public Worker projection; signed-in discovery excludes either-direction blocks.'
    else 'Personal Roommate projection excluding either-direction blocks while obligation history remains separate.' end,
  captured_at=now()
where registry.function_name in(
  'get_public_workers','get_my_roommate_matches_page',
  'get_my_received_roommate_interests'
);
