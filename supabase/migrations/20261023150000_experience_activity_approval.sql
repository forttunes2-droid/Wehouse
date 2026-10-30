alter table public.experience_activities drop constraint experience_activities_status_check;
alter table public.experience_activities add constraint experience_activities_status_check check(status in ('draft','submitted','changes_required','declined','withdrawn','archived','approved'));
alter table public.experience_activity_events drop constraint experience_activity_events_action_check;
alter table public.experience_activity_events add constraint experience_activity_events_action_check check(action in ('created','edited','submitted','withdrawn','changes_required','declined','archived','approved'));
alter table public.experience_activities add column approved_from_revision integer,add column approved_by text references public.profiles(user_id),add column approved_at timestamptz,add column approval_note text;
alter table public.experience_activities add constraint experience_approval_receipt check(status<>'approved' or (approved_from_revision is not null and approved_from_revision=revision-1 and approved_by is not null and approved_by<>host_user_id and approved_at is not null and approval_note is not null and length(btrim(approval_note)) between 20 and 2000));
create index experience_approval_actor_idx on public.experience_activities(approved_by);

create function private.experience_approval_checks(p_activity_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'details',cardinality(private.experience_activity_issues(a.details))=0,
  'provider_access',public.user_has_active_workspace(a.host_user_id,'worker'),
  'identity',public.account_identity_is_current(a.host_user_id),
  'evidence',private.experience_evidence_current(a.id),
  'photos',exists(select 1 from public.experience_activity_photos p where p.activity_id=a.id and p.status='approved' and p.activity_details=a.details)
   and not exists(select 1 from public.experience_activity_photos p where p.activity_id=a.id and p.status<>'archived' and (p.status<>'approved' or p.activity_details<>a.details)),
  'sessions',exists(select 1 from public.experience_sessions s where s.activity_id=a.id and s.status='draft' and s.starts_at>now() and s.activity_revision=(case when a.status='approved' then a.approved_from_revision else a.revision end)-1)
   and not exists(select 1 from public.experience_sessions s where s.activity_id=a.id and s.status='draft' and s.starts_at>now() and s.activity_revision<>(case when a.status='approved' then a.approved_from_revision else a.revision end)-1)
 ) from public.experience_activities a where a.id=p_activity_id;
$$;
revoke all on function private.experience_approval_checks(uuid) from public,anon,authenticated;

