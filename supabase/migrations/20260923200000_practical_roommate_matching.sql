-- Practical housing requirements first; answered lifestyle preferences second.
-- Existing connections and historical choices are preserved. No current address
-- is copied into a moving preference and no unanswered habit is backfilled.
alter table public.roommate_preferences
  add column if not exists preferred_state text,
  add column if not exists preferred_lga text,
  add column if not exists preferred_area text,
  add column if not exists move_in_mode text,
  add column if not exists move_in_from date,
  add column if not exists move_in_to date,
  add column if not exists room_arrangement text,
  add column if not exists sleep_routine text,
  add column if not exists smoking_habit text,
  add column if not exists smoking_preference text,
  add column if not exists overnight_visitors text,
  add column if not exists pets_preference text,
  add column if not exists practical_preferences_version integer not null default 0;
alter table public.roommate_preferences
  alter column budget_min drop default, alter column budget_max drop default,
  alter column cleanliness drop default, alter column noise_level drop default,
  alter column sleep_time drop default, alter column visitors drop default,
  alter column stay_duration drop default;

create or replace function public._roommate_normalize(value text) returns text
language sql immutable set search_path to '' as $$
 select nullif(lower(regexp_replace(btrim(value),'\s+',' ','g')),'');
$$;
revoke all on function public._roommate_normalize(text) from public,anon,authenticated;

-- The input is constructed exclusively from stored preferences and authoritative
-- profiles by the caller below. The pure function makes reciprocity testable.
create or replace function public._roommate_practical_compatibility(a jsonb,b jsonb,p_today date)
returns jsonb language plpgsql immutable set search_path to '' as $$
declare
 k text; label text; left_value text; right_value text;
 compared integer:=0; agreements integer:=0;
 reasons jsonb:='[]'; topics jsonb:='[]';
 a_start date; a_end date; b_start date; b_end date;
 out jsonb:=jsonb_build_object('eligible',false,'score',null,'compared_answers',0,'highlights','[]'::jsonb,'discuss','[]'::jsonb);
