-- Private Experiences activity workflow. Public sales are deliberately not enabled
-- by this migration: sessions, evidence approval and canonical money follow it.
create table public.experience_activities (
 id uuid primary key,
 host_user_id text not null references public.profiles(user_id) on delete restrict,
 revision integer not null default 1 check (revision > 0),
 status text not null default 'draft' check(status in ('draft','submitted','changes_required','declined','withdrawn','archived')),
 details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object' and octet_length(details::text)<=32768),
 submitted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index experience_activities_host_page on public.experience_activities(host_user_id,updated_at desc,id desc);
create index experience_activities_review_page on public.experience_activities(updated_at,id) where status='submitted';
create table public.experience_activity_events (
 id uuid primary key default gen_random_uuid(),
 activity_id uuid not null references public.experience_activities(id) on delete restrict,
 activity_revision integer not null check(activity_revision>0),
 actor_user_id text not null references public.profiles(user_id) on delete restrict,
 action text not null check(action in ('created','edited','submitted','withdrawn','changes_required','declined','archived')),
 note text,
 created_at timestamptz not null default now(),
 unique(activity_id,activity_revision)
);
create index experience_activity_events_page on public.experience_activity_events(activity_id,activity_revision desc);
alter table public.experience_activities enable row level security;
alter table public.experience_activity_events enable row level security;
revoke all on public.experience_activities,public.experience_activity_events from public,anon,authenticated;
grant all on public.experience_activities,public.experience_activity_events to service_role;

-- Keep authorization in private helpers. Service occupation/review is not a
-- prerequisite to applying for an Experience in the shared provider workspace.
create function private.experience_host_actor() returns text
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null or not public._property_document_session_active()
  or not public.user_has_active_workspace(actor,'worker') then
  raise exception 'An active Service Worker workspace and trusted signed-in device are required' using errcode='42501';
 end if;
 return actor;
end $$;
revoke all on function private.experience_host_actor() from public,anon,authenticated;

-- Launch operations starts with the existing Creator authority. Delegated review
-- must later use the same Team/geography authority, never a new account or flag.
create function private.experience_creator_actor() returns text
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null or not public._property_document_session_active()
  or not public.current_actor_has_workspace('creator',null)
  or not exists(select 1 from public.creator_elevation_grants g
    where public.creator_has_elevation(g.creator_elevation_id,'private_evidence')) then
  raise exception 'Fresh Creator confirmation is required for private activity review' using errcode='42501';
 end if;
 return actor;
end $$;
revoke all on function private.experience_creator_actor() from public,anon,authenticated;

create function private.experience_activity_issues(body jsonb) returns text[]
language plpgsql stable set search_path='' as $$
declare issues text[]:='{}'; field text; items jsonb;
begin
 if jsonb_typeof(body) is distinct from 'object' then return array['Activity details are required'];end if;
 for field in select unnest(array['title','category','what_to_expect','host_expertise','country_code','state','local_area','city','meeting_area','timezone','participation_requirements','accessibility_information']) loop
  if jsonb_typeof(body->field) is distinct from 'string' or length(btrim(body->>field))=0 then issues:=array_append(issues,field||' is required');end if;
 end loop;
 if length(coalesce(body->>'title','')) not between 5 and 120 then issues:=array_append(issues,'Use an activity title between 5 and 120 characters');end if;
 if length(coalesce(body->>'what_to_expect','')) not between 80 and 6000 then issues:=array_append(issues,'Describe what participants will do in 80 to 6000 characters');end if;
 if length(coalesce(body->>'host_expertise','')) not between 40 and 4000 then issues:=array_append(issues,'Explain the relevant expertise in 40 to 4000 characters');end if;
 if coalesce(body->>'category','') not in ('culture_tours','food','creative_learning','outdoor') then issues:=array_append(issues,'Choose a supported activity category');end if;
 if coalesce(body->>'country_code','') !~ '^[A-Z]{2}$' then issues:=array_append(issues,'Choose a valid country');end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=body->>'timezone') then issues:=array_append(issues,'Choose a valid activity timezone');end if;
 if jsonb_typeof(body->'duration_minutes') is distinct from 'number' or coalesce(body->>'duration_minutes','') !~ '^[0-9]{1,4}$' then issues:=array_append(issues,'Duration must be a whole number of minutes');
 elsif (body->>'duration_minutes')::integer not between 15 and 1440 then issues:=array_append(issues,'Duration must be between 15 minutes and one day');end if;
 if jsonb_typeof(body->'max_group_size') is distinct from 'number' or coalesce(body->>'max_group_size','') !~ '^[0-9]{1,3}$' then issues:=array_append(issues,'Group size must be a whole number');
 elsif (body->>'max_group_size')::integer not between 1 and 100 then issues:=array_append(issues,'Group size must be between 1 and 100 for review');end if;
 for field in select unnest(array['inclusions','exclusions']) loop
  items:=body->field;
  if jsonb_typeof(items) is distinct from 'array' then issues:=array_append(issues,field||' must be a list');
  elsif jsonb_array_length(items)>20 or exists(select 1 from jsonb_array_elements(items) item where jsonb_typeof(item) is distinct from 'string' or length(btrim(item#>>'{}')) not between 1 and 500) then issues:=array_append(issues,field||' must contain at most 20 short descriptions');end if;
 end loop;
 return issues;
end $$;
revoke all on function private.experience_activity_issues(jsonb) from public,anon,authenticated;

create function public.save_my_experience_activity(p_activity_id uuid,p_expected_revision integer,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); activity public.experience_activities; issues text[]; action_name text;
begin
 if p_activity_id is null or p_expected_revision is null or p_expected_revision<0
  or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>32768 then raise exception 'Choose a draft and valid activity details';end if;
 -- Serialize this host's draft quota as well as the submitted UUID. Independent
 -- concurrent draft IDs must not bypass the per-account creation limit.
 perform 1 from public.profiles where user_id=actor for update;
 -- Serialize by the submitted UUID, including first creation and response-loss retries.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_activity_id::text,0));
 select * into activity from public.experience_activities where id=p_activity_id for update;
 if activity.id is null then
  if p_expected_revision<>0 then raise exception 'The draft is unavailable. Refresh before saving';end if;
  if (select count(*) from public.experience_activities where host_user_id=actor and status in ('draft','changes_required','withdrawn'))>=30 then raise exception 'Finish or archive an existing draft before creating another';end if;
  insert into public.experience_activities(id,host_user_id,details) values(p_activity_id,actor,p_details) returning * into activity;
  action_name:='created';
 else
  if activity.host_user_id<>actor then raise exception 'This activity is unavailable to this account' using errcode='42501';end if;
  if activity.status not in ('draft','changes_required','withdrawn') then raise exception 'Withdraw the submission before editing this activity';end if;
  if activity.details=p_details and activity.revision in (p_expected_revision,p_expected_revision+1) then
   return jsonb_build_object('activity',to_jsonb(activity),'issues',private.experience_activity_issues(activity.details));
  end if;
  if activity.revision<>p_expected_revision then raise exception 'This activity changed. Refresh before saving';end if;
  update public.experience_activities set details=p_details,revision=revision+1,status='draft',updated_at=now() where id=activity.id returning * into activity;
  action_name:='edited';
 end if;
 insert into public.experience_activity_events(activity_id,activity_revision,actor_user_id,action) values(activity.id,activity.revision,actor,action_name);
 issues:=private.experience_activity_issues(activity.details);
 return jsonb_build_object('activity',to_jsonb(activity),'issues',issues);
end $$;
revoke all on function public.save_my_experience_activity(uuid,integer,jsonb) from public,anon;
grant execute on function public.save_my_experience_activity(uuid,integer,jsonb) to authenticated;

create function public.transition_my_experience_activity(p_activity_id uuid,p_expected_revision integer,p_action text) returns jsonb
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
 elsif p_action='withdraw' and activity.status<>'submitted' then raise exception 'Only a submitted activity can be withdrawn';
 elsif p_action='archive' and activity.status not in ('draft','withdrawn','changes_required','declined') then raise exception 'Withdraw this activity before archiving';end if;
 update public.experience_activities set status=next_status,revision=revision+1,updated_at=now(),submitted_at=case when p_action='submit' then now() else submitted_at end where id=activity.id returning * into activity;
 insert into public.experience_activity_events(activity_id,activity_revision,actor_user_id,action) values(activity.id,activity.revision,actor,case p_action when 'submit' then 'submitted' when 'withdraw' then 'withdrawn' else 'archived' end);
 return to_jsonb(activity);
end $$;
revoke all on function public.transition_my_experience_activity(uuid,integer,text) from public,anon;
grant execute on function public.transition_my_experience_activity(uuid,integer,text) to authenticated;

create function public.get_my_experience_activities(p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); rows jsonb;
begin
 if (p_before is null)<>(p_before_id is null) then raise exception 'Use a complete activity cursor';end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.updated_at desc,a.id desc),'[]'::jsonb) into rows from (
  select * from public.experience_activities where host_user_id=actor
   and (p_before is null or (updated_at,id)<(p_before,p_before_id)) order by updated_at desc,id desc limit 20)a;
 return rows;
