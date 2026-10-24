-- Reuse canonical Activity delivery; no second notification store or review queue.
create function public.get_experience_activity(p_activity_id uuid,p_for_review boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text; activity public.experience_activities;
begin
 if p_for_review is null then raise exception 'Choose an application view';end if;
 if p_for_review then actor:=private.experience_creator_actor();else actor:=private.experience_host_actor();end if;
 select * into activity from public.experience_activities where id=p_activity_id;
 if activity.id is null or (not p_for_review and activity.host_user_id<>actor)
  or (p_for_review and activity.host_user_id=actor) then
  raise exception 'This application is unavailable to this account' using errcode='42501';
 end if;
 return to_jsonb(activity);
end $$;
revoke all on function public.get_experience_activity(uuid,boolean) from public,anon;
grant execute on function public.get_experience_activity(uuid,boolean) to authenticated;

create function private.notify_experience_application_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare activity public.experience_activities; event_id uuid; recipient text; host_state text;
begin
 if new.action not in ('submitted','withdrawn','changes_required','declined','archived') then return new;end if;
 select * into activity from public.experience_activities where id=new.activity_id;
 select state into host_state from public.profiles where user_id=activity.host_user_id;
 -- A newer lifecycle event supersedes prior open actions, including review items.
 perform private.resolve_subject_activity('experience_activity',activity.id::text,null,null);
 if new.action='archived' then return new;end if;
 if new.action='submitted' then
  event_id:=private.upsert_activity_event('experience_review:'||new.id::text,
   'experience.application.submitted','experience_activity',activity.id::text,new.actor_user_id,
   'Experience application needs review','A host submitted an activity for review.',
   'experience_review',jsonb_build_object('context_id',activity.id),new.created_at);
  for recipient in select distinct w.user_id from public.workspace_role_assignments w
   where w.workspace_role='creator' and w.status='active' and w.revoked_at is null
    and w.user_id<>activity.host_user_id and public.user_has_active_workspace(w.user_id,'creator') loop
   perform private.add_activity_audience(event_id,recipient,'creator','services',host_state,true);
  end loop;
 end if;
 event_id:=private.upsert_activity_event('experience_host:'||new.id::text,
  'experience.application.'||new.action,'experience_activity',activity.id::text,new.actor_user_id,
  case new.action when 'submitted' then 'Experience application submitted'
   when 'withdrawn' then 'Experience submission withdrawn'
   when 'changes_required' then 'Your Experience needs changes'
   when 'declined' then 'Experience application declined' end,
  'Open your application to see its current status and review history.',
  'experience_application',jsonb_build_object('context_id',activity.id),new.created_at);
 perform private.add_activity_audience(event_id,activity.host_user_id,'worker','services',host_state,new.action='changes_required');
 return new;
end $$;
revoke all on function private.notify_experience_application_activity() from public,anon,authenticated;
create trigger experience_application_activity after insert on public.experience_activity_events
 for each row execute function private.notify_experience_application_activity();
