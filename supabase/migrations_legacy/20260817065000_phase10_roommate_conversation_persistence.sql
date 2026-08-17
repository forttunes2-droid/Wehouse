-- Existing Roommate conversations are durable after mutual acceptance.
-- Search state and transient match rows must not revoke an already-created chat.

create or replace function public._conversation_route_allowed(p_conversation_id uuid, p_actor_user_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  c public.conversations;
  a public.profiles;
  other public.profiles;
  other_id text;
begin
  select * into a from public.profiles where user_id = p_actor_user_id;
  select * into c from public.conversations where id = p_conversation_id;

  if a is null or c is null then return false; end if;
  if a.user_id not in (c.participant_a, c.participant_b) then return false; end if;
  if coalesce(c.status,'active') in ('archived','closed') then return false; end if;
  if c.conversation_type <> 'roommate' or a.role <> 'user' then return false; end if;
  if coalesce(a.deleted,false) or coalesce(a.suspended,false) or coalesce(a.banned,false) then return false; end if;

  other_id := case when c.participant_a = a.user_id then c.participant_b else c.participant_a end;
  select * into other from public.profiles where user_id = other_id;

  if other is null or other.role <> 'user'
     or coalesce(other.deleted,false)
     or coalesce(other.suspended,false)
     or coalesce(other.banned,false) then
    return false;
  end if;

  -- Mutual acceptance is enforced when the conversation is created.
  -- Once the active Roommate conversation exists, it becomes the durable authorization record.
  return true;
end;
$function$;

create or replace function public.get_my_roommate_conversation_people()
returns table(
  conversation_id uuid,
  user_id text,
  full_name text,
  username text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  a public.profiles;
begin
  select * into a
  from public.profiles
  where auth_id = auth.uid()::text
  limit 1;

  if a is null or a.role <> 'user'
     or coalesce(a.deleted,false)
     or coalesce(a.suspended,false)
     or coalesce(a.banned,false) then
    raise exception 'Active regular user required';
  end if;

  return query
  select
    c.id,
    p.user_id,
    p.full_name,
    p.username,
    p.avatar_url
  from public.conversations c
  join public.profiles p
    on p.user_id = case when c.participant_a = a.user_id then c.participant_b else c.participant_a end
  where c.conversation_type = 'roommate'
    and coalesce(c.status,'active') = 'active'
    and a.user_id in (c.participant_a,c.participant_b)
    and coalesce(p.deleted,false)=false
    and coalesce(p.suspended,false)=false
    and coalesce(p.banned,false)=false
    and p.role='user'
    and public._conversation_route_allowed(c.id,a.user_id)
  order by c.last_message_at desc nulls last, c.created_at desc;
end;
$function$;

revoke all on function public.get_my_roommate_conversation_people() from public;
grant execute on function public.get_my_roommate_conversation_people() to authenticated;

-- Existing conversations should not be re-offered as fresh transient matches.
create or replace function public.refresh_my_roommate_search()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor public.profiles;
  v_prefs public.roommate_preferences;
  v_count integer := 0;
  v_school text;
begin
  select * into v_actor
  from public.profiles
  where auth_id = auth.uid()::text
  limit 1;

  if v_actor is null or v_actor.role <> 'user' then
    raise exception 'Regular user required';
  end if;
  if coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then
    raise exception 'Account is not active';
  end if;
  if not coalesce(v_actor.profile_complete,false) then
    raise exception 'Complete your profile first';
  end if;
  if coalesce(v_actor.privacy_search_visible,true)=false or coalesce(v_actor.privacy_profile_visible,true)=false then
    raise exception 'Enable Roommate discovery and profile visibility first';
  end if;

  select * into v_prefs
  from public.roommate_preferences
  where user_id = v_actor.user_id
  for update;

  if v_prefs is null or v_prefs.search_status <> 'active' or coalesce(v_prefs.active,false)=false then
    raise exception 'Roommate matching is paused';
  end if;

  v_school := nullif(btrim(coalesce(v_prefs.school_name,v_actor.school,'')),'');
  if coalesce(v_prefs.school_match,false) and v_school is null then
    raise exception 'Enter your school before using same-school matching';
  end if;

  delete from public.roommate_search_results
  where searcher_id = v_actor.user_id
    and status in ('new','viewed');

  with ranked_candidates as (
    select
      c.user_id,
      least(100,
        round(30 * (
          greatest(0, least(cp.budget_max,v_prefs.budget_max) - greatest(cp.budget_min,v_prefs.budget_min) + 1)::numeric
          / greatest(1, least(cp.budget_max-cp.budget_min+1, v_prefs.budget_max-v_prefs.budget_min+1))
        ))::integer
        + case when nullif(btrim(coalesce(v_actor.local_government,v_actor.city,'')),'') is not null
            and lower(coalesce(nullif(c.local_government,''),c.city,'')) = lower(coalesce(nullif(v_actor.local_government,''),v_actor.city,'')) then 20 else 0 end
        + case when lower(coalesce(cp.cleanliness,'')) = lower(coalesce(v_prefs.cleanliness,'')) then 15 else 0 end
        + case when lower(coalesce(cp.noise_level,'')) = lower(coalesce(v_prefs.noise_level,'')) then 15 else 0 end
        + case when lower(coalesce(cp.visitors,'')) = lower(coalesce(v_prefs.visitors,'')) then 10 else 0 end
        + case when lower(coalesce(cp.stay_duration,'')) = lower(coalesce(v_prefs.stay_duration,'')) then 10 else 0 end
      )::integer as score
    from public.profiles c
    join public.roommate_preferences cp on cp.user_id = c.user_id
    where c.user_id <> v_actor.user_id
      and c.role = 'user'
      and coalesce(c.profile_complete,false)=true
      and coalesce(c.deleted,false)=false
      and coalesce(c.suspended,false)=false
      and coalesce(c.banned,false)=false
      and coalesce(c.privacy_search_visible,true)=true
      and coalesce(c.privacy_profile_visible,true)=true
      and cp.active=true
      and cp.search_status='active'
      and lower(coalesce(c.state,'')) = lower(coalesce(v_actor.state,''))
      and coalesce(cp.budget_max,0) >= v_prefs.budget_min
      and coalesce(cp.budget_min,999999999) <= v_prefs.budget_max
      and (v_prefs.gender_preference='no_preference' or lower(coalesce(c.gender,''))=lower(v_prefs.gender_preference))
      and (cp.gender_preference='no_preference' or lower(coalesce(v_actor.gender,''))=lower(cp.gender_preference))
      and (not coalesce(v_prefs.school_match,false)
        or lower(regexp_replace(btrim(coalesce(cp.school_name,c.school,'')),'\s+',' ','g')) = lower(regexp_replace(btrim(v_school),'\s+',' ','g')))
      and (not coalesce(cp.school_match,false)
        or lower(regexp_replace(btrim(coalesce(v_prefs.school_name,v_actor.school,'')),'\s+',' ','g')) = lower(regexp_replace(btrim(coalesce(cp.school_name,c.school,'')),'\s+',' ','g')))
      and not exists (
        select 1
        from public.roommate_search_results existing
        where existing.searcher_id = v_actor.user_id
          and existing.matched_user_id = c.user_id
          and existing.status in ('accepted','declined')
      )
      and not exists (
        select 1
        from public.conversations existing_conv
        where existing_conv.conversation_type='roommate'
          and coalesce(existing_conv.status,'active')='active'
          and ((existing_conv.participant_a=v_actor.user_id and existing_conv.participant_b=c.user_id)
            or (existing_conv.participant_b=v_actor.user_id and existing_conv.participant_a=c.user_id))
      )
    order by score desc, c.user_id
    limit 120
  )
  insert into public.roommate_search_results(searcher_id,matched_user_id,match_score,status,created_at,updated_at)
  select v_actor.user_id, rc.user_id, rc.score, 'new', now(), now()
  from ranked_candidates rc
  on conflict(searcher_id,matched_user_id) do update
    set match_score = excluded.match_score,
        updated_at = now();

  select count(*) into v_count
  from public.roommate_search_results
  where searcher_id = v_actor.user_id
    and status <> 'declined';

  update public.roommate_preferences
  set search_match_count = v_count,
      active = true,
      search_status = 'active',
      search_expires_at = null,
      updated_at = now()
  where user_id = v_actor.user_id;

  return v_count;
end;
$function$;

revoke all on function public.refresh_my_roommate_search() from public;
grant execute on function public.refresh_my_roommate_search() to authenticated;
