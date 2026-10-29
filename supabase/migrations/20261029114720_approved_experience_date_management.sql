-- Reviewed activity content and limits are distinct from routine availability.
-- Keep one session/capacity/quote authority and freeze dates already contracted.
alter table public.experience_sessions
 add column booking_open boolean not null default true,
 add column availability_revision integer not null default 0 check(availability_revision>=0);

create function private.experience_session_edit_locked(p_session_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.experience_bookings b where b.session_id=p_session_id and (
  b.payment_protection_id is not null or b.status in('confirmed','completed','refund_pending','review_pending') or b.status='pending_payment' and b.expires_at>now()));
$$;
revoke all on function private.experience_session_edit_locked(uuid) from public,anon,authenticated,service_role;

create function private.experience_write_budget(p_actor text,p_action text default 'experience_activity_write') returns void
language plpgsql security definer set search_path='' as $$
declare budget public.user_action_rate_limits;
begin
 insert into public.user_action_rate_limits as limits(user_key,action,window_started_at,attempt_count,updated_at)
 values(p_actor,p_action,now(),1,now()) on conflict(user_key,action) do update set
  window_started_at=case when limits.window_started_at<=now()-interval '1 minute' then now() else limits.window_started_at end,
  attempt_count=case when limits.window_started_at<=now()-interval '1 minute' then 1 else limits.attempt_count+1 end,updated_at=now() returning * into budget;
 if budget.attempt_count>30 then raise exception 'Too many activity requests. Wait a minute and try again';end if;
end $$;
revoke all on function private.experience_write_budget(text,text) from public,anon,authenticated,service_role;
create or replace function private.throttle_experience_activity_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform private.experience_write_budget(new.actor_user_id);return new;end $$;

create function private.experience_host_date_conflict(p_actor text,p_session_id uuid,p_start timestamptz,p_end timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.experience_sessions s join public.experience_activities a on a.id=s.activity_id
  left join public.experience_publications p on p.activity_id=a.id
  where a.host_user_id=p_actor and s.id<>p_session_id and s.starts_at<p_end and s.ends_at>p_start and (
   (s.status='draft' and s.booking_open and p.published and p.activity_revision=a.revision and a.status='approved' and s.activity_revision=a.approved_from_revision-1)
   or exists(select 1 from public.experience_bookings b where b.session_id=s.id and (b.status in('confirmed','review_pending') or b.status='pending_payment' and b.expires_at>now()))));
