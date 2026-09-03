-- Keep private verification and school data out of conversation/public APIs,
-- enforce roommate location eligibility, and create worker wallets at approval.

create or replace function public._ensure_verified_worker_wallet()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.role = 'worker' and new.worker_status = 'verified' and new.worker_verified is true then
    insert into public.wallets(owner_id, owner_type, available_balance, pending_balance, frozen_balance, total_withdrawn)
    values(new.user_id, 'worker', 0, 0, 0, 0)
    on conflict(owner_id, owner_type) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public._ensure_verified_worker_wallet() from public, anon, authenticated;
grant execute on function public._ensure_verified_worker_wallet() to service_role;

drop trigger if exists trg_ensure_verified_worker_wallet on public.profiles;
create trigger trg_ensure_verified_worker_wallet
after insert or update of role, worker_status, worker_verified on public.profiles
for each row execute function public._ensure_verified_worker_wallet();

insert into public.wallets(owner_id, owner_type, available_balance, pending_balance, frozen_balance, total_withdrawn)
select p.user_id, 'worker', 0, 0, 0, 0
from public.profiles p
where p.role = 'worker' and p.worker_status = 'verified' and p.worker_verified is true
on conflict(owner_id, owner_type) do nothing;

create or replace function public.get_allowed_conversation_profile(p_context_type text, p_context_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor text;
  v_peer text;
  v_profile public.profiles;
  v_roommate public.roommate_profiles;
  v_actor_prefs public.roommate_preferences;
  v_peer_prefs public.roommate_preferences;
  v_school_visible boolean := false;
begin
  select user_id into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Authentication required'; end if;

  if p_context_type='roommate' then
    select case when participant_a=v_actor then participant_b else participant_a end into v_peer
    from public.conversations where id=p_context_id and conversation_type='roommate'
      and v_actor in (participant_a,participant_b);
  elsif p_context_type='worker_booking' then
    select case when user_id=v_actor then worker_id else user_id end into v_peer
    from public.worker_bookings where id=p_context_id and v_actor in (user_id,worker_id);
  else
    raise exception 'Unsupported conversation type';
  end if;
  if v_peer is null then raise exception 'Conversation access denied'; end if;

  select * into v_profile from public.profiles where user_id=v_peer limit 1;
  if v_profile.user_id is null then raise exception 'Profile unavailable'; end if;
  if p_context_type='roommate' then
    select * into v_roommate from public.roommate_profiles where user_id=v_peer limit 1;
    select * into v_actor_prefs from public.roommate_preferences where user_id=v_actor limit 1;
    select * into v_peer_prefs from public.roommate_preferences where user_id=v_peer limit 1;
    v_school_visible := coalesce(v_actor_prefs.school_match,false)
      and coalesce(v_peer_prefs.school_match,false)
      and lower(regexp_replace(btrim(coalesce(v_actor_prefs.school_name,'')),'\s+',' ','g'))
        = lower(regexp_replace(btrim(coalesce(v_peer_prefs.school_name,'')),'\s+',' ','g'));
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'user_id',v_profile.user_id,'role',v_profile.role,'full_name',v_profile.full_name,
    'username',v_profile.username,'avatar_url',v_profile.avatar_url,'bio',v_profile.bio,
    'school',case when v_school_visible then v_profile.school else null end,
    'gender',v_profile.gender,'state',v_profile.state,
    'lga',coalesce(v_profile.local_government,v_profile.city),
    'worker_occupation',v_profile.worker_occupation,'worker_bio',v_profile.worker_bio,
    'worker_skills',v_profile.worker_skills,'worker_verified',v_profile.worker_verified,
    'worker_price',v_profile.worker_price,'worker_experience',v_profile.worker_experience,
    'rating',v_profile.rating,'review_count',v_profile.review_count,
    'roommate',case when p_context_type='roommate' then jsonb_strip_nulls(jsonb_build_object(
      'age',v_roommate.age,'budget_min',v_roommate.budget_min,'budget_max',v_roommate.budget_max,
      'area',v_roommate.area,'city',v_roommate.city,'personality_type',v_roommate.personality_type,
      'stay_duration',v_roommate.stay_duration
    )) else null end
  ));