begin
 if coalesce((a->>'practical_preferences_version')::integer,0)<>2
    or coalesce((b->>'practical_preferences_version')::integer,0)<>2 then return out; end if;
 -- Exact desired State/LGA; an optional named area is a requirement if both chose one.
 if public._roommate_normalize(a->>'preferred_state') is null
    or public._roommate_normalize(a->>'preferred_lga') is null
    or public._roommate_normalize(a->>'preferred_state') is distinct from public._roommate_normalize(b->>'preferred_state')
    or public._roommate_normalize(a->>'preferred_lga') is distinct from public._roommate_normalize(b->>'preferred_lga') then return out; end if;
 if public._roommate_normalize(a->>'preferred_area') is not null and public._roommate_normalize(b->>'preferred_area') is not null
    and public._roommate_normalize(a->>'preferred_area')<>public._roommate_normalize(b->>'preferred_area') then return out; end if;
 if not coalesce((a->>'budget_min')::integer>0 and (b->>'budget_min')::integer>0
   and (a->>'budget_max')::integer >= (a->>'budget_min')::integer
   and (b->>'budget_max')::integer >= (b->>'budget_min')::integer
   and (a->>'budget_max')::integer >= (b->>'budget_min')::integer
   and (b->>'budget_max')::integer >= (a->>'budget_min')::integer,false) then return out; end if;
 if coalesce(a->>'gender_preference','') not in('male','female','no_preference')
    or coalesce(b->>'gender_preference','') not in('male','female','no_preference')
    or coalesce(a->>'profile_gender','') not in('male','female')
    or coalesce(b->>'profile_gender','') not in('male','female')
    or ((a->>'gender_preference')<>'no_preference' and (a->>'gender_preference')<>(b->>'profile_gender'))
    or ((b->>'gender_preference')<>'no_preference' and (b->>'gender_preference')<>(a->>'profile_gender')) then return out; end if;
 if coalesce((a->>'school_match')::boolean,false) or coalesce((b->>'school_match')::boolean,false) then
   if public._roommate_normalize(a->>'matching_school') is null
      or public._roommate_normalize(a->>'matching_school') is distinct from public._roommate_normalize(b->>'matching_school') then return out; end if;
 end if;
 if coalesce(a->>'room_arrangement','') not in('shared_bedroom','separate_bedrooms','either')
    or coalesce(b->>'room_arrangement','') not in('shared_bedroom','separate_bedrooms','either')
    or ((a->>'room_arrangement')<>'either' and (b->>'room_arrangement')<>'either' and (a->>'room_arrangement')<>(b->>'room_arrangement')) then return out; end if;
 if coalesce(a->>'move_in_mode','') not in('asap','date','range','flexible')
    or coalesce(b->>'move_in_mode','') not in('asap','date','range','flexible') then return out; end if;
 a_start:=case a->>'move_in_mode' when 'asap' then p_today when 'flexible' then p_today else (a->>'move_in_from')::date end;
 b_start:=case b->>'move_in_mode' when 'asap' then p_today when 'flexible' then p_today else (b->>'move_in_from')::date end;
 a_end:=case a->>'move_in_mode' when 'asap' then p_today+30 when 'flexible' then 'infinity'::date when 'date' then a_start else (a->>'move_in_to')::date end;
 b_end:=case b->>'move_in_mode' when 'asap' then p_today+30 when 'flexible' then 'infinity'::date when 'date' then b_start else (b->>'move_in_to')::date end;
 if a_start is null or b_start is null or a_end is null or b_end is null
    or a_end<a_start or b_end<b_start or a_end<p_today or b_end<p_today
    or greatest(a_start,b_start,p_today)>least(a_end,b_end) then return out; end if;
 -- A stated smoking boundary is not overridden by a high lifestyle score.
 if coalesce(a->>'smoking_habit','') not in('never','outdoors','smokes')
    or coalesce(b->>'smoking_habit','') not in('never','outdoors','smokes')
    or coalesce(a->>'smoking_preference','') not in('no','outdoors','yes')
    or coalesce(b->>'smoking_preference','') not in('no','outdoors','yes')
    or ((a->>'smoking_preference')='no' and (b->>'smoking_habit')<>'never')
    or ((b->>'smoking_preference')='no' and (a->>'smoking_habit')<>'never')
    or ((a->>'smoking_preference')='outdoors' and (b->>'smoking_habit')='smokes')
    or ((b->>'smoking_preference')='outdoors' and (a->>'smoking_habit')='smokes') then return out; end if;
 reasons:=jsonb_build_array('You want the same State and LGA.','Your individual annual rent ranges overlap.','Your room arrangements can work together.');
 if (a->>'move_in_mode')='flexible' or (b->>'move_in_mode')='flexible' then topics:=topics||jsonb_build_array('Agree the actual move-in date.');
 else reasons:=reasons||jsonb_build_array('Your move-in windows overlap.'); end if;
 if public._roommate_normalize(a->>'preferred_area') is null or public._roommate_normalize(b->>'preferred_area') is null then topics:=topics||jsonb_build_array('Agree the exact neighbourhood.'); end if;
 for k,label in select * from (values ('cleanliness','Cleanliness'),('noise_level','Home atmosphere'),('sleep_routine','Sleep routine'),('visitors','Usual visitors'),('overnight_visitors','Overnight visitors'),('stay_duration','Length of stay'),('pets_preference','Pets')) as fields(k,label) loop
   left_value:=public._roommate_normalize(a->>k); right_value:=public._roommate_normalize(b->>k);
   if left_value is null or right_value is null then continue; end if;
   compared:=compared+1;
   if left_value=right_value then agreements:=agreements+1; reasons:=reasons||jsonb_build_array(label||': similar answers.');
   else topics:=topics||jsonb_build_array(label||': different expectations.'); end if;
 end loop;
 if compared<7 then topics:=topics||jsonb_build_array('Some daily habits are unanswered; discuss them before deciding.'); end if;
 return jsonb_build_object('eligible',true,'score',case when compared=0 then null else round(100.0*agreements/compared)::integer end,'compared_answers',compared,'highlights',reasons,'discuss',topics);
end $$;
revoke all on function public._roommate_practical_compatibility(jsonb,jsonb,date) from public,anon,authenticated;

create or replace function public._roommate_practical_pair(p_a text,p_b text)
returns jsonb language sql stable security definer set search_path to '' as $$
 select public._roommate_practical_compatibility(
   to_jsonb(ap)||jsonb_build_object('profile_gender',lower(a.gender),'matching_school',coalesce(nullif(btrim(ap.school_name),''),a.school)),
   to_jsonb(bp)||jsonb_build_object('profile_gender',lower(b.gender),'matching_school',coalesce(nullif(btrim(bp.school_name),''),b.school)),
   (now() at time zone 'Africa/Lagos')::date)
 from public.profiles a join public.roommate_preferences ap on ap.user_id=a.user_id
 cross join public.profiles b join public.roommate_preferences bp on bp.user_id=b.user_id
 where a.user_id=p_a and b.user_id=p_b;
