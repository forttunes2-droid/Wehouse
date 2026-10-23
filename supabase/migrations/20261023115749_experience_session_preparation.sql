-- Private session preparation belongs to the existing activity and provider.
-- No public SELECT or booking/publication authority is granted here.
create table public.experience_sessions (
 id uuid primary key,
 activity_id uuid not null references public.experience_activities(id) on delete restrict,
 revision integer not null default 1 check(revision>0),
 activity_revision integer not null check(activity_revision>0),
 starts_at timestamptz not null check(isfinite(starts_at)),
 ends_at timestamptz not null check(isfinite(ends_at) and ends_at>starts_at),
 timezone text not null,
 capacity integer not null check(capacity between 1 and 100),
 price_minor bigint not null check(price_minor between 1 and 9007199254740991),
 currency text not null check(currency~'^[A-Z]{3}$'),
 status text not null default 'draft' check(status in ('draft','archived')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index experience_sessions_activity_page on public.experience_sessions(activity_id,starts_at,id);
create table public.experience_session_events (
 session_id uuid not null references public.experience_sessions(id) on delete restrict,
 revision integer not null,
 actor_user_id text not null references public.profiles(user_id) on delete restrict,
 snapshot jsonb not null,
 created_at timestamptz not null default now(),
 primary key(session_id,revision)
);
alter table public.experience_sessions enable row level security;
alter table public.experience_session_events enable row level security;
revoke all on public.experience_sessions,public.experience_session_events from public,anon,authenticated;
grant all on public.experience_sessions,public.experience_session_events to service_role;
create trigger experience_session_write_budget before insert on public.experience_session_events
 for each row execute function private.throttle_experience_activity_event();

create function public.save_my_experience_session(
 p_activity_id uuid,p_session_id uuid,p_expected_revision integer,p_activity_revision integer,
 p_starts_at timestamptz,p_capacity integer,p_price_minor bigint,p_currency text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); activity public.experience_activities;
 saved public.experience_sessions; finish timestamptz; zone text;
begin
 -- Activity lock serializes quota and application edits; UUID lock prevents cross-activity races.
 select * into activity from public.experience_activities where id=p_activity_id for update;
 if activity.id is null or activity.host_user_id<>actor then raise exception 'Activity unavailable' using errcode='42501';end if;
 if activity.status not in ('draft','changes_required','withdrawn','submitted') then raise exception 'This activity cannot prepare sessions';end if;
 if p_activity_revision is distinct from activity.revision then raise exception 'Activity changed. Refresh before preparing dates';end if;
 if p_session_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Choose a valid session';end if;
 if jsonb_typeof(activity.details->'duration_minutes') is distinct from 'number'
  or coalesce(activity.details->>'duration_minutes','') !~ '^[0-9]{1,4}$'
  or jsonb_typeof(activity.details->'max_group_size') is distinct from 'number'
  or coalesce(activity.details->>'max_group_size','') !~ '^[0-9]{1,3}$' then raise exception 'Save the activity duration and maximum participants first';end if;
 if (activity.details->>'duration_minutes')::integer not between 15 and 1440
  or (activity.details->>'max_group_size')::integer not between 1 and 100 then raise exception 'Save a valid activity duration and group size first';end if;
 zone:=activity.details->>'timezone';
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'Save a valid activity timezone first';end if;
 if p_starts_at is null or not isfinite(p_starts_at) or p_capacity is null
  or p_capacity not between 1 and (activity.details->>'max_group_size')::integer
  or p_price_minor is null or p_price_minor not between 1 and 9007199254740991
  or not exists(select 1 from public.platform_countries where enabled and country_code=activity.details->>'country_code' and currency_code=p_currency)
 then raise exception 'Choose a valid date, capacity, price and activity-country currency';end if;
 finish:=p_starts_at+make_interval(mins=>(activity.details->>'duration_minutes')::integer);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text,0));
 select * into saved from public.experience_sessions where id=p_session_id for update;
 if saved.id is not null then
  if saved.activity_id<>activity.id then raise exception 'Session unavailable' using errcode='42501';end if;
  if saved.status<>'draft' then raise exception 'Archived sessions cannot be changed';end if;
  if saved.revision in(p_expected_revision,p_expected_revision+1) and saved.activity_revision=activity.revision
   and saved.starts_at=p_starts_at and saved.ends_at=finish and saved.timezone=zone and saved.capacity=p_capacity
   and saved.price_minor=p_price_minor and saved.currency=p_currency then return to_jsonb(saved);end if;
  if saved.revision<>p_expected_revision then raise exception 'Session changed. Refresh before saving';end if;
 elsif p_expected_revision<>0 then raise exception 'Session unavailable. Refresh before saving';
 elsif (select count(*) from public.experience_sessions where activity_id=activity.id and status='draft')>=100 then raise exception 'Archive unused dates before preparing more sessions';
 end if;
 if p_starts_at<=now() then raise exception 'Choose a future session date';end if;
 if saved.id is null then
  insert into public.experience_sessions(id,activity_id,activity_revision,starts_at,ends_at,timezone,capacity,price_minor,currency)
  values(p_session_id,activity.id,activity.revision,p_starts_at,finish,zone,p_capacity,p_price_minor,p_currency) returning * into saved;
 else
  update public.experience_sessions set revision=revision+1,activity_revision=activity.revision,starts_at=p_starts_at,
   ends_at=finish,timezone=zone,capacity=p_capacity,price_minor=p_price_minor,currency=p_currency,updated_at=now()
  where id=saved.id returning * into saved;
 end if;
 insert into public.experience_session_events(session_id,revision,actor_user_id,snapshot) values(saved.id,saved.revision,actor,to_jsonb(saved));
 return to_jsonb(saved);
