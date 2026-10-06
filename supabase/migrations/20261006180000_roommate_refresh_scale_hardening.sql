create index if not exists idx_roommate_prefs_candidate_hard
on public.roommate_preferences
using btree (lower(preferred_state), lower(preferred_lga), budget_min, budget_max, user_id)
where active is true and search_status='active' and practical_preferences_version=2;

create index if not exists idx_roommate_prefs_candidate_gender
on public.roommate_preferences (gender_preference, user_id)
where active is true and search_status='active' and practical_preferences_version=2;

create or replace function public.refresh_my_roommate_search() returns integer
language plpgsql security definer set search_path to '' as $$
declare
 actor public.profiles;
 prefs public.roommate_preferences;
 total integer;
begin
 select * into actor from public.profiles where auth_id=(select auth.uid())::text limit 1;
 if actor.user_id is null or not public.current_actor_has_personal_workspace() or coalesce(actor.deleted,false) or coalesce(actor.suspended,false) or coalesce(actor.banned,false) then raise exception 'Active Personal account required'; end if;
 select * into prefs from public.roommate_preferences where user_id=actor.user_id for update;
 if coalesce(prefs.practical_preferences_version,0)<>2 then raise exception 'Confirm your moving plans before finding new matches'; end if;
 if not coalesce(prefs.active,false) or prefs.search_status<>'active' or not coalesce(actor.privacy_search_visible,true) or not coalesce(actor.privacy_profile_visible,true) then raise exception 'Roommate matching is paused'; end if;

 delete from public.roommate_search_results where searcher_id=actor.user_id and status in('new','viewed');

 with hard_candidates as materialized (
   select peer.user_id
   from public.profiles peer
   join public.roommate_preferences pp on pp.user_id=peer.user_id
   where peer.user_id<>actor.user_id
     and peer.account_kind='consumer'
     and not coalesce(peer.deleted,false)
     and not coalesce(peer.suspended,false)
     and not coalesce(peer.banned,false)
     and coalesce(peer.profile_complete,false)
     and coalesce(peer.privacy_search_visible,true)
     and coalesce(peer.privacy_profile_visible,true)
     and pp.active and pp.search_status='active' and pp.practical_preferences_version=2
     and public._roommate_normalize(pp.preferred_state)=public._roommate_normalize(prefs.preferred_state)
     and public._roommate_normalize(pp.preferred_lga)=public._roommate_normalize(prefs.preferred_lga)
     and pp.budget_max >= prefs.budget_min and prefs.budget_max >= pp.budget_min
     and (prefs.gender_preference='no_preference' or prefs.gender_preference=lower(peer.gender))
     and (pp.gender_preference='no_preference' or pp.gender_preference=lower(actor.gender))
     and (
       (not coalesce(prefs.school_match,false) and not coalesce(pp.school_match,false))
       or (public._roommate_normalize(coalesce(prefs.school_name,actor.school))=public._roommate_normalize(coalesce(pp.school_name,peer.school))
           and public._roommate_normalize(coalesce(prefs.school_name,actor.school)) is not null)
     )
     and (prefs.room_arrangement='either' or pp.room_arrangement='either' or prefs.room_arrangement=pp.room_arrangement)
     and (public._roommate_normalize(prefs.preferred_area) is null
          or public._roommate_normalize(pp.preferred_area) is null
          or public._roommate_normalize(prefs.preferred_area)=public._roommate_normalize(pp.preferred_area))
     and (
       prefs.move_in_mode='flexible' or pp.move_in_mode='flexible'
       or greatest(
         case when prefs.move_in_mode='asap' then (now() at time zone 'Africa/Lagos')::date else prefs.move_in_from end,
         case when pp.move_in_mode='asap' then (now() at time zone 'Africa/Lagos')::date else pp.move_in_from end,
         (now() at time zone 'Africa/Lagos')::date
       ) <= least(
         case when prefs.move_in_mode='asap' then (now() at time zone 'Africa/Lagos')::date+30
              when prefs.move_in_mode='date' then prefs.move_in_from else prefs.move_in_to end,
         case when pp.move_in_mode='asap' then (now() at time zone 'Africa/Lagos')::date+30
              when pp.move_in_mode='date' then pp.move_in_from else pp.move_in_to end
       )
     )
     and not (
       (prefs.smoking_preference='no' and pp.smoking_habit<>'never')
       or (pp.smoking_preference='no' and prefs.smoking_habit<>'never')
       or (prefs.smoking_preference='outdoors' and pp.smoking_habit='smokes')
       or (pp.smoking_preference='outdoors' and prefs.smoking_habit='smokes')
     )
     and not exists (
       select 1 from public.roommate_user_blocks b
       where (b.blocker_user_id=actor.user_id and b.blocked_user_id=peer.user_id)
          or (b.blocker_user_id=peer.user_id and b.blocked_user_id=actor.user_id)
     )
     and not exists (
       select 1 from public.roommate_search_results r
       where r.searcher_id=actor.user_id and r.matched_user_id=peer.user_id and r.status in('accepted','declined')
     )
     and not exists (
       select 1 from public.conversations c
       where c.conversation_type='roommate' and c.status in('active','accepted')
         and ((c.participant_a=actor.user_id and c.participant_b=peer.user_id)
           or (c.participant_b=actor.user_id and c.participant_a=peer.user_id))
     )
   order by peer.user_id
   limit 1000
 ),
 scored as materialized (
   select hc.user_id,
          coalesce((public._roommate_practical_pair(actor.user_id,hc.user_id)->>'score')::integer,0) score
   from hard_candidates hc
 )
 insert into public.roommate_search_results(searcher_id,matched_user_id,match_score,status)
 select actor.user_id,user_id,score,'new'
 from scored
 order by score desc,user_id
 limit 120
 on conflict(searcher_id,matched_user_id) do nothing;

 get diagnostics total=row_count;
 update public.roommate_preferences
 set search_match_count=total,search_expires_at=null,updated_at=now()
 where user_id=actor.user_id;
 return total;
end $$;

revoke all on function public.refresh_my_roommate_search() from public,anon;
grant execute on function public.refresh_my_roommate_search() to authenticated,service_role;