$$;
revoke all on function public._roommate_practical_pair(text,text) from public,anon,authenticated;

create or replace function public._roommate_pair_open(p_a text,p_b text)
returns boolean language sql stable security definer set search_path to '' as $$
 select p_a<>p_b and coalesce((select bool_and(
   not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
   and coalesce(p.profile_complete,false) and coalesce(p.privacy_profile_visible,true) and coalesce(p.privacy_search_visible,true)
   and rp.active and rp.search_status='active') and count(*)=2
   from public.profiles p join public.roommate_preferences rp on rp.user_id=p.user_id where p.user_id in(p_a,p_b)),false)
 and not exists(select 1 from public.roommate_user_blocks b where (b.blocker_user_id=p_a and b.blocked_user_id=p_b) or (b.blocker_user_id=p_b and b.blocked_user_id=p_a))
 and coalesce((public._roommate_practical_pair(p_a,p_b)->>'eligible')::boolean,false);
$$;
revoke all on function public._roommate_pair_open(text,text) from public,anon,authenticated;

create or replace function public._validate_practical_roommate_preferences()
returns trigger language plpgsql security definer set search_path to '' as $$
declare today date:=(now() at time zone 'Africa/Lagos')::date; owner_profile public.profiles;
begin
 if new.practical_preferences_version<>2 then return new; end if;
 select * into owner_profile from public.profiles where user_id=new.user_id;
 if owner_profile.auth_id is distinct from new.auth_id then raise exception 'Preference ownership is invalid'; end if;
 new.gender:=owner_profile.gender;
 if new.gender not in('male','female') or new.gender is null then raise exception 'Complete your gender in Personal details'; end if;
 new.preferred_state:=nullif(btrim(new.preferred_state),''); new.preferred_lga:=nullif(btrim(new.preferred_lga),''); new.preferred_area:=nullif(btrim(new.preferred_area),'');
 if new.preferred_state is null or new.preferred_lga is null or length(new.preferred_state)>80 or length(new.preferred_lga)>100 or length(new.preferred_area)>120 then raise exception 'Choose your preferred State, LGA and optional area'; end if;
 if new.gender_preference not in('male','female','no_preference') then raise exception 'Choose who you would live with'; end if;
 if new.budget_min is null or new.budget_max is null or new.budget_min<=0 or new.budget_max<new.budget_min then raise exception 'Enter your individual annual rent range'; end if;
 if coalesce(new.move_in_mode,'') not in('asap','date','range','flexible') then raise exception 'Choose when you want to move'; end if;
 if new.move_in_mode in('date','range') and (new.move_in_from is null or new.move_in_from<today) then raise exception 'Choose a future move-in date'; end if;
 if new.move_in_mode='date' then new.move_in_to:=new.move_in_from; end if;
 if new.move_in_mode='range' and (new.move_in_to is null or new.move_in_to<new.move_in_from) then raise exception 'Choose a valid move-in date range'; end if;
 if new.move_in_mode in('asap','flexible') then new.move_in_from:=null; new.move_in_to:=null; end if;
 if coalesce(new.room_arrangement,'') not in('shared_bedroom','separate_bedrooms','either') then raise exception 'Choose what you want to share'; end if;
 if coalesce(new.smoking_habit,'') not in('never','outdoors','smokes') or coalesce(new.smoking_preference,'') not in('no','outdoors','yes') then raise exception 'Complete your smoking habit and acceptance'; end if;
 new.cleanliness:=nullif(new.cleanliness,''); new.noise_level:=nullif(new.noise_level,''); new.visitors:=nullif(new.visitors,''); new.stay_duration:=nullif(new.stay_duration,'');
 new.sleep_routine:=nullif(new.sleep_routine,''); new.overnight_visitors:=nullif(new.overnight_visitors,''); new.pets_preference:=nullif(new.pets_preference,'');
 if new.cleanliness not in('neat','moderate','relaxed') or new.noise_level not in('quiet','moderate','loud') or new.visitors not in('rarely','sometimes','often')
   or new.stay_duration not in('3_months','6_months','1_year','1_year+') or new.sleep_routine not in('early','late','varies')
   or new.overnight_visitors not in('yes','agreement','no') or new.pets_preference not in('yes','agreement','no') then raise exception 'Invalid daily habit choice'; end if;
 if new.school_match and public._roommate_normalize(coalesce(nullif(new.school_name,''),owner_profile.school)) is null then raise exception 'Add your school before using same-school matching'; end if;
 new.area_preference:=new.preferred_area;
 return new;