end;
$$;

revoke all on function public.get_allowed_conversation_profile(text,uuid) from public, anon;
grant execute on function public.get_allowed_conversation_profile(text,uuid) to authenticated, service_role;

create or replace function public.get_worker_marketplace_trust(p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_worker public.profiles; v_enabled boolean:=false; v_min_jobs integer:=5;
  v_min_rating numeric:=4.5; v_max_cancel numeric:=20; v_block_disputes boolean:=true;
  v_completed integer:=0; v_worker_cancelled integer:=0; v_open_disputes integer:=0;
  v_cancel_rate numeric:=0; v_trusted boolean:=false;
begin
  select * into v_worker from public.profiles where user_id=p_worker_id and role='worker'
    and worker_status='verified' and worker_verified=true and available=true
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_worker is null then return jsonb_build_object('reviewed',false,'trusted',false); end if;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_enabled from public.platform_settings where key='worker_trust_enabled' and is_active=true limit 1;
  select coalesce(nullif(value,''),'5')::integer into v_min_jobs from public.platform_settings where key='worker_trusted_min_completed_jobs' and is_active=true limit 1;
  select coalesce(nullif(value,''),'4.5')::numeric into v_min_rating from public.platform_settings where key='worker_trusted_min_rating' and is_active=true limit 1;
  select coalesce(nullif(value,''),'20')::numeric into v_max_cancel from public.platform_settings where key='worker_trusted_max_cancel_rate' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),true) into v_block_disputes from public.platform_settings where key='worker_trusted_block_open_disputes' and is_active=true limit 1;
  select count(*) into v_completed from public.worker_bookings where worker_id=p_worker_id and status='approved_released';
  select count(*) into v_worker_cancelled from public.worker_bookings where worker_id=p_worker_id and status='cancelled' and cancelled_by=p_worker_id;
  select count(*) into v_open_disputes from public.worker_bookings where worker_id=p_worker_id and status='disputed';
  if v_completed+v_worker_cancelled>0 then v_cancel_rate:=round((v_worker_cancelled::numeric*100)/(v_completed+v_worker_cancelled),2); end if;
  v_trusted:=coalesce(v_enabled,false) and v_completed>=coalesce(v_min_jobs,5)
    and coalesce(v_worker.rating,0)>=coalesce(v_min_rating,4.5)
    and v_cancel_rate<=coalesce(v_max_cancel,20)
    and (not coalesce(v_block_disputes,true) or v_open_disputes=0);
  return jsonb_build_object('reviewed',true,'trusted',v_trusted,'trusted_enabled',coalesce(v_enabled,false),
    'completed_jobs',v_completed,'rating',coalesce(v_worker.rating,0),'review_count',coalesce(v_worker.review_count,0),
    'worker_cancel_rate',v_cancel_rate,'open_disputes',v_open_disputes,
    'label',case when v_trusted then 'WeHouse Trusted' else 'WeHouse Reviewed' end);
end;
$$;

revoke all on function public.get_worker_marketplace_trust(text) from public, anon;
grant execute on function public.get_worker_marketplace_trust(text) to authenticated, service_role;