create function public.get_experience_approval_readiness(p_activity_id uuid,p_expected_revision integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_creator_actor(); activity public.experience_activities; checks jsonb;
begin
 select * into activity from public.experience_activities where id=p_activity_id;
 if activity.id is null or activity.host_user_id=actor or activity.status not in ('submitted','approved') then raise exception 'Independent submitted activity review is required' using errcode='42501';end if;
 if activity.revision is distinct from p_expected_revision then raise exception 'Application changed. Refresh before approving';end if;
 checks:=private.experience_approval_checks(activity.id);
 return jsonb_build_object('activity_id',activity.id,'revision',activity.revision,'checks',checks,'can_approve',activity.status='submitted' and not exists(select 1 from jsonb_each(checks) item where item.value is distinct from 'true'::jsonb));
end $$;
revoke all on function public.get_experience_approval_readiness(uuid,integer) from public,anon;
grant execute on function public.get_experience_approval_readiness(uuid,integer) to authenticated;

create function public.approve_experience_activity(p_activity_id uuid,p_expected_revision integer,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_creator_actor(); activity public.experience_activities; checks jsonb; previous jsonb;
begin
 select * into activity from public.experience_activities where id=p_activity_id for update;
 if activity.id is null or activity.host_user_id=actor then raise exception 'Independent activity review is required' using errcode='42501';end if;
 if length(btrim(coalesce(p_note,''))) not between 20 and 2000 then raise exception 'Record the activity approval basis in 20 to 2000 characters';end if;
 if activity.status='approved' and activity.approved_from_revision=p_expected_revision and activity.approved_by=actor and activity.approval_note=btrim(p_note) then return to_jsonb(activity);end if;
 if activity.status<>'submitted' or activity.revision is distinct from p_expected_revision then raise exception 'Application changed. Refresh before approving';end if;
 checks:=private.experience_approval_checks(activity.id);
 if checks is null or exists(select 1 from jsonb_each(checks) item where item.value is distinct from 'true'::jsonb) then raise exception 'Complete identity, current evidence, photo and dated-session checks before approval';end if;
 previous:=to_jsonb(activity);
 update public.experience_activities set status='approved',revision=revision+1,approved_from_revision=p_expected_revision,approved_by=actor,approved_at=now(),approval_note=btrim(p_note),updated_at=now() where id=activity.id returning * into activity;
 insert into public.experience_activity_events(activity_id,activity_revision,actor_user_id,action,note) values(activity.id,activity.revision,actor,'approved',btrim(p_note));
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('EXPERIENCE_ACTIVITY_APPROVED','experience',activity.id::text,actor,jsonb_build_object('before',previous,'after',to_jsonb(activity),'checks',checks)::text);
 return to_jsonb(activity);
end $$;
revoke all on function public.approve_experience_activity(uuid,integer,text) from public,anon;
grant execute on function public.approve_experience_activity(uuid,integer,text) to authenticated;

create function private.notify_experience_activity_approved() returns trigger
language plpgsql security definer set search_path='' as $$
declare activity public.experience_activities; event_id uuid; host_state text;
begin
 if new.action<>'approved' then return new;end if;
 select * into activity from public.experience_activities where id=new.activity_id;
 select state into host_state from public.profiles where user_id=activity.host_user_id;
 perform private.resolve_subject_activity('experience_activity',activity.id::text,null,null);
 event_id:=private.upsert_activity_event('experience_activity_approved:'||new.id::text,'experience.application.approved','experience_activity',activity.id::text,new.actor_user_id,
  'Experience activity approved','The activity review is approved. This does not open public booking or checkout.','experience_application',jsonb_build_object('context_id',activity.id),now());
 perform private.add_activity_audience(event_id,activity.host_user_id,'worker','services',host_state,false);
 return new;
end $$;
revoke all on function private.notify_experience_activity_approved() from public,anon,authenticated;
create trigger experience_activity_approval_activity after insert on public.experience_activity_events for each row execute function private.notify_experience_activity_approved();

create or replace function public.transition_my_experience_activity(p_activity_id uuid,p_expected_revision integer,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); activity public.experience_activities; issues text[]; next_status text;
begin
 if p_expected_revision is null or p_action is null then raise exception 'Choose an activity action';end if;
 select * into activity from public.experience_activities where id=p_activity_id for update;
 if activity.id is null or activity.host_user_id<>actor then raise exception 'This activity is unavailable to this account' using errcode='42501';end if;
 next_status:=case p_action when 'submit' then 'submitted' when 'withdraw' then 'withdrawn' when 'archive' then 'archived' else null end;
 if next_status is null then raise exception 'Choose a supported activity action';end if;
 if activity.status=next_status and activity.revision=p_expected_revision+1 then return to_jsonb(activity);end if;
 if activity.revision<>p_expected_revision then raise exception 'This activity changed. Refresh before continuing';end if;
 if p_action='submit' then
  if activity.status not in ('draft','changes_required','withdrawn') then raise exception 'This activity cannot be submitted';end if;
  issues:=private.experience_activity_issues(activity.details);
  if cardinality(issues)>0 then raise exception 'Complete the activity details before submission' using detail=array_to_string(issues,E'\n');end if;
 elsif p_action='withdraw' and activity.status not in ('submitted','approved') then raise exception 'Only a submitted or approved activity can be withdrawn';
 elsif p_action='archive' and activity.status not in ('draft','withdrawn','changes_required','declined') then raise exception 'Withdraw this activity before archiving';end if;
 update public.experience_activities set status=next_status,revision=revision+1,updated_at=now(),submitted_at=case when p_action='submit' then now() else submitted_at end where id=activity.id returning * into activity;
 insert into public.experience_activity_events(activity_id,activity_revision,actor_user_id,action) values(activity.id,activity.revision,actor,case p_action when 'submit' then 'submitted' when 'withdraw' then 'withdrawn' else 'archived' end);
 return to_jsonb(activity);
end $$;

create or replace function public.get_experience_activity(p_activity_id uuid,p_for_review boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text; activity public.experience_activities;
begin
 if p_for_review is null then raise exception 'Choose an application view';end if;
 if p_for_review then actor:=private.experience_creator_actor();else actor:=private.experience_host_actor();end if;
 select * into activity from public.experience_activities where id=p_activity_id;
 if activity.id is null or (not p_for_review and activity.host_user_id<>actor)
  or (p_for_review and (activity.host_user_id=actor or activity.submitted_at is null
   or activity.status not in ('submitted','changes_required','declined','withdrawn','approved'))) then
  raise exception 'This application is unavailable to this account' using errcode='42501';
 end if;
 return to_jsonb(activity)||jsonb_build_object('category_name',(select c.name from public.experience_categories c where c.code=activity.details->>'category'));
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
  if activity.submitted_at is null or activity.status not in ('submitted','changes_required','declined','withdrawn','approved') then
   raise exception 'This application is not currently shared for review' using errcode='42501';
  end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.activity_revision),'[]'::jsonb) into rows
 from (select * from public.experience_activity_events where activity_id=activity.id order by activity_revision desc limit 50)e;
 return rows;
end $$;

create or replace function public.can_access_experience_evidence(p_activity_id uuid,p_review boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor text; activity public.experience_activities;
begin
 if p_review is null then return false;end if;
 select * into activity from public.experience_activities where id=p_activity_id;
 if activity.id is null then return false;end if;
 if public.current_profile_user_id()=activity.host_user_id then
  actor:=private.experience_host_actor();return not p_review;
 end if;
 actor:=private.experience_creator_actor();
 if p_review and activity.status='approved' then return false;end if;
 return actor<>activity.host_user_id and activity.submitted_at is not null and activity.status in ('submitted','changes_required','declined','withdrawn','approved');
exception when insufficient_privilege then return false;
end $$;

create or replace function public.get_experience_review_sessions(p_activity_id uuid,p_expected_revision integer,p_after_start timestamptz default null,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_creator_actor(); activity public.experience_activities; result jsonb;
begin
 select * into activity from public.experience_activities where id=p_activity_id;
 if activity.id is null or activity.host_user_id=actor or activity.status not in ('submitted','approved') or activity.submitted_at is null then raise exception 'Submitted application unavailable' using errcode='42501';end if;
 if p_expected_revision is distinct from activity.revision then raise exception 'Application changed. Refresh before reviewing dates';end if;
 if (p_after_start is null)<>(p_after_id is null) then raise exception 'Use a complete session cursor';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.starts_at,s.id),'[]'::jsonb) into result from
 (select * from public.experience_sessions where activity_id=p_activity_id and status='draft'
  and updated_at<=activity.submitted_at
  and (p_after_id is null or (starts_at,id)>(p_after_start,p_after_id)) order by starts_at,id limit 20)s;
 return result;
end $$;
