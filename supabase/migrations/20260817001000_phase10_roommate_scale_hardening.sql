-- Phase 10: scale roommate matching without changing eligibility or score semantics.

create index if not exists idx_profiles_roommate_candidate_state
  on public.profiles (lower(state), user_id)
  where role = 'user'
    and profile_complete is true
    and deleted is not true
    and suspended is not true
    and banned is not true
    and privacy_search_visible is not false
    and privacy_profile_visible is not false;

create index if not exists idx_roommate_prefs_active_budget
  on public.roommate_preferences (budget_min, budget_max, user_id)
  where active is true and search_status = 'active';

create index if not exists idx_roommate_results_rank
  on public.roommate_search_results (searcher_id, status, match_score desc, created_at desc);

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

  -- Rebuild only the transient candidate pool. Accepted/declined decisions remain stable.
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

create or replace function public.get_my_roommate_matches_page(p_limit integer default 24, p_offset integer default 0)
returns table(
  id uuid,
  matched_user_id text,
  match_score integer,
  status text,
  created_at timestamptz,
  username text,
  full_name text,
  avatar_url text,
  gender text,
  city text,
  state text,
  bio text,
  school text,
  area_preference text,
  mutual_accepted boolean,
  conversation_id uuid
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor public.profiles;
  v_prefs public.roommate_preferences;
  v_school text;
  v_limit integer := greatest(1, least(coalesce(p_limit,24), 50));
  v_offset integer := greatest(0, coalesce(p_offset,0));
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

  select * into v_prefs
  from public.roommate_preferences
  where user_id = v_actor.user_id
  limit 1;

  v_school := nullif(btrim(coalesce(v_prefs.school_name,v_actor.school,'')),'');

  return query
  select
    r.id,
    r.matched_user_id,
    r.match_score,
    r.status,
    r.created_at,
    p.username,
    p.full_name,
    p.avatar_url,
    p.gender,
    p.city,
    p.state,
    p.bio,
    coalesce(rp.school_name,p.school),
    rp.area_preference,
    exists(
      select 1
      from public.roommate_search_results rr
      where rr.searcher_id = r.matched_user_id
        and rr.matched_user_id = v_actor.user_id
        and rr.status = 'accepted'
    ),
    (
      select c.id
      from public.conversations c
      where c.conversation_type='roommate'
        and c.status='active'
        and ((c.participant_a=v_actor.user_id and c.participant_b=r.matched_user_id)
          or (c.participant_b=v_actor.user_id and c.participant_a=r.matched_user_id))
      limit 1
    )
  from public.roommate_search_results r
  join public.profiles p on p.user_id = r.matched_user_id
  left join public.roommate_preferences rp on rp.user_id = p.user_id
  where r.searcher_id = v_actor.user_id
    and r.status <> 'declined'
    and coalesce(p.deleted,false)=false
    and coalesce(p.suspended,false)=false
    and coalesce(p.banned,false)=false
    and (
      r.status='accepted'
      or (
        coalesce(p.privacy_search_visible,true)=true
        and coalesce(p.privacy_profile_visible,true)=true
        and coalesce(rp.active,false)=true
        and rp.search_status='active'
        and (not coalesce(v_prefs.school_match,false)
          or lower(regexp_replace(btrim(coalesce(rp.school_name,p.school,'')),'\s+',' ','g')) = lower(regexp_replace(btrim(coalesce(v_school,'')),'\s+',' ','g')))
      )
    )
  order by r.match_score desc, r.created_at desc, r.id
  limit v_limit offset v_offset;
end;
$function$;

create or replace function public.get_my_roommate_matches()
returns table(
  id uuid,
  matched_user_id text,
  match_score integer,
  status text,
  created_at timestamptz,
  username text,
  full_name text,
  avatar_url text,
  gender text,
  city text,
  state text,
  bio text,
  school text,
  area_preference text,
  mutual_accepted boolean,
  conversation_id uuid
)
language sql
security definer
set search_path = public
as $function$
  select * from public.get_my_roommate_matches_page(24,0);
$function$;

revoke all on function public.get_my_roommate_matches_page(integer,integer) from public;
grant execute on function public.get_my_roommate_matches_page(integer,integer) to authenticated;
revoke all on function public.refresh_my_roommate_search() from public;
grant execute on function public.refresh_my_roommate_search() to authenticated;
revoke all on function public.get_my_roommate_matches() from public;
grant execute on function public.get_my_roommate_matches() to authenticated;