end $$;
revoke all on function public.get_my_experience_activities(timestamptz,uuid) from public,anon;
grant execute on function public.get_my_experience_activities(timestamptz,uuid) to authenticated;

create function public.get_experience_activity_review_queue(p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_creator_actor(); rows jsonb;
begin
 if (p_before is null)<>(p_before_id is null) then raise exception 'Use a complete review cursor';end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.updated_at desc,a.id desc),'[]'::jsonb) into rows from (
  select * from public.experience_activities where status='submitted' and host_user_id<>actor
   and (p_before is null or (updated_at,id)<(p_before,p_before_id)) order by updated_at desc,id desc limit 20)a;
 return rows;
end $$;
revoke all on function public.get_experience_activity_review_queue(timestamptz,uuid) from public,anon;
grant execute on function public.get_experience_activity_review_queue(timestamptz,uuid) to authenticated;

create function public.request_experience_activity_changes(p_activity_id uuid,p_expected_revision integer,p_decision text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_creator_actor(); activity public.experience_activities;
begin
 if p_decision is null or p_decision not in ('changes_required','declined') or length(btrim(coalesce(p_note,''))) not between 20 and 2000 then raise exception 'Choose an outcome and explain the review decision in 20 to 2000 characters';end if;
 select * into activity from public.experience_activities where id=p_activity_id for update;
 if activity.id is null or activity.host_user_id=actor then raise exception 'Independent activity review is required' using errcode='42501';end if;
 if activity.status=p_decision and activity.revision=p_expected_revision+1 and exists(select 1 from public.experience_activity_events e where e.activity_id=activity.id and e.activity_revision=activity.revision and e.actor_user_id=actor and e.action=p_decision and e.note=btrim(p_note)) then return to_jsonb(activity);end if;
 if p_expected_revision is null or activity.revision<>p_expected_revision or activity.status<>'submitted' then raise exception 'This activity changed. Refresh before reviewing';end if;
 update public.experience_activities set status=p_decision,revision=revision+1,updated_at=now() where id=activity.id returning * into activity;
 insert into public.experience_activity_events(activity_id,activity_revision,actor_user_id,action,note) values(activity.id,activity.revision,actor,p_decision,btrim(p_note));
 insert into public.audit_logs(action,target_type,target_id,details,admin_id) values('EXPERIENCE_ACTIVITY_REVIEW','experience_activity',activity.id::text,jsonb_build_object('revision',activity.revision,'outcome',p_decision,'note',btrim(p_note))::text,actor);
 return to_jsonb(activity);
end $$;
revoke all on function public.request_experience_activity_changes(uuid,integer,text,text) from public,anon;
grant execute on function public.request_experience_activity_changes(uuid,integer,text,text) to authenticated;

create function public.get_experience_activity_history(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); activity public.experience_activities; rows jsonb;
begin
 select * into activity from public.experience_activities where id=p_activity_id;
 if activity.id is null then raise exception 'Activity unavailable';end if;
 if activity.host_user_id=actor then perform private.experience_host_actor();else perform private.experience_creator_actor();end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.activity_revision),'[]'::jsonb) into rows from (select * from public.experience_activity_events where activity_id=activity.id order by activity_revision desc limit 50)e;
 return rows;
end $$;
revoke all on function public.get_experience_activity_history(uuid) from public,anon;
grant execute on function public.get_experience_activity_history(uuid) to authenticated;