$$;
revoke all on function private.experience_host_date_conflict(text,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function private.experience_session_remaining(p_session_id uuid) returns integer
language sql stable security definer set search_path='' as $$
 select greatest(0,s.capacity-coalesce((select sum(b.participants)::integer from public.experience_bookings b
  where b.session_id=s.id and (b.status in ('confirmed','completed','review_pending') or (b.status='pending_payment' and b.expires_at>now()))),0))
 from public.experience_sessions s where s.id=p_session_id;
$$;
revoke all on function private.experience_session_remaining(uuid) from public,anon,authenticated;

create or replace function public.save_my_experience_session(
 p_activity_id uuid,p_session_id uuid,p_expected_revision integer,p_activity_revision integer,
 p_starts_at timestamptz,p_capacity integer,p_price_minor bigint,p_currency text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor();activity public.experience_activities;saved public.experience_sessions;
 finish timestamptz;zone text;content_revision integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('experience-schedule:'||actor,0));
 select * into activity from public.experience_activities where id=p_activity_id and host_user_id=actor for update;
 if activity.id is null or activity.host_user_id<>actor then raise exception 'Session unavailable' using errcode='42501';end if;
 if activity.status not in ('draft','changes_required','withdrawn','approved') then raise exception 'This activity cannot manage dates';end if;
 if p_activity_revision is distinct from activity.revision then raise exception 'Activity changed. Refresh before managing dates';end if;
 content_revision:=case when activity.status='approved' then activity.approved_from_revision-1 else activity.revision end;
 if content_revision is null or content_revision<1 then raise exception 'The reviewed activity version could not be confirmed';end if;
 if p_session_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Choose a valid date';end if;
 if jsonb_typeof(activity.details->'duration_minutes') is distinct from 'number' or coalesce(activity.details->>'duration_minutes','') !~ '^[0-9]{1,4}$'
  or jsonb_typeof(activity.details->'max_group_size') is distinct from 'number' or coalesce(activity.details->>'max_group_size','') !~ '^[0-9]{1,3}$' then raise exception 'Save the activity duration and maximum participants first';end if;
 if (activity.details->>'duration_minutes')::integer not between 15 and 1440 or (activity.details->>'max_group_size')::integer not between 1 and 100 then raise exception 'Save a valid duration and group size';end if;
 zone:=activity.details->>'timezone';
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'Save a valid activity timezone';end if;
 if p_starts_at is null or not isfinite(p_starts_at) or p_capacity is null or p_capacity not between 1 and (activity.details->>'max_group_size')::integer
  or p_price_minor is null or p_price_minor not between 1 and 9007199254740991
  or not exists(select 1 from public.platform_countries where enabled and country_code=activity.details->>'country_code' and currency_code=p_currency)
 then raise exception 'Choose a valid future date, capacity, price and activity-country currency';end if;
 finish:=p_starts_at+make_interval(mins=>(activity.details->>'duration_minutes')::integer);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text,0));
 select * into saved from public.experience_sessions where id=p_session_id for update;
 if saved.id is not null then
  if saved.activity_id<>activity.id then raise exception 'Date unavailable' using errcode='42501';end if;
  if saved.status<>'draft' then raise exception 'Stopped dates cannot be edited. Add a new date';end if;
  if saved.revision in(p_expected_revision,p_expected_revision+1) and saved.activity_revision=content_revision
   and saved.starts_at=p_starts_at and saved.ends_at=finish and saved.timezone=zone and saved.capacity=p_capacity
   and saved.price_minor=p_price_minor and saved.currency=p_currency then return to_jsonb(saved);end if;
  if saved.revision<>p_expected_revision then raise exception 'Date changed. Refresh before saving';end if;
  if private.experience_session_edit_locked(saved.id) then
   raise exception 'This date has a held or paid booking. Keep its time, capacity and standard price; add another date instead';end if;
 elsif p_expected_revision<>0 then raise exception 'Date unavailable. Refresh before saving';
 elsif (select count(*) from public.experience_sessions where activity_id=activity.id and status='draft')>=100 then raise exception 'Stop unused dates before adding more';end if;
 if p_starts_at<=now() then raise exception 'Choose a future date';end if;
 if activity.status='approved' and coalesce(saved.booking_open,true) and exists(select 1 from public.experience_publications where activity_id=activity.id and published and activity_revision=activity.revision)
  and private.experience_host_date_conflict(actor,p_session_id,p_starts_at,finish) then raise exception 'This time overlaps another activity you are hosting. Choose another date or time';end if;
 if saved.id is null then
  insert into public.experience_sessions(id,activity_id,activity_revision,starts_at,ends_at,timezone,capacity,price_minor,currency)
  values(p_session_id,activity.id,content_revision,p_starts_at,finish,zone,p_capacity,p_price_minor,p_currency) returning * into saved;
 else
  update public.experience_sessions set revision=revision+1,activity_revision=content_revision,starts_at=p_starts_at,ends_at=finish,
   timezone=zone,capacity=p_capacity,price_minor=p_price_minor,currency=p_currency,updated_at=now() where id=saved.id returning * into saved;
 end if;
 insert into public.experience_session_events(session_id,revision,actor_user_id,snapshot) values(saved.id,saved.revision,actor,to_jsonb(saved));
 return to_jsonb(saved);
end $$;

