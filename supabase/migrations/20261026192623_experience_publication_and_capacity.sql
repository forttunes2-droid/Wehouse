-- Publication is an explicit host action on an independently approved activity.
-- No second provider workspace, identity, wallet or editable price authority.
create table public.experience_publications (
 activity_id uuid primary key references public.experience_activities(id) on delete restrict,
 revision integer not null check(revision>0),
 activity_revision integer not null check(activity_revision>0),
 published boolean not null,
 updated_at timestamptz not null default now()
);
alter table public.experience_publications enable row level security;
revoke all on public.experience_publications from public,anon,authenticated;
grant all on public.experience_publications to service_role;
create index experience_publications_page on public.experience_publications(updated_at desc,activity_id desc) where published;
create index experience_activities_country_category on public.experience_activities((details->>'country_code'),(details->>'category'),id) where status='approved';

create function private.experience_publication_checks(p_activity_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(private.experience_approval_checks(a.id),'{}'::jsonb)||jsonb_build_object(
  'approved',a.status='approved' and a.approved_from_revision=a.revision-1,
  'account',exists(select 1 from public.profiles p where p.user_id=a.host_user_id
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)),
  'commission',exists(select 1 from public.creator_policy_versions p where p.policy_key='commission_experience'
    and p.scope_type='global' and p.scope_key='*' and p.status='active' and p.effective_from<=now()
    and (p.effective_until is null or p.effective_until>now())
    and case when jsonb_typeof(p.value->'percent')='number' then (p.value->>'percent')::numeric between 0 and 50 else false end)
 ) from public.experience_activities a where a.id=p_activity_id;
$$;
revoke all on function private.experience_publication_checks(uuid) from public,anon,authenticated;

create function private.experience_is_published(p_activity_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.experience_publications p join public.experience_activities a on a.id=p.activity_id
  where a.id=p_activity_id and p.published and p.activity_revision=a.revision
  and not exists(select 1 from jsonb_each(private.experience_publication_checks(a.id)) c where c.value is distinct from 'true'::jsonb));
$$;
revoke all on function private.experience_is_published(uuid) from public,anon,authenticated;

create function public.get_my_experience_publication(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); a public.experience_activities;p public.experience_publications;checks jsonb;
begin
 select * into a from public.experience_activities where id=p_activity_id and host_user_id=actor;
 if a.id is null then raise exception 'Activity unavailable' using errcode='42501';end if;
 select * into p from public.experience_publications where activity_id=a.id;
 checks:=private.experience_publication_checks(a.id);
 return jsonb_build_object('activity_id',a.id,'activity_revision',a.revision,'revision',coalesce(p.revision,0),
  'published',coalesce(p.published,false),'visible',private.experience_is_published(a.id),'checks',checks,
  'can_publish',not exists(select 1 from jsonb_each(checks) c where c.value is distinct from 'true'::jsonb));
end $$;
revoke all on function public.get_my_experience_publication(uuid) from public,anon;
grant execute on function public.get_my_experience_publication(uuid) to authenticated;

