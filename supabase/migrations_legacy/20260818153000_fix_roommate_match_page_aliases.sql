create or replace function public.get_my_roommate_matches_page(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(
  id uuid, matched_user_id text, match_score integer, status text, created_at timestamptz,
  username text, full_name text, avatar_url text, gender text, city text, state text,
  bio text, school text, area_preference text, budget_score integer, location_score integer,
  cleanliness_score integer, noise_score integer, visitors_score integer, stay_score integer,
  mutual_accepted boolean, conversation_id uuid
)
language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_prefs public.roommate_preferences;
  v_school text;
  v_limit integer := greatest(1,least(coalesce(p_limit,24),50));
  v_offset integer := greatest(0,coalesce(p_offset,0));
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null or v_actor.role<>'user' then raise exception 'Regular user required'; end if;
  if coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Account is not active'; end if;
  select * into v_prefs from public.roommate_preferences where user_id=v_actor.user_id limit 1;
  if v_prefs is null then raise exception 'Roommate preferences required'; end if;
  v_school:=nullif(btrim(coalesce(v_prefs.school_name,v_actor.school,'')),'');

  return query
  with scored as (
    select
      r.id as result_id, r.matched_user_id as result_user_id, r.status as result_status,
      r.created_at as result_created_at, p.username as profile_username,
      p.full_name as profile_full_name, p.avatar_url as profile_avatar_url,
      p.gender as profile_gender, p.city as profile_city, p.state as profile_state,
      p.bio as profile_bio, coalesce(rp.school_name,p.school) as profile_school,
      rp.area_preference as preference_area,
      round(30*(greatest(0,least(rp.budget_max,v_prefs.budget_max)-greatest(rp.budget_min,v_prefs.budget_min)+1)::numeric
        /greatest(1,least(rp.budget_max-rp.budget_min+1,v_prefs.budget_max-v_prefs.budget_min+1))))::integer as budget_points,
      case when nullif(btrim(coalesce(v_actor.local_government,v_actor.city,'')),'') is not null
        and lower(coalesce(nullif(p.local_government,''),p.city,''))=lower(coalesce(nullif(v_actor.local_government,''),v_actor.city,'')) then 20 else 0 end as location_points,
      case when lower(coalesce(rp.cleanliness,''))=lower(coalesce(v_prefs.cleanliness,'')) then 15 else 0 end as cleanliness_points,
      case when lower(coalesce(rp.noise_level,''))=lower(coalesce(v_prefs.noise_level,'')) then 15 else 0 end as noise_points,
      case when lower(coalesce(rp.visitors,''))=lower(coalesce(v_prefs.visitors,'')) then 10 else 0 end as visitors_points,
      case when lower(coalesce(rp.stay_duration,''))=lower(coalesce(v_prefs.stay_duration,'')) then 10 else 0 end as stay_points
    from public.roommate_search_results r
    join public.profiles p on p.user_id=r.matched_user_id
    join public.roommate_preferences rp on rp.user_id=p.user_id
    where r.searcher_id=v_actor.user_id and r.status<>'declined'
      and coalesce(p.deleted,false)=false and coalesce(p.suspended,false)=false and coalesce(p.banned,false)=false
      and (r.status='accepted' or (
        coalesce(p.privacy_search_visible,true)=true and coalesce(p.privacy_profile_visible,true)=true
        and coalesce(rp.active,false)=true and rp.search_status='active'
        and (not coalesce(v_prefs.school_match,false)
          or lower(regexp_replace(btrim(coalesce(rp.school_name,p.school,'')),'\\s+',' ','g'))=lower(regexp_replace(btrim(coalesce(v_school,'')),'\\s+',' ','g')))
      ))
  ), ranked as (
    select scored.*,
      least(100,budget_points+location_points+cleanliness_points+noise_points+visitors_points+stay_points)::integer as current_score
    from scored
  )
  select s.result_id,s.result_user_id,s.current_score,s.result_status,s.result_created_at,
    s.profile_username,s.profile_full_name,s.profile_avatar_url,s.profile_gender,s.profile_city,
    s.profile_state,s.profile_bio,s.profile_school,s.preference_area,s.budget_points,
    s.location_points,s.cleanliness_points,s.noise_points,s.visitors_points,s.stay_points,
    exists(select 1 from public.roommate_search_results rr where rr.searcher_id=s.result_user_id and rr.matched_user_id=v_actor.user_id and rr.status='accepted'),
    (select c.id from public.conversations c where c.conversation_type='roommate' and c.status='active'
      and ((c.participant_a=v_actor.user_id and c.participant_b=s.result_user_id) or (c.participant_b=v_actor.user_id and c.participant_a=s.result_user_id)) limit 1)
  from ranked s
  order by s.current_score desc,s.result_created_at desc,s.result_id
  limit v_limit offset v_offset;
end
$$;