end $$;
revoke all on function public._validate_practical_roommate_preferences() from public,anon,authenticated;
create trigger validate_practical_roommate_preferences before insert or update of preferred_state,preferred_lga,preferred_area,move_in_mode,move_in_from,move_in_to,room_arrangement,smoking_habit,smoking_preference,cleanliness,noise_level,visitors,stay_duration,sleep_routine,overnight_visitors,pets_preference,practical_preferences_version,budget_min,budget_max,gender,gender_preference,school_name,school_match,auth_id,user_id on public.roommate_preferences
for each row execute function public._validate_practical_roommate_preferences();

create or replace function public.save_my_roommate_preferences_v2(p_preferences jsonb)
returns public.roommate_preferences language plpgsql security definer set search_path to '' as $$
declare actor public.profiles; old_row public.roommate_preferences; result public.roommate_preferences; permitted boolean; school text;
begin
 select * into actor from public.profiles where auth_id=(select auth.uid())::text limit 1;
 if actor.user_id is null or not public.current_actor_has_personal_workspace() or coalesce(actor.deleted,false) or coalesce(actor.suspended,false) or coalesce(actor.banned,false) then raise exception 'Active Personal account required'; end if;
 if not coalesce(actor.profile_complete,false) then raise exception 'Complete Personal details first'; end if;
 if jsonb_typeof(p_preferences) is distinct from 'object' or octet_length(p_preferences::text)>16384 then raise exception 'Preferences must be an object'; end if;
 select * into old_row from public.roommate_preferences where user_id=actor.user_id for update;
 permitted:=coalesce(actor.privacy_search_visible,true) and coalesce(actor.privacy_profile_visible,true) and coalesce(old_row.search_status,'active')<>'stopped';
 school:=coalesce(nullif(btrim(p_preferences->>'school_name'),''),nullif(btrim(actor.school),''));
 insert into public.roommate_preferences(user_id,auth_id,gender,gender_preference,budget_min,budget_max,
 preferred_state,preferred_lga,preferred_area,move_in_mode,move_in_from,move_in_to,room_arrangement,
 cleanliness,noise_level,visitors,stay_duration,sleep_time,sleep_routine,smoking_habit,smoking_preference,overnight_visitors,pets_preference,
 school_name,school_match,practical_preferences_version,active,search_status,search_started_at,search_expires_at)
 values(actor.user_id,actor.auth_id,actor.gender,p_preferences->>'gender_preference',(p_preferences->>'budget_min')::integer,(p_preferences->>'budget_max')::integer,
 p_preferences->>'preferred_state',p_preferences->>'preferred_lga',p_preferences->>'preferred_area',p_preferences->>'move_in_mode',nullif(p_preferences->>'move_in_from','')::date,nullif(p_preferences->>'move_in_to','')::date,p_preferences->>'room_arrangement',
 nullif(p_preferences->>'cleanliness',''),nullif(p_preferences->>'noise_level',''),nullif(p_preferences->>'visitors',''),nullif(p_preferences->>'stay_duration',''),old_row.sleep_time,
 nullif(p_preferences->>'sleep_routine',''),p_preferences->>'smoking_habit',p_preferences->>'smoking_preference',nullif(p_preferences->>'overnight_visitors',''),nullif(p_preferences->>'pets_preference',''),
 school,coalesce((p_preferences->>'school_match')::boolean,false),2,permitted,case when permitted then 'active' else 'stopped' end,case when permitted then coalesce(old_row.search_started_at,now()) else old_row.search_started_at end,null)
 on conflict(user_id) do update set gender=excluded.gender,gender_preference=excluded.gender_preference,budget_min=excluded.budget_min,budget_max=excluded.budget_max,
 preferred_state=excluded.preferred_state,preferred_lga=excluded.preferred_lga,preferred_area=excluded.preferred_area,move_in_mode=excluded.move_in_mode,move_in_from=excluded.move_in_from,move_in_to=excluded.move_in_to,room_arrangement=excluded.room_arrangement,
 cleanliness=excluded.cleanliness,noise_level=excluded.noise_level,visitors=excluded.visitors,stay_duration=excluded.stay_duration,sleep_routine=excluded.sleep_routine,smoking_habit=excluded.smoking_habit,smoking_preference=excluded.smoking_preference,overnight_visitors=excluded.overnight_visitors,pets_preference=excluded.pets_preference,
 school_name=excluded.school_name,school_match=excluded.school_match,practical_preferences_version=2,active=excluded.active,search_status=excluded.search_status,search_started_at=excluded.search_started_at,search_expires_at=null,updated_at=now()
 returning * into result;
 return result;