create or replace function public.get_my_roommate_matches_page(p_limit integer default 24, p_offset integer default 0)
returns table(id uuid, matched_user_id text, match_score integer, status text, created_at timestamptz,
  username text, full_name text, avatar_url text, gender text, city text, state text, bio text, school text,
  area_preference text, budget_score integer, location_score integer, cleanliness_score integer,
  noise_score integer, visitors_score integer, stay_score integer, mutual_accepted boolean, conversation_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles; v_prefs public.roommate_preferences; v_school text;
  v_state text; v_lga text; v_limit integer:=greatest(1,least(coalesce(p_limit,24),50));
  v_offset integer:=greatest(0,coalesce(p_offset,0));
begin
  select * into v_actor from public.profiles where auth_id=(select auth.uid())::text limit 1;
  if v_actor is null or v_actor.role<>'user' then raise exception 'Regular user required'; end if;
  if coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Account is not active'; end if;
  select * into v_prefs from public.roommate_preferences where user_id=v_actor.user_id limit 1;
  if v_prefs is null then raise exception 'Roommate preferences required'; end if;
  v_school:=nullif(btrim(coalesce(v_prefs.school_name,v_actor.school,'')),'');
  v_state:=nullif(btrim(coalesce(v_actor.state,'')),'');
  v_lga:=nullif(btrim(coalesce(v_actor.local_government,v_actor.city,'')),'');
  if v_state is null or v_lga is null then raise exception 'State and LGA are required for roommate matching'; end if;

  return query with scored as (
    select r.id result_id,r.matched_user_id result_user_id,r.status result_status,r.created_at result_created_at,
      p.username profile_username,p.full_name profile_full_name,p.avatar_url profile_avatar_url,p.gender profile_gender,
      p.city profile_city,p.state profile_state,p.bio profile_bio,
      case when coalesce(v_prefs.school_match,false) and coalesce(rp.school_match,false) then coalesce(rp.school_name,p.school) else null end profile_school,
      rp.area_preference preference_area,
      round(30*(greatest(0,least(rp.budget_max,v_prefs.budget_max)-greatest(rp.budget_min,v_prefs.budget_min)+1)::numeric
        /greatest(1,least(rp.budget_max-rp.budget_min+1,v_prefs.budget_max-v_prefs.budget_min+1))))::integer budget_points,
      20::integer location_points,
      case when lower(coalesce(rp.cleanliness,''))=lower(coalesce(v_prefs.cleanliness,'')) then 15 else 0 end cleanliness_points,
      case when lower(coalesce(rp.noise_level,''))=lower(coalesce(v_prefs.noise_level,'')) then 15 else 0 end noise_points,
      case when lower(coalesce(rp.visitors,''))=lower(coalesce(v_prefs.visitors,'')) then 10 else 0 end visitors_points,
      case when lower(coalesce(rp.stay_duration,''))=lower(coalesce(v_prefs.stay_duration,'')) then 10 else 0 end stay_points
    from public.roommate_search_results r
    join public.profiles p on p.user_id=r.matched_user_id
    join public.roommate_preferences rp on rp.user_id=p.user_id
    where r.searcher_id=v_actor.user_id and r.status<>'declined'
      and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
      and lower(btrim(coalesce(p.state,'')))=lower(v_state)
      and lower(btrim(coalesce(p.local_government,p.city,'')))=lower(v_lga)
      and (not coalesce(v_prefs.school_match,false) or lower(regexp_replace(btrim(coalesce(rp.school_name,p.school,'')),'\s+',' ','g'))=lower(regexp_replace(v_school,'\s+',' ','g')))
      and (r.status='accepted' or (coalesce(p.privacy_search_visible,true) and coalesce(p.privacy_profile_visible,true)
        and coalesce(rp.active,false) and rp.search_status='active'))
  ), ranked as (
    select scored.*,least(100,budget_points+location_points+cleanliness_points+noise_points+visitors_points+stay_points)::integer current_score from scored
  )
  select s.result_id,s.result_user_id,s.current_score,s.result_status,s.result_created_at,s.profile_username,
    s.profile_full_name,s.profile_avatar_url,s.profile_gender,s.profile_city,s.profile_state,s.profile_bio,s.profile_school,
    s.preference_area,s.budget_points,s.location_points,s.cleanliness_points,s.noise_points,s.visitors_points,s.stay_points,
    exists(select 1 from public.roommate_search_results rr where rr.searcher_id=s.result_user_id and rr.matched_user_id=v_actor.user_id and rr.status='accepted'),
    (select c.id from public.conversations c where c.conversation_type='roommate' and c.status='active'
      and ((c.participant_a=v_actor.user_id and c.participant_b=s.result_user_id) or (c.participant_b=v_actor.user_id and c.participant_a=s.result_user_id)) limit 1)
  from ranked s order by s.current_score desc,s.result_created_at desc,s.result_id limit v_limit offset v_offset;
end;
$$;

revoke all on function public.get_my_roommate_matches_page(integer,integer) from public, anon;
grant execute on function public.get_my_roommate_matches_page(integer,integer) to authenticated, service_role;