create or replace function public.archive_my_experience_session(p_activity_id uuid,p_session_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor();saved public.experience_sessions;
begin
 perform 1 from public.experience_activities where id=p_activity_id and host_user_id=actor for update;
 if not found then raise exception 'Date unavailable' using errcode='42501';end if;
 if exists(select 1 from public.experience_activities where id=p_activity_id and status='submitted') then raise exception 'Withdraw the application before changing its submitted dates';end if;
 select * into saved from public.experience_sessions where id=p_session_id and activity_id=p_activity_id for update;
 if saved.id is null then raise exception 'Date unavailable';end if;
 if saved.status='archived' and saved.revision=p_expected_revision+1 then return to_jsonb(saved);end if;
 if saved.status<>'draft' or saved.revision is distinct from p_expected_revision then raise exception 'Date changed. Refresh before stopping new bookings';end if;
 if exists(select 1 from public.experience_activities where id=p_activity_id and status='approved') then raise exception 'Use date availability to stop new bookings without changing accepted bookings';end if;
 if private.experience_session_edit_locked(saved.id) then raise exception 'A held or paid date stays in the booking record. Manage its availability after approval';end if;
 update public.experience_sessions set status='archived',revision=revision+1,updated_at=now() where id=saved.id returning * into saved;
 insert into public.experience_session_events(session_id,revision,actor_user_id,snapshot) values(saved.id,saved.revision,actor,to_jsonb(saved));
 return to_jsonb(saved);
end $$;
revoke all on function public.save_my_experience_session(uuid,uuid,integer,integer,timestamptz,integer,bigint,text),public.archive_my_experience_session(uuid,uuid,integer) from public,anon;
grant execute on function public.save_my_experience_session(uuid,uuid,integer,integer,timestamptz,integer,bigint,text),public.archive_my_experience_session(uuid,uuid,integer) to authenticated;

create function public.set_my_experience_session_availability(p_session_id uuid,p_expected_revision integer,p_open boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor();a public.experience_activities;s public.experience_sessions;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('experience-schedule:'||actor,0));
 select activity.* into a from public.experience_activities activity join public.experience_sessions session on session.activity_id=activity.id where session.id=p_session_id and activity.host_user_id=actor for update of activity;
 if a.id is null then raise exception 'Date unavailable' using errcode='42501';end if;
 select * into s from public.experience_sessions where id=p_session_id and activity_id=a.id for update;
 if a.id is null or a.status<>'approved' or s.status<>'draft' or s.activity_revision<>a.approved_from_revision-1 or s.starts_at<=now() then raise exception 'Choose a future date of your current approved activity';end if;
 if p_expected_revision is null or p_expected_revision<0 or p_open is null then raise exception 'Choose a valid date availability change';end if;
 if s.availability_revision=p_expected_revision+1 and s.booking_open=p_open then return to_jsonb(s)||jsonb_build_object('edit_locked',private.experience_session_edit_locked(s.id));end if;
 if s.availability_revision<>p_expected_revision then raise exception 'Date availability changed. Refresh before saving';end if;
 if p_open and exists(select 1 from public.experience_publications where activity_id=a.id and published and activity_revision=a.revision)
  and private.experience_host_date_conflict(actor,s.id,s.starts_at,s.ends_at) then raise exception 'This time overlaps another activity you are hosting';end if;
 perform private.experience_write_budget(actor);
 update public.experience_sessions set booking_open=p_open,availability_revision=availability_revision+1,updated_at=now() where id=s.id returning * into s;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details) values('EXPERIENCE_DATE_AVAILABILITY_CHANGED','experience_session',s.id::text,actor,jsonb_build_object('open',p_open,'availability_revision',s.availability_revision)::text);
 return to_jsonb(s)||jsonb_build_object('edit_locked',private.experience_session_edit_locked(s.id));
end $$;
revoke all on function public.set_my_experience_session_availability(uuid,integer,boolean) from public,anon;
grant execute on function public.set_my_experience_session_availability(uuid,integer,boolean) to authenticated;