end $$;
revoke all on function public.save_my_roommate_preferences_v2(jsonb) from public,anon;
grant execute on function public.save_my_roommate_preferences_v2(jsonb) to authenticated,service_role;

create or replace function public.refresh_my_roommate_search() returns integer
language plpgsql security definer set search_path to '' as $$
declare actor public.profiles; prefs public.roommate_preferences; total integer;
begin
 select * into actor from public.profiles where auth_id=(select auth.uid())::text limit 1;
 if actor.user_id is null or not public.current_actor_has_personal_workspace() or coalesce(actor.deleted,false) or coalesce(actor.suspended,false) or coalesce(actor.banned,false) then raise exception 'Active Personal account required'; end if;
 select * into prefs from public.roommate_preferences where user_id=actor.user_id for update;
 if coalesce(prefs.practical_preferences_version,0)<>2 then raise exception 'Confirm your moving plans before finding new matches'; end if;
 if not coalesce(prefs.active,false) or prefs.search_status<>'active' or not coalesce(actor.privacy_search_visible,true) or not coalesce(actor.privacy_profile_visible,true) then raise exception 'Roommate matching is paused'; end if;
 delete from public.roommate_search_results where searcher_id=actor.user_id and status in('new','viewed');
 insert into public.roommate_search_results(searcher_id,matched_user_id,match_score,status)
 select actor.user_id,peer.user_id,coalesce((public._roommate_practical_pair(actor.user_id,peer.user_id)->>'score')::integer,0),'new'
 from public.profiles peer join public.roommate_preferences pp on pp.user_id=peer.user_id
 where peer.user_id<>actor.user_id and peer.account_kind='consumer'
   and public._roommate_pair_open(actor.user_id,peer.user_id)
   and not exists(select 1 from public.roommate_search_results r where r.searcher_id=actor.user_id and r.matched_user_id=peer.user_id and r.status in('accepted','declined'))
   and not exists(select 1 from public.conversations c where c.conversation_type='roommate' and c.status in('active','accepted') and ((c.participant_a=actor.user_id and c.participant_b=peer.user_id) or (c.participant_b=actor.user_id and c.participant_a=peer.user_id)))
 order by coalesce((public._roommate_practical_pair(actor.user_id,peer.user_id)->>'score')::integer,-1) desc,peer.user_id limit 120
 on conflict(searcher_id,matched_user_id) do nothing;
 get diagnostics total=row_count;
 update public.roommate_preferences set search_match_count=total,search_expires_at=null,updated_at=now() where user_id=actor.user_id;
 return total;
end $$;

