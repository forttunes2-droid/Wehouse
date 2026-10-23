-- Review access must never disclose an unsent draft or a newly edited revision.
create or replace function public.get_experience_activity(p_activity_id uuid,p_for_review boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text; activity public.experience_activities;
begin
 if p_for_review is null then raise exception 'Choose an application view';end if;
 if p_for_review then actor:=private.experience_creator_actor();else actor:=private.experience_host_actor();end if;
 select * into activity from public.experience_activities where id=p_activity_id;
 if activity.id is null or (not p_for_review and activity.host_user_id<>actor)
  or (p_for_review and (activity.host_user_id=actor or activity.submitted_at is null
   or activity.status not in ('submitted','changes_required','declined','withdrawn'))) then
  raise exception 'This application is unavailable to this account' using errcode='42501';
 end if;
 return to_jsonb(activity);
end $$;

create or replace function public.get_experience_activity_history(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); activity public.experience_activities; rows jsonb;
begin
 select * into activity from public.experience_activities where id=p_activity_id;
 if activity.id is null then raise exception 'Activity unavailable';end if;
 if activity.host_user_id=actor then perform private.experience_host_actor();
 else
  perform private.experience_creator_actor();
  if activity.submitted_at is null or activity.status not in ('submitted','changes_required','declined','withdrawn') then
   raise exception 'This application is not currently shared for review' using errcode='42501';
  end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.activity_revision),'[]'::jsonb) into rows
 from (select * from public.experience_activity_events where activity_id=activity.id order by activity_revision desc limit 50)e;
 return rows;
end $$;