create function public.set_my_experience_publication(p_activity_id uuid,p_activity_revision integer,p_expected_revision integer,p_published boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_host_actor();a public.experience_activities;p public.experience_publications;checks jsonb;
begin
 select * into a from public.experience_activities where id=p_activity_id and host_user_id=actor for update;
 if a.id is null then raise exception 'Activity unavailable' using errcode='42501';end if;
 if p_published is null or p_expected_revision is null or p_expected_revision<0
  or a.revision is distinct from p_activity_revision then raise exception 'Activity changed. Refresh before publishing';end if;
 select * into p from public.experience_publications where activity_id=a.id for update;
 if p.revision=p_expected_revision+1 and p.published=p_published and p.activity_revision=a.revision then return public.get_my_experience_publication(a.id);end if;
 if coalesce(p.revision,0)<>p_expected_revision then raise exception 'Publication changed. Refresh before continuing';end if;
 if p_published then
  checks:=private.experience_publication_checks(a.id);
  if checks is null or exists(select 1 from jsonb_each(checks) c where c.value is distinct from 'true'::jsonb) then
   raise exception 'Current approval, identity, evidence, photos, sessions and Creator commission are required';end if;
 end if;
 insert into public.experience_publications(activity_id,revision,activity_revision,published)
 values(a.id,p_expected_revision+1,a.revision,p_published)
 on conflict(activity_id) do update set revision=excluded.revision,activity_revision=excluded.activity_revision,published=excluded.published,updated_at=now();
 insert into public.audit_logs(action,target_type,target_id,admin_id,details)
 values(case when p_published then 'EXPERIENCE_PUBLISHED' else 'EXPERIENCE_UNPUBLISHED' end,'experience',a.id::text,actor,
  jsonb_build_object('publication_revision',p_expected_revision+1,'activity_revision',a.revision,'checks',checks)::text);
 return public.get_my_experience_publication(a.id);
end $$;
revoke all on function public.set_my_experience_publication(uuid,integer,integer,boolean) from public,anon;
grant execute on function public.set_my_experience_publication(uuid,integer,integer,boolean) to authenticated;

-- Session holds and paid attendance share one capacity authority. Money remains
-- in booking_payments and payment_protection_transactions.
create table public.experience_bookings (
 id uuid primary key,
 session_id uuid not null references public.experience_sessions(id) on delete restrict,
 activity_id uuid not null references public.experience_activities(id) on delete restrict,
 customer_user_id text not null references public.profiles(user_id) on delete restrict,
 host_user_id text not null references public.profiles(user_id) on delete restrict,
 participants integer not null check(participants between 1 and 100),
 status text not null default 'pending_payment' check(status in ('pending_payment','confirmed','cancelled','refund_pending','completed')),
 expires_at timestamptz not null,
 contract jsonb not null check(jsonb_typeof(contract)='object' and octet_length(contract::text)<=65536),
 payment_id uuid unique references public.booking_payments(id) on delete restrict,
 payment_protection_id uuid unique references public.payment_protection_transactions(id) on delete restrict,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(customer_user_id<>host_user_id)
);
create index experience_bookings_session_capacity on public.experience_bookings(session_id,status,expires_at);
create index experience_bookings_customer_page on public.experience_bookings(customer_user_id,created_at desc,id desc);
create index experience_bookings_host_page on public.experience_bookings(host_user_id,created_at desc,id desc);
create index experience_bookings_activity_idx on public.experience_bookings(activity_id);
alter table public.experience_bookings enable row level security;
revoke all on public.experience_bookings from public,anon,authenticated;
grant all on public.experience_bookings to service_role;

create function private.experience_session_remaining(p_session_id uuid) returns integer
language sql stable security definer set search_path='' as $$
 select greatest(0,s.capacity-coalesce((select sum(b.participants)::integer from public.experience_bookings b
  where b.session_id=s.id and (b.status in ('confirmed','completed') or (b.status='pending_payment' and b.expires_at>now()))),0))
 from public.experience_sessions s where s.id=p_session_id;
$$;
revoke all on function private.experience_session_remaining(uuid) from public,anon,authenticated;

create function private.experience_customer_details(p_details jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_details)
 where key=any(array['title','category','what_to_expect','host_expertise','country_code','state','local_area','city','meeting_area','timezone',
  'participation_requirements','accessibility_information','duration_minutes','max_group_size','inclusions','exclusions']);
$$;
revoke all on function private.experience_customer_details(jsonb) from public,anon,authenticated;

create function private.experience_public_projection(p_activity_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'revision',a.revision,'details',private.experience_customer_details(a.details)-'host_expertise',
  'host_expertise',a.details->>'host_expertise','host_user_id',a.host_user_id,'category_name',c.name,
  'photos',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'object_path',p.object_path,'caption',p.caption) order by p.created_at,p.id),'[]'::jsonb)
    from public.experience_activity_photos p where p.activity_id=a.id and p.status='approved' and p.activity_details=a.details),
  'next_session',(select jsonb_build_object('id',s.id,'starts_at',s.starts_at,'ends_at',s.ends_at,'timezone',s.timezone,
    'price_minor',s.price_minor,'currency',s.currency,'remaining',private.experience_session_remaining(s.id))
    from public.experience_sessions s where s.activity_id=a.id and s.status='draft' and s.starts_at>now()
    and private.experience_session_remaining(s.id)>0 order by s.starts_at,s.id limit 1))
 from public.experience_activities a join public.experience_categories c on c.code=a.details->>'category'
 where a.id=p_activity_id and private.experience_is_published(a.id);