create or replace function public.get_my_roommate_matches_page_v2(p_limit integer default 24,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path to '' as $$
declare actor public.profiles; mine public.roommate_preferences;
begin
 select * into actor from public.profiles where auth_id=(select auth.uid())::text limit 1;
 if actor.user_id is null or not public.current_actor_has_personal_workspace() or coalesce(actor.deleted,false) or coalesce(actor.suspended,false) or coalesce(actor.banned,false) then raise exception 'Active Personal account required'; end if;
 select * into mine from public.roommate_preferences where user_id=actor.user_id;
 return query
 with records as (
   select r.*,peer.username,peer.full_name,peer.avatar_url,peer.gender,peer.bio,pp.preferred_state,pp.preferred_lga,pp.preferred_area,
   case when mine.school_match and pp.school_match and public._roommate_normalize(coalesce(mine.school_name,actor.school))=public._roommate_normalize(coalesce(pp.school_name,peer.school)) then coalesce(pp.school_name,peer.school) else null end visible_school,
   public._roommate_practical_pair(actor.user_id,peer.user_id) compatibility,
   (r.status='accepted' and exists(select 1 from public.roommate_search_results back where back.searcher_id=peer.user_id and back.matched_user_id=actor.user_id and back.status='accepted')) mutual,
   (select c.id from public.conversations c where c.conversation_type='roommate' and c.status in('active','accepted') and ((c.participant_a=actor.user_id and c.participant_b=peer.user_id) or (c.participant_b=actor.user_id and c.participant_a=peer.user_id)) order by c.created_at limit 1) conversation
   from public.roommate_search_results r join public.profiles peer on peer.user_id=r.matched_user_id left join public.roommate_preferences pp on pp.user_id=peer.user_id
   where r.searcher_id=actor.user_id and r.status<>'declined' and not coalesce(peer.deleted,false) and not coalesce(peer.suspended,false) and not coalesce(peer.banned,false)
   and not exists(select 1 from public.roommate_user_blocks blocked where (blocked.blocker_user_id=actor.user_id and blocked.blocked_user_id=peer.user_id) or (blocked.blocker_user_id=peer.user_id and blocked.blocked_user_id=actor.user_id))
 ) select jsonb_build_object('id',r.id,'matched_user_id',r.matched_user_id,'match_score',r.compatibility->'score','status',r.status,'created_at',r.created_at,
 'username',r.username,'full_name',r.full_name,'avatar_url',r.avatar_url,'gender',r.gender,'city',r.preferred_lga,'state',r.preferred_state,'bio',r.bio,'school',r.visible_school,'area_preference',r.preferred_area,
 'mutual_accepted',r.mutual,'conversation_id',r.conversation,'compared_answers',coalesce(r.compatibility->'compared_answers','0'::jsonb),
 'match_highlights',coalesce(r.compatibility->'highlights','[]'::jsonb),'discuss_before_deciding',coalesce(r.compatibility->'discuss','[]'::jsonb))
 from records r where r.mutual or r.conversation is not null or public._roommate_pair_open(actor.user_id,r.matched_user_id)
 order by (r.mutual or r.conversation is not null) desc,(r.compatibility->>'score')::integer desc nulls last,r.created_at desc,r.id
 limit greatest(1,least(coalesce(p_limit,24),50)) offset greatest(0,coalesce(p_offset,0));
end $$;
revoke all on function public.get_my_roommate_matches_page_v2(integer,integer) from public,anon;
grant execute on function public.get_my_roommate_matches_page_v2(integer,integer) to authenticated,service_role;

create or replace function public.get_my_roommate_matches_page(p_limit integer DEFAULT 24, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, matched_user_id text, match_score integer, status text, created_at timestamp with time zone, username text, full_name text, avatar_url text, gender text, city text, state text, bio text, school text, area_preference text, budget_score integer, location_score integer, cleanliness_score integer, noise_score integer, visitors_score integer, stay_score integer, mutual_accepted boolean, conversation_id uuid)
language sql stable security definer set search_path to '' as $$
 select (j->>'id')::uuid,j->>'matched_user_id',(j->>'match_score')::integer,j->>'status',(j->>'created_at')::timestamptz,
 j->>'username',j->>'full_name',j->>'avatar_url',j->>'gender',j->>'city',j->>'state',j->>'bio',j->>'school',j->>'area_preference',
 0,0,0,0,0,0,(j->>'mutual_accepted')::boolean,(j->>'conversation_id')::uuid
 from public.get_my_roommate_matches_page_v2(p_limit,p_offset) j;
$$;

create or replace function public.get_my_roommate_matches() RETURNS TABLE(id uuid, matched_user_id text, match_score integer, status text, created_at timestamp with time zone, username text, full_name text, avatar_url text, gender text, city text, state text, bio text, school text, area_preference text, mutual_accepted boolean, conversation_id uuid)
language sql stable security definer set search_path to '' as $$
 select r.id,r.matched_user_id,r.match_score,r.status,r.created_at,r.username,r.full_name,r.avatar_url,r.gender,r.city,r.state,r.bio,r.school,r.area_preference,r.mutual_accepted,r.conversation_id from public.get_my_roommate_matches_page(24,0) r;
$$;

create or replace function public.update_my_roommate_match_status(p_match_id uuid, p_status text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor public.profiles;
  v_match public.roommate_search_results;
  v_reverse public.roommate_search_results;
  v_conversation_id uuid;
begin
  if p_status not in ('new', 'viewed', 'accepted', 'declined') then raise exception 'Invalid match status'; end if;
  select * into v_actor from public.profiles where auth_id = auth.uid()::text limit 1;
  if v_actor is null or not public.current_actor_has_personal_workspace() or coalesce(v_actor.deleted, false)
     or coalesce(v_actor.suspended, false) or coalesce(v_actor.banned, false) then
    raise exception 'Active regular user required';
  end if;
  select * into v_match from public.roommate_search_results
  where id = p_match_id and searcher_id = v_actor.user_id for update;
  if v_match is null then raise exception 'Match not found'; end if;

  if p_status='accepted' and v_match.status is distinct from 'accepted' and not public._roommate_pair_open(v_actor.user_id,v_match.matched_user_id) then
    raise exception 'Moving plans or privacy settings changed. Refresh before connecting';
  end if;

  update public.roommate_search_results
  set status = p_status, updated_at = now()
  where id = p_match_id;

  if p_status = 'accepted' then
    if v_match.status is distinct from 'accepted' then
      insert into public.notifications(recipient_id, type, title, message, related_id, read)
      select v_match.matched_user_id, 'roommate_interest', 'New roommate interest',
        coalesce(nullif(v_actor.full_name, ''), nullif(v_actor.username, ''), 'Someone') || ' is interested in being roommates with you.',
        v_match.id::text, false
      where not exists (
        select 1 from public.notifications notification
        where notification.recipient_id = v_match.matched_user_id
          and notification.type = 'roommate_interest'
          and notification.related_id = v_match.id::text
          and not notification.read
      );
    end if;

    select * into v_reverse from public.roommate_search_results
    where searcher_id = v_match.matched_user_id
      and matched_user_id = v_actor.user_id
      and status = 'accepted'
    limit 1;

    if v_reverse is not null then
      select conversation.id into v_conversation_id
      from public.conversations conversation
      where conversation.conversation_type = 'roommate'
        and ((conversation.participant_a = v_actor.user_id and conversation.participant_b = v_match.matched_user_id)
          or (conversation.participant_b = v_actor.user_id and conversation.participant_a = v_match.matched_user_id))
      order by (conversation.status = 'active') desc, conversation.created_at
      limit 1;

      update public.notifications set read = true
      where recipient_id = v_match.matched_user_id
        and type = 'roommate_interest'
        and related_id = v_match.id::text;

      insert into public.notifications(recipient_id, type, title, message, related_id, read, destination_route)
      select v_match.matched_user_id, 'roommate_match', 'You have a roommate match',
        'You both expressed interest. Open Roommates when you want to start a conversation.',
        coalesce(v_conversation_id::text, v_match.id::text), false, 'roommate'
      where not exists (
        select 1 from public.notifications notification
        where notification.recipient_id = v_match.matched_user_id
          and notification.type = 'roommate_match'
          and notification.related_id = coalesce(v_conversation_id::text, v_match.id::text)
      );
    end if;
  end if;
  return v_conversation_id;
end;
$$;

create or replace function public.respond_to_my_roommate_interest(p_interest_id uuid, p_response text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_actor public.profiles;
  v_interest public.roommate_search_results;
  v_conversation_id uuid;
begin
  if p_response not in ('accepted', 'declined') then raise exception 'Response must be accepted or declined'; end if;
  select * into v_actor from public.profiles where auth_id = auth.uid()::text limit 1;
  if v_actor is null or not public.current_actor_has_personal_workspace()
     or coalesce(v_actor.deleted, false) or coalesce(v_actor.suspended, false) or coalesce(v_actor.banned, false) then
    raise exception 'Active regular user required';
  end if;
  select * into v_interest from public.roommate_search_results
  where id = p_interest_id and matched_user_id = v_actor.user_id and status = 'accepted'
  for update;
  if v_interest is null then raise exception 'Roommate interest not found'; end if;

  if p_response='accepted' and not public._roommate_pair_open(v_actor.user_id,v_interest.searcher_id) then
    raise exception 'Moving plans or privacy settings changed. Refresh before accepting';
  end if;

  insert into public.roommate_search_results(searcher_id, matched_user_id, match_score, status, created_at, updated_at)
  values(v_actor.user_id, v_interest.searcher_id, v_interest.match_score, p_response, now(), now())
  on conflict(searcher_id, matched_user_id) do update
  set status = excluded.status, updated_at = now();

  update public.notifications set read = true
  where recipient_id = v_actor.user_id and type = 'roommate_interest' and related_id = v_interest.id::text;

  if p_response = 'accepted' then
    select conversation.id into v_conversation_id
    from public.conversations conversation
    where conversation.conversation_type = 'roommate'
      and ((conversation.participant_a = v_actor.user_id and conversation.participant_b = v_interest.searcher_id)
        or (conversation.participant_b = v_actor.user_id and conversation.participant_a = v_interest.searcher_id))
    order by (conversation.status = 'active') desc, conversation.created_at
    limit 1;

    insert into public.notifications(recipient_id, type, title, message, related_id, read, destination_route)
    select v_interest.searcher_id, 'roommate_match', 'Roommate interest accepted',
      coalesce(nullif(v_actor.full_name, ''), nullif(v_actor.username, ''), 'Your match') ||
        ' accepted your interest. Open Roommates when you want to start a conversation.',
      coalesce(v_conversation_id::text, v_interest.id::text), false, 'roommate'
    where not exists (
      select 1 from public.notifications notification
      where notification.recipient_id = v_interest.searcher_id
        and notification.type = 'roommate_match'
        and notification.related_id = coalesce(v_conversation_id::text, v_interest.id::text)
    );
  end if;
  return v_conversation_id;
end;
$$;

create or replace function public.start_my_roommate_search() RETURNS public.roommate_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_actor public.profiles; v_row public.roommate_preferences;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR not public.current_actor_has_personal_workspace() THEN RAISE EXCEPTION 'Roommate matching is available to regular users only'; END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;
  IF NOT COALESCE(v_actor.profile_complete,false) THEN RAISE EXCEPTION 'Complete your profile first'; END IF;
  IF COALESCE(v_actor.privacy_search_visible,true)=false OR COALESCE(v_actor.privacy_profile_visible,true)=false THEN RAISE EXCEPTION 'Enable Roommate discovery and profile visibility first'; END IF;
  IF NULLIF(BTRIM(COALESCE(v_actor.gender,'')),'') IS NULL THEN RAISE EXCEPTION 'Add your gender first'; END IF;
  IF NULLIF(BTRIM(COALESCE(v_actor.state,'')),'') IS NULL THEN RAISE EXCEPTION 'Add your State first'; END IF;
  SELECT * INTO v_row FROM public.roommate_preferences WHERE user_id=v_actor.user_id FOR UPDATE;
  IF v_row IS NULL THEN RAISE EXCEPTION 'Save roommate preferences first'; END IF;
  IF COALESCE(v_row.practical_preferences_version,0)<>2 THEN RAISE EXCEPTION 'Confirm your moving plans first'; END IF;
  IF v_row.move_in_mode IN('date','range') AND COALESCE(v_row.move_in_to,v_row.move_in_from)<(now() at time zone 'Africa/Lagos')::date THEN RAISE EXCEPTION 'Update your move-in dates before starting discovery'; END IF;
  IF COALESCE(v_row.school_match,false) AND NULLIF(BTRIM(COALESCE(v_row.school_name,v_actor.school,'')),'') IS NULL THEN RAISE EXCEPTION 'Enter your school before using same-school matching'; END IF;
  UPDATE public.roommate_preferences SET active=true,search_status='active',search_started_at=COALESCE(search_started_at,now()),search_expires_at=NULL,updated_at=now() WHERE user_id=v_actor.user_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

create or replace function public.get_my_received_roommate_interests() RETURNS TABLE(interest_id uuid, sender_user_id text, match_score integer, sent_at timestamp with time zone, username text, full_name text, avatar_url text, city text, state text, school text, bio text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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
    incoming.id,incoming.searcher_id,(public._roommate_practical_pair(v_actor.user_id,incoming.searcher_id)->>'score')::integer,incoming.updated_at,
    sender.username,sender.full_name,sender.avatar_url,sender_prefs.preferred_lga,sender_prefs.preferred_state,
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

grant execute on function public._roommate_normalize(text),public._roommate_practical_compatibility(jsonb,jsonb,date),public._roommate_practical_pair(text,text),public._roommate_pair_open(text,text),public._validate_practical_roommate_preferences() to service_role;
insert into public.function_execution_registry(function_signature,function_name,security_mode,public_allowed,anon_allowed,authenticated_allowed,service_role_allowed,review_state,rationale,captured_at)
select p.oid::regprocedure::text,p.proname,case when p.prosecdef then 'definer' else 'invoker' end,
 has_function_privilege('public',p.oid,'execute'),has_function_privilege('anon',p.oid,'execute'),has_function_privilege('authenticated',p.oid,'execute'),has_function_privilege('service_role',p.oid,'execute'),
 case when p.proname like '\_roommate%' escape '\' or p.proname='_validate_practical_roommate_preferences' then 'approved_service_only' else 'approved_client_rpc' end,
 'Practical reciprocal roommate requirements, private school projection, explicit answers and preserved accepted connections',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('_roommate_normalize','_roommate_practical_compatibility','_roommate_practical_pair','_roommate_pair_open','_validate_practical_roommate_preferences','save_my_roommate_preferences_v2','get_my_roommate_matches_page_v2','get_my_roommate_matches_page','get_my_roommate_matches','refresh_my_roommate_search','start_my_roommate_search','update_my_roommate_match_status','respond_to_my_roommate_interest','get_my_received_roommate_interests')
on conflict(function_signature) do update set authenticated_allowed=excluded.authenticated_allowed,public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,service_role_allowed=excluded.service_role_allowed,review_state=excluded.review_state,rationale=excluded.rationale,captured_at=excluded.captured_at;