-- Existing holds keep their accepted revision and can finish payment after a
-- date closes. Only new quotes, holds, public dates and promotion are stopped.
do $extend$declare definition text;signature text;needle text;begin
 definition:=pg_get_functiondef('public.get_my_provider_workspace_capabilities()'::regprocedure);
 needle:='''can_access_earnings'',true,''experience_next'',next_bookings';
 if strpos(definition,needle)=0 then raise exception 'Inspect Provider work history projection';end if;
 execute replace(definition,needle,'''can_access_earnings'',true,''has_activity_bookings'',exists(select 1 from public.experience_bookings where host_user_id=actor),''experience_next'',next_bookings');
 foreach signature in array array['private.experience_public_projection(uuid)','public.get_published_experience_sessions(uuid,timestamptz,uuid)','private.sponsored_experience_context(text,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);needle:='s.status=''draft''';
  if strpos(definition,needle)=0 then raise exception 'Inspect public date visibility: %',signature;end if;
  execute replace(definition,needle,needle||' and s.booking_open');
 end loop;
 definition:=pg_get_functiondef('private.experience_quote(uuid,integer)'::regprocedure);needle:='s.status<>''draft''';
 if strpos(definition,needle)=0 then raise exception 'Inspect activity quote date guard';end if;
 execute replace(definition,needle,'(s.status<>''draft'' or not s.booking_open)');
 definition:=pg_get_functiondef('public.get_my_experience_sessions(uuid,timestamptz,uuid)'::regprocedure);needle:='to_jsonb(s) order by';
 if strpos(definition,needle)=0 then raise exception 'Inspect owned date projection';end if;
 execute replace(definition,needle,'(to_jsonb(s)||jsonb_build_object(''edit_locked'',private.experience_session_edit_locked(s.id))) order by');
 definition:=pg_get_functiondef('public.set_my_experience_session_discount(uuid,integer,numeric,date)'::regprocedure);needle:=' update public.experience_sessions set discount_percent';
 if strpos(definition,needle)=0 then raise exception 'Inspect activity offer mutation budget';end if;
 execute replace(definition,needle,' perform private.experience_write_budget(actor);'||chr(10)||needle);
 definition:=pg_get_functiondef('public.hold_experience_booking(uuid,uuid,integer,text)'::regprocedure);needle:=' insert into public.experience_bookings';
 if strpos(definition,needle)=0 then raise exception 'Inspect booking hold mutation budget';end if;
 execute replace(definition,needle,' perform private.experience_write_budget(actor,''experience_booking_write'');'||chr(10)||needle);
 definition:=pg_get_functiondef('public.set_my_experience_publication(uuid,integer,integer,boolean)'::regprocedure);
 needle:='begin'||chr(10);
 if strpos(definition,needle)=0 then raise exception 'Inspect publication locking';end if;
 definition:=replace(definition,needle,needle||' perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''experience-schedule:''||actor,0));'||chr(10));
 needle:=' if p_published then';
 if strpos(definition,needle)=0 then raise exception 'Inspect published host schedule checks';end if;
 definition:=replace(definition,needle,needle||chr(10)||$guard$
  if exists(select 1 from public.experience_sessions scheduled where scheduled.activity_id=a.id and scheduled.status='draft' and scheduled.booking_open and scheduled.starts_at>now() and scheduled.activity_revision=a.approved_from_revision-1
   and (private.experience_host_date_conflict(actor,scheduled.id,scheduled.starts_at,scheduled.ends_at)
    or exists(select 1 from public.experience_sessions another where another.activity_id=a.id and another.id<>scheduled.id and another.status='draft' and another.booking_open and another.activity_revision=scheduled.activity_revision and another.starts_at<scheduled.ends_at and another.ends_at>scheduled.starts_at))) then
   raise exception 'These dates overlap another activity you are hosting. Update the dates before publication';end if;
$guard$);
 execute definition;
end $extend$;