$$;
revoke all on function private.experience_public_projection(uuid) from public,anon,authenticated;

create function public.search_experiences(p_country text,p_query text default '',p_category text default '',p_state text default '',p_area text default '',p_after timestamptz default null,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if public.current_profile_user_id() is null then raise exception 'Sign in to explore Experiences' using errcode='42501';end if;
 if p_country is null or p_country!~'^[A-Z]{2}$' or length(coalesce(p_query,''))>80 or length(coalesce(p_category,''))>60
  or length(coalesce(p_state,''))>100 or length(coalesce(p_area,''))>100
  or (p_after is null)<>(p_after_id is null) then raise exception 'Choose valid activity filters';end if;
 with candidates as (
  select a.id,p.updated_at from public.experience_publications p join public.experience_activities a on a.id=p.activity_id
  where p.published and a.status='approved' and a.details->>'country_code'=p_country
  and (nullif(p_category,'') is null or a.details->>'category'=p_category)
  and (nullif(p_state,'') is null or public.wehouse_state_key(a.details->>'state')=public.wehouse_state_key(p_state))
  and (nullif(p_area,'') is null or lower(a.details->>'local_area')=lower(p_area))
  and private.discovery_text_matches(concat_ws(' ',a.details->>'title',a.details->>'city',a.details->>'state',a.details->>'local_area',a.details->>'what_to_expect'),p_query)
  and (p_after is null or (p.updated_at,a.id)<(p_after,p_after_id))
  and private.experience_is_published(a.id)
  order by p.updated_at desc,a.id desc limit 25
 ), page as (select *,row_number() over(order by updated_at desc,id desc) as position from candidates)
 select jsonb_build_object('items',coalesce(jsonb_agg(private.experience_public_projection(id)||jsonb_build_object('cursor_at',updated_at) order by updated_at desc,id desc) filter(where position<=24),'[]'::jsonb),
  'has_more',coalesce(bool_or(position=25),false)) into result from page;
 return result;
end $$;
revoke all on function public.search_experiences(text,text,text,text,text,timestamptz,uuid) from public,anon;
grant execute on function public.search_experiences(text,text,text,text,text,timestamptz,uuid) to authenticated;

create function public.get_published_experience(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_profile_user_id() is null then raise exception 'Sign in to view this Experience' using errcode='42501';end if;
 return private.experience_public_projection(p_activity_id);
end $$;
revoke all on function public.get_published_experience(uuid) from public,anon;
grant execute on function public.get_published_experience(uuid) to authenticated;

create function public.get_published_experience_sessions(p_activity_id uuid,p_after timestamptz default null,p_after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_profile_user_id() is null or not private.experience_is_published(p_activity_id) then raise exception 'Activity unavailable' using errcode='42501';end if;
 if (p_after is null)<>(p_after_id is null) then raise exception 'Choose a complete session cursor';end if;
 return (select coalesce(jsonb_agg(to_jsonb(page) order by starts_at,id),'[]'::jsonb) from (
  select s.id,s.activity_id,s.revision,s.starts_at,s.ends_at,s.timezone,s.capacity,s.price_minor,s.currency,private.experience_session_remaining(s.id) as remaining
  from public.experience_sessions s where s.activity_id=p_activity_id and s.status='draft' and s.starts_at>now()
  and (p_after is null or (s.starts_at,s.id)>(p_after,p_after_id)) order by s.starts_at,s.id limit 21) page);
end $$;
revoke all on function public.get_published_experience_sessions(uuid,timestamptz,uuid) from public,anon;
grant execute on function public.get_published_experience_sessions(uuid,timestamptz,uuid) to authenticated;

-- Customer photo access is confined to independently approved public artwork.
-- Private identity/venue evidence never shares this bucket or read policy.
create function public.can_read_published_experience_photo(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.current_profile_user_id() is not null and exists(select 1 from public.experience_activity_photos p
  join public.experience_activities a on a.id=p.activity_id where p.object_path=p_path and p.status='approved'
  and p.activity_details=a.details and private.experience_is_published(a.id));
$$;
revoke all on function public.can_read_published_experience_photo(text) from public,anon;
grant execute on function public.can_read_published_experience_photo(text) to authenticated;
drop policy experience_photo_read on storage.objects;
drop policy experience_photo_read_boundary on storage.objects;
create policy experience_photo_read on storage.objects for select to authenticated using(bucket_id='experience-photos' and (public.can_read_published_experience_photo(name) or public.can_access_experience_photo_object(name,false)));
create policy experience_photo_read_boundary on storage.objects as restrictive for select to authenticated using(bucket_id<>'experience-photos' or public.can_read_published_experience_photo(name) or public.can_access_experience_photo_object(name,false));

create function private.experience_customer_actor() returns text
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null or not public._property_document_session_active() or not exists(select 1 from public.profiles
  where user_id=actor and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)) then
  raise exception 'An active account and trusted signed-in device are required' using errcode='42501';end if;
 return actor;
end $$;
revoke all on function private.experience_customer_actor() from public,anon,authenticated;

create function private.experience_quote(p_session_id uuid,p_participants integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.experience_sessions;a public.experience_activities;policy public.creator_policy_versions;total bigint;fee bigint;result jsonb;
begin
 select * into s from public.experience_sessions where id=p_session_id;
 select * into a from public.experience_activities where id=s.activity_id;
 if s.id is null or not private.experience_is_published(a.id) or s.status<>'draft' or s.starts_at<=now()
  or p_participants is null or p_participants not between 1 and s.capacity then raise exception 'This session or participant count is unavailable';end if;
 if s.currency<>'NGN' or a.details->>'country_code'<>'NG' then raise exception 'Payments are not available for this activity country and currency';end if;
 if s.price_minor::numeric*p_participants>9007199254740991 then raise exception 'Booking total exceeds supported precision';end if;
 total:=s.price_minor*p_participants;
 select * into policy from public.creator_policy_versions p where p.policy_key='commission_experience'
  and p.scope_type='global' and p.scope_key='*' and p.status='active' and p.effective_from<=now()
  and (p.effective_until is null or p.effective_until>now()) order by p.version desc limit 1;
 if policy.policy_version_id is null or jsonb_typeof(policy.value->'percent') is distinct from 'number'
  or (policy.value->>'percent')::numeric not between 0 and 50 then raise exception 'A valid Creator Experience commission is required';end if;
 fee:=round(total*(policy.value->>'percent')::numeric/100);
 result:=jsonb_build_object('activity_id',a.id,'activity_revision',a.revision,'session_id',s.id,'session_revision',s.revision,
  'host_user_id',a.host_user_id,'title',a.details->>'title','activity_details',private.experience_customer_details(a.details),
  'starts_at',s.starts_at,'ends_at',s.ends_at,'timezone',s.timezone,'participants',p_participants,
  'price_per_participant_minor',s.price_minor,'total_minor',total,'currency',s.currency,
  'commission_policy_version_id',policy.policy_version_id,'commission_percent',(policy.value->>'percent')::numeric,
  'commission_minor',fee,'host_receives_minor',total-fee,
  'cancellation_policy','experience_standard_24h_v1','cancellation_deadline',s.starts_at-interval '24 hours',
  'customer_cancellation_before_deadline','full_refund','customer_late_cancellation','review_required','host_cancellation','full_refund');
 return result;
end $$;
revoke all on function private.experience_quote(uuid,integer) from public,anon,authenticated;

create function public.get_experience_booking_quote(p_session_id uuid,p_participants integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();contract jsonb;
begin
 contract:=private.experience_quote(p_session_id,p_participants);
 if contract->>'host_user_id'=actor then raise exception 'Hosts cannot book their own activity';end if;
 return jsonb_build_object('contract',contract,'contract_hash',encode(pg_catalog.sha256(convert_to(contract::text,'UTF8')),'hex'),
  'remaining',private.experience_session_remaining(p_session_id));
end $$;
revoke all on function public.get_experience_booking_quote(uuid,integer) from public,anon;
grant execute on function public.get_experience_booking_quote(uuid,integer) to authenticated;

create function public.hold_experience_booking(p_booking_id uuid,p_session_id uuid,p_participants integer,p_contract_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();s public.experience_sessions;a public.experience_activities;b public.experience_bookings;contract jsonb;
begin
 if p_booking_id is null or p_contract_hash is null or p_contract_hash!~'^[a-f0-9]{64}$' then raise exception 'Review the current booking terms before continuing';end if;
 -- Serialize a request UUID before checking replay, including cross-account use.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('experience-booking:'||p_booking_id::text,0));
 select * into b from public.experience_bookings where id=p_booking_id;
 if b.id is not null then
  if b.customer_user_id<>actor or b.session_id is distinct from p_session_id or b.participants is distinct from p_participants
   or encode(pg_catalog.sha256(convert_to(b.contract::text,'UTF8')),'hex')<>p_contract_hash then raise exception 'Booking reference belongs to different accepted terms' using errcode='42501';end if;
  return to_jsonb(b);
 end if;
 select activity_row.* into a from public.experience_activities activity_row join public.experience_sessions session_row on session_row.activity_id=activity_row.id where session_row.id=p_session_id for update of activity_row;
 select * into s from public.experience_sessions where id=p_session_id for update;
 contract:=private.experience_quote(p_session_id,p_participants);
 if a.host_user_id=actor then raise exception 'Hosts cannot book their own activity';end if;
 if encode(pg_catalog.sha256(convert_to(contract::text,'UTF8')),'hex')<>p_contract_hash then raise exception 'Price, schedule or policy changed. Review the updated booking terms';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('experience-customer:'||actor,0));
 if exists(select 1 from public.experience_bookings where customer_user_id=actor and session_id=s.id and status='pending_payment' and expires_at>now()) then raise exception 'Continue your existing checkout for this session';end if;
 if (select count(*) from public.experience_bookings where customer_user_id=actor and status='pending_payment' and expires_at>now())>=10 then raise exception 'Finish or cancel an existing checkout before holding more sessions';end if;
 if private.experience_session_remaining(s.id)<p_participants then raise exception 'Not enough places remain. Choose another date or participant count';end if;
 insert into public.experience_bookings(id,session_id,activity_id,customer_user_id,host_user_id,participants,expires_at,contract)
 values(p_booking_id,s.id,a.id,actor,a.host_user_id,p_participants,least(now()+interval '15 minutes',s.starts_at),contract) returning * into b;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details)
 values('EXPERIENCE_BOOKING_HELD','experience_booking',b.id::text,actor,jsonb_build_object('session_id',s.id,'participants',b.participants,'expires_at',b.expires_at)::text);
 return to_jsonb(b);
end $$;
revoke all on function public.hold_experience_booking(uuid,uuid,integer,text) from public,anon;
grant execute on function public.hold_experience_booking(uuid,uuid,integer,text) to authenticated;

create function public.get_my_experience_booking(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_customer_actor();b public.experience_bookings;
begin
 select * into b from public.experience_bookings where id=p_booking_id and (customer_user_id=actor or (host_user_id=actor and public.user_has_active_workspace(actor,'worker')));
 if b.id is null then raise exception 'Booking unavailable' using errcode='42501';end if;
 return to_jsonb(b);
end $$;
revoke all on function public.get_my_experience_booking(uuid) from public,anon;
grant execute on function public.get_my_experience_booking(uuid) to authenticated;
