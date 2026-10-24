-- Review labels come from the same canonical category catalog as intake.
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
 return to_jsonb(activity)||jsonb_build_object('category_name',(select c.name from public.experience_categories c where c.code=activity.details->>'category'));
end $$;

create or replace function public.get_experience_activity_review_queue(p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_creator_actor(); rows jsonb;
begin
 if (p_before is null)<>(p_before_id is null) then raise exception 'Use a complete review cursor';end if;
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('category_name',(select c.name from public.experience_categories c where c.code=a.details->>'category')) order by a.updated_at desc,a.id desc),'[]'::jsonb) into rows from (
  select * from public.experience_activities where status='submitted' and host_user_id<>actor
   and (p_before is null or (updated_at,id)<(p_before,p_before_id)) order by updated_at desc,id desc limit 20)a;
 return rows;
end $$;
