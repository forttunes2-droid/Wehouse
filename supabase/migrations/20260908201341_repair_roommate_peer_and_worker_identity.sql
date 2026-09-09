-- Repair the private roommate peer projection and keep Worker identity
-- consistent between public discovery and an authorized booking conversation.

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

  select preferences.* into actor_prefs
  from public.roommate_preferences preferences
  where preferences.user_id=actor.user_id
  limit 1;

  return query
  select
    conversation.id,
    peer.user_id,
    peer.full_name,
    peer.username,
    peer.avatar_url,
    peer.bio,
    peer.city,
    peer.state,
    case
      when coalesce(actor_prefs.school_match,false)
       and coalesce(peer_prefs.school_match,false)
       and lower(regexp_replace(btrim(coalesce(actor_prefs.school_name,actor.school,'')),'\s+',' ','g'))
           = lower(regexp_replace(btrim(coalesce(peer_prefs.school_name,peer.school,'')),'\s+',' ','g'))
      then nullif(btrim(coalesce(peer_prefs.school_name,peer.school,'')),'')
      else null
    end,
    peer.occupation,
    peer.is_student,
    exists(
      select 1
      from public.roommate_user_blocks blocks
      where blocks.blocker_user_id=actor.user_id
        and blocks.blocked_user_id=peer.user_id
    )
  from public.conversations conversation
  join public.profiles peer
    on peer.user_id=case
      when conversation.participant_a=actor.user_id then conversation.participant_b
      else conversation.participant_a
    end
  left join public.roommate_preferences peer_prefs on peer_prefs.user_id=peer.user_id
  where conversation.conversation_type='roommate'
    and coalesce(conversation.status,'active')='active'
    and actor.user_id in (conversation.participant_a,conversation.participant_b)
    and coalesce(peer.deleted,false)=false
    and coalesce(peer.suspended,false)=false
    and coalesce(peer.banned,false)=false
    and peer.account_kind='consumer'
    and public._conversation_route_allowed(conversation.id,actor.user_id)
  order by conversation.last_message_at desc nulls last,conversation.created_at desc;
end
$$;

revoke all on function public.get_my_roommate_peer_details() from public, anon;
grant execute on function public.get_my_roommate_peer_details() to authenticated, service_role;

drop function if exists public.get_public_workers(text,text,text);
create function public.get_public_workers(
  p_state text default null,
  p_city text default null,
  p_occupation text default null
)
returns table(
  user_id text,
  full_name text,
  username text,
  avatar_url text,
  bio text,
  state text,
  city text,
  local_government text,
  area text,
  worker_occupation text,
  worker_skills jsonb,
  worker_price integer,
  worker_bio text,
  worker_experience text,
  rating numeric,
  review_count integer,
  is_online boolean,
  last_seen timestamptz,
  services jsonb,
  coverage jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  return query
  select
    profile.user_id,
    profile.full_name,
    profile.username,
    profile.avatar_url,
    profile.bio,
    profile.state,
    profile.city,
    profile.local_government,
    profile.area,
    profile.worker_occupation,
    profile.worker_skills,
    profile.worker_price,
    profile.worker_bio,
    profile.worker_experience,
    profile.rating,
    profile.review_count,
    profile.is_online,
    profile.last_seen,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',service.service_name,
        'price',service.price,
        'price_type',service.price_type
      ))
      from public.worker_services service
      where service.worker_id=profile.user_id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'state',coverage_row.state,
        'lga',coverage_row.lga,
        'areas',coverage_row.areas
      ))
      from public.worker_service_coverage coverage_row
      where coverage_row.worker_id=profile.user_id
    ),'[]'::jsonb)
  from public.profiles profile
  where profile.role='worker'
    and profile.worker_status='verified'
    and profile.worker_verified=true
    and profile.available=true
    and profile.deleted=false
    and profile.suspended=false
    and profile.banned=false
    and public.worker_identity_is_current(profile.user_id)
    and exists (
      select 1
      from public.booking_payments payment
      where payment.user_id=profile.user_id
        and payment.purpose='worker_verification'
        and payment.status in ('paid','completed')
    )
    and (p_state is null or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state))
    and (p_city is null or profile.city ilike p_city or profile.local_government ilike p_city)
    and (p_occupation is null or profile.worker_occupation ilike p_occupation)
  order by profile.rating desc nulls last,profile.review_count desc nulls last;
end
$$;

revoke all on function public.get_public_workers(text,text,text) from public, anon;
grant execute on function public.get_public_workers(text,text,text) to authenticated, service_role;