end $$;
revoke all on function public.save_my_experience_session(uuid,uuid,integer,integer,timestamptz,integer,bigint,text) from public,anon;
grant execute on function public.save_my_experience_session(uuid,uuid,integer,integer,timestamptz,integer,bigint,text) to authenticated;

create function public.get_my_experience_sessions(p_activity_id uuid,p_after_start timestamptz default null,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); result jsonb;
begin
 if not exists(select 1 from public.experience_activities where id=p_activity_id and host_user_id=actor) then raise exception 'Activity unavailable' using errcode='42501';end if;
 if (p_after_start is null)<>(p_after_id is null) then raise exception 'Choose a complete page cursor';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.starts_at,s.id),'[]'::jsonb) into result from
 (select * from public.experience_sessions where activity_id=p_activity_id and status='draft'
  and (p_after_id is null or (starts_at,id)>(p_after_start,p_after_id)) order by starts_at,id limit 20)s;
 return result;
end $$;
revoke all on function public.get_my_experience_sessions(uuid,timestamptz,uuid) from public,anon;
grant execute on function public.get_my_experience_sessions(uuid,timestamptz,uuid) to authenticated;

create function public.archive_my_experience_session(p_activity_id uuid,p_session_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); saved public.experience_sessions;
begin
 perform 1 from public.experience_activities where id=p_activity_id and host_user_id=actor for update;
 if not found then raise exception 'Activity unavailable' using errcode='42501';end if;
 select * into saved from public.experience_sessions where id=p_session_id and activity_id=p_activity_id for update;
 if saved.id is null then raise exception 'Session unavailable';end if;
 if saved.status='archived' and saved.revision=p_expected_revision+1 then return to_jsonb(saved);end if;
 if saved.status<>'draft' or saved.revision is distinct from p_expected_revision then raise exception 'Session changed. Refresh before archiving';end if;
 update public.experience_sessions set status='archived',revision=revision+1,updated_at=now() where id=saved.id returning * into saved;
 insert into public.experience_session_events(session_id,revision,actor_user_id,snapshot) values(saved.id,saved.revision,actor,to_jsonb(saved));
 return to_jsonb(saved);
end $$;
revoke all on function public.archive_my_experience_session(uuid,uuid,integer) from public,anon;
grant execute on function public.archive_my_experience_session(uuid,uuid,integer) to authenticated;
