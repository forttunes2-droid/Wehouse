-- Account Help is a nested Account capability across Personal, Service Provider,
-- and Property Partner workspaces. Routing is selected by reason + linked object,
-- never inferred from free-form message text.
--
-- Accommodation arrival issues use an immutable booking snapshot. New Short Let
-- and Hotel stays use a 30-60 minute policy; existing booked snapshots retain
-- their original duration.

alter table public.reservations
  add column if not exists arrival_issue_window_minutes integer;
alter table public.hotel_bookings
  add column if not exists arrival_issue_window_minutes integer;
alter table public.listings
  add column if not exists arrival_issue_window_minutes integer;
alter table public.hotels
  add column if not exists arrival_issue_window_minutes integer;
alter table public.hotel_rate_plans
  add column if not exists arrival_issue_window_minutes integer;

-- Existing booked obligations retain the duration already promised to them.
update public.reservations
set arrival_issue_window_minutes=arrival_issue_window_hours*60
where arrival_issue_window_minutes is null
  and arrival_issue_window_hours is not null;

update public.hotel_bookings
set arrival_issue_window_minutes=arrival_issue_window_hours*60
where arrival_issue_window_minutes is null
  and arrival_issue_window_hours is not null;

-- New property/package configuration is capped to the new launch rule.
update public.listings
set arrival_issue_window_minutes=60
where arrival_issue_window_minutes is null
  and arrival_issue_window_hours is not null;
update public.hotels
set arrival_issue_window_minutes=60
where arrival_issue_window_minutes is null
  and arrival_issue_window_hours is not null;
update public.hotel_rate_plans
set arrival_issue_window_minutes=60
where arrival_issue_window_minutes is null
  and arrival_issue_window_hours is not null;

alter table public.listings drop constraint if exists listings_arrival_issue_window_minutes_check;
alter table public.listings add constraint listings_arrival_issue_window_minutes_check
  check(arrival_issue_window_minutes is null or arrival_issue_window_minutes between 30 and 60);
alter table public.hotels drop constraint if exists hotels_arrival_issue_window_minutes_check;
alter table public.hotels add constraint hotels_arrival_issue_window_minutes_check
  check(arrival_issue_window_minutes is null or arrival_issue_window_minutes between 30 and 60);
alter table public.hotel_rate_plans drop constraint if exists hotel_rate_plans_arrival_issue_window_minutes_check;
alter table public.hotel_rate_plans add constraint hotel_rate_plans_arrival_issue_window_minutes_check
  check(arrival_issue_window_minutes is null or arrival_issue_window_minutes between 30 and 60);

-- Publish a new version without rewriting prior booking snapshots.
do $$
declare
  v_previous uuid;
  v_previous_version integer;
begin
  if exists(
    select 1 from public.creator_policy_versions
    where policy_key='accommodation_arrival_issue_window'
      and scope_type='global' and scope_key='*' and status='active'
      and value ? 'default_minutes'
  ) then
    return;
  end if;

  select policy_version_id,version into v_previous,v_previous_version
  from public.creator_policy_versions
  where policy_key='accommodation_arrival_issue_window'
    and scope_type='global' and scope_key='*' and status='active'
  order by effective_from desc,version desc
  limit 1;

  if v_previous is not null then
    update public.creator_policy_versions
    set status='retired',effective_until=now(),retired_at=now()
    where policy_version_id=v_previous;
  end if;

  insert into public.creator_policy_versions(
    policy_key,scope_type,scope_key,version,value,value_schema,status,
    effective_from,effective_until,public_disclosure,disclosure_text,
    legal_review_state,reason,created_by,approved_by,supersedes,checksum,
    published_at
  ) values(
    'accommodation_arrival_issue_window','global','*',coalesce(v_previous_version,0)+1,
    jsonb_build_object('default_minutes',60,'minimum_minutes',30,'maximum_minutes',60),
    jsonb_build_object('type','bounded_duration_policy','unit','minutes'),
    'active',now(),null,true,
    'After authorized Short Let or Hotel check-in, accommodation Payment Protection remains held for the booked arrival-issue window. New bookings use 30 to 60 minutes.',
    'pending','Short Let and Hotel arrival-issue window reduced to the locked 30-60 minute launch rule.',
    null,null,v_previous,md5('accommodation_arrival_issue_window:minutes:30:60:v2'),now()
  );
end
$$;

create or replace function public.current_accommodation_arrival_policy_minutes()
returns table(
  policy_version_id uuid,
  default_minutes integer,
  minimum_minutes integer,
  maximum_minutes integer
)
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select policy.policy_version_id,
    coalesce((policy.value->>'default_minutes')::integer,(policy.value->>'default_hours')::integer*60),
    coalesce((policy.value->>'minimum_minutes')::integer,(policy.value->>'minimum_hours')::integer*60),
    coalesce((policy.value->>'maximum_minutes')::integer,(policy.value->>'maximum_hours')::integer*60)
  from public.creator_policy_versions policy
  where policy.policy_key='accommodation_arrival_issue_window'
    and policy.scope_type='global' and policy.scope_key='*'
    and policy.status='active' and policy.effective_from<=now()
    and (policy.effective_until is null or policy.effective_until>now())
  order by policy.effective_from desc,policy.version desc
  limit 1
$$;

-- Compatibility for old readers. New authority uses minutes.
create or replace function public.current_accommodation_arrival_policy()
returns table(policy_version_id uuid,default_hours integer,minimum_hours integer,maximum_hours integer)
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select policy_version_id,
    greatest(1,ceil(default_minutes/60.0)::integer),
    greatest(1,ceil(minimum_minutes/60.0)::integer),
    greatest(1,ceil(maximum_minutes/60.0)::integer)
  from public.current_accommodation_arrival_policy_minutes()
$$;

create or replace function public.snapshot_short_stay_arrival_policy()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_policy record;
  v_minutes integer;
begin
  if new.stay_type is distinct from 'short_let' then return new; end if;
  if tg_op='UPDATE'
     and old.arrival_issue_policy_version_id is not null
     and new.arrival_issue_policy_version_id is distinct from old.arrival_issue_policy_version_id then
    raise exception 'A booked arrival policy snapshot is immutable';
  end if;
  if new.arrival_issue_policy_version_id is not null then
    if new.arrival_issue_window_minutes is null and new.arrival_issue_window_hours is not null then
      new.arrival_issue_window_minutes:=new.arrival_issue_window_hours*60;
    end if;
    return new;
  end if;
  select * into v_policy from public.current_accommodation_arrival_policy_minutes();
  if v_policy.policy_version_id is null then
    raise exception 'Active accommodation arrival-issue policy required';
  end if;
  select listing.arrival_issue_window_minutes into v_minutes
  from public.listings listing
  where listing.listing_id=new.listing_id or listing.id::text=new.listing_id
  limit 1;
  v_minutes:=coalesce(v_minutes,v_policy.default_minutes);
  if v_minutes<v_policy.minimum_minutes or v_minutes>v_policy.maximum_minutes then
    raise exception 'Short Let arrival-issue window must be between % and % minutes',
      v_policy.minimum_minutes,v_policy.maximum_minutes;
  end if;
  new.arrival_issue_policy_version_id:=v_policy.policy_version_id;
  new.arrival_issue_window_minutes:=v_minutes;
  new.arrival_issue_window_hours:=greatest(1,ceil(v_minutes/60.0)::integer);
  return new;
end
$$;

create or replace function public.snapshot_hotel_arrival_policy()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_policy record;
  v_minutes integer;
begin
  if tg_op='UPDATE'
     and old.arrival_issue_policy_version_id is not null
     and new.arrival_issue_policy_version_id is distinct from old.arrival_issue_policy_version_id then
    raise exception 'A booked arrival policy snapshot is immutable';
  end if;
  if new.arrival_issue_policy_version_id is not null then
    if new.arrival_issue_window_minutes is null and new.arrival_issue_window_hours is not null then
      new.arrival_issue_window_minutes:=new.arrival_issue_window_hours*60;
    end if;
    return new;
  end if;
  select * into v_policy from public.current_accommodation_arrival_policy_minutes();
  if v_policy.policy_version_id is null then
    raise exception 'Active accommodation arrival-issue policy required';
  end if;
  select coalesce(plan.arrival_issue_window_minutes,hotel.arrival_issue_window_minutes)
  into v_minutes
  from public.hotels hotel
  left join public.hotel_rate_plans plan on plan.rate_plan_id=new.rate_plan_id
    and plan.hotel_id=hotel.hotel_id
  where hotel.hotel_id=new.hotel_id;
  v_minutes:=coalesce(v_minutes,v_policy.default_minutes);
  if v_minutes<v_policy.minimum_minutes or v_minutes>v_policy.maximum_minutes then
    raise exception 'Hotel arrival-issue window must be between % and % minutes',
      v_policy.minimum_minutes,v_policy.maximum_minutes;
  end if;
  new.arrival_issue_policy_version_id:=v_policy.policy_version_id;
  new.arrival_issue_window_minutes:=v_minutes;
  new.arrival_issue_window_hours:=greatest(1,ceil(v_minutes/60.0)::integer);
  return new;
end
$$;

create or replace function public.set_short_stay_arrival_deadline()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_minutes integer;
  v_min integer;
  v_max integer;
begin
  if new.stay_type='short_let' and new.checked_in_at is not null
     and (old.checked_in_at is null or new.checked_in_at is distinct from old.checked_in_at) then
    select
      coalesce((policy.value->>'minimum_minutes')::integer,(policy.value->>'minimum_hours')::integer*60),
      coalesce((policy.value->>'maximum_minutes')::integer,(policy.value->>'maximum_hours')::integer*60)
    into v_min,v_max
    from public.creator_policy_versions policy
    where policy.policy_version_id=new.arrival_issue_policy_version_id;
    v_minutes:=coalesce(new.arrival_issue_window_minutes,new.arrival_issue_window_hours*60);
    if new.arrival_issue_policy_version_id is null or v_minutes is null
       or v_min is null or v_max is null or v_minutes<v_min or v_minutes>v_max then
      raise exception 'Short Let arrival policy snapshot required before check-in';
    end if;
    new.arrival_issue_window_minutes:=v_minutes;
    new.arrival_issue_deadline_at:=new.checked_in_at+make_interval(mins=>v_minutes);
  end if;
  return new;
end
$$;

create or replace function public.set_hotel_arrival_deadline()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_minutes integer;
  v_min integer;
  v_max integer;
begin
  if new.checked_in_at is not null
     and (old.checked_in_at is null or new.checked_in_at is distinct from old.checked_in_at) then
    select
      coalesce((policy.value->>'minimum_minutes')::integer,(policy.value->>'minimum_hours')::integer*60),
      coalesce((policy.value->>'maximum_minutes')::integer,(policy.value->>'maximum_hours')::integer*60)
    into v_min,v_max
    from public.creator_policy_versions policy
    where policy.policy_version_id=new.arrival_issue_policy_version_id;
    v_minutes:=coalesce(new.arrival_issue_window_minutes,new.arrival_issue_window_hours*60);
    if new.arrival_issue_policy_version_id is null or v_minutes is null
       or v_min is null or v_max is null or v_minutes<v_min or v_minutes>v_max then
      raise exception 'Hotel arrival policy snapshot required before check-in';
    end if;
    new.arrival_issue_window_minutes:=v_minutes;
    new.arrival_issue_deadline_at:=new.checked_in_at+make_interval(mins=>v_minutes);
  end if;
  return new;
end
$$;

revoke all on function public.current_accommodation_arrival_policy_minutes() from public,anon;
grant execute on function public.current_accommodation_arrival_policy_minutes() to authenticated,service_role;

-- One read model powers Account > Help for every workspace on the same identity.
create or replace function public.get_my_account_help_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  return jsonb_build_object(
    'account',jsonb_build_object('subject_type','account','subject_id',v_actor,'label','My WeHouse account'),
    'worker_jobs',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','worker_job','subject_id',x.id::text,
        'context_type','worker_booking','label',coalesce(x.service_type,'Service job'),
        'detail',replace(coalesce(x.status,'job'),'_',' '),'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select id,service_type,status,updated_at from public.worker_bookings
        where user_id=v_actor or worker_id=v_actor
        order by updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'withdrawals',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','payout','subject_id',x.id::text,'context_type','contextual_help',
        'label','Withdrawal · ₦'||trim(to_char(x.amount,'FM999G999G999G990D00')),
        'detail',replace(coalesce(x.status,'withdrawal'),'_',' '),'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select wd.id,wd.amount,wd.status,wd.updated_at
        from public.withdrawals wd
        join public.wallets w on w.id=wd.wallet_id
        where w.owner_id=v_actor
        order by wd.updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'reservations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type',case when x.stay_type='short_let' then 'short_let' else 'long_let' end,
        'subject_id',x.id,'context_type','apartment_reservation',
        'label',coalesce(x.listing_title,case when x.stay_type='short_let' then 'Short Let' else 'Long Let' end),
        'detail',replace(coalesce(x.status,'reservation'),'_',' '),'stay_type',x.stay_type,'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select id,listing_title,stay_type,status,updated_at from public.reservations
        where user_id=v_actor order by updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'hotel_bookings',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','hotel','subject_id',x.booking_id::text,'context_type','hotel_booking',
        'label',coalesce(x.hotel_name,'Hotel stay'),'detail',replace(coalesce(x.status,'booking'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select hb.booking_id,hb.status,hb.updated_at,h.name hotel_name
        from public.hotel_bookings hb
        join public.hotels h on h.hotel_id=hb.hotel_id
        where hb.user_id=v_actor order by hb.updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'properties',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','listing','subject_id',x.listing_id,'context_type','property_listing',
        'label',coalesce(x.title,'Apartment'),'detail',replace(coalesce(x.status,'property'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select l.listing_id,l.title,l.status,l.updated_at from public.listings l
        where coalesce(l.partner_id,l.owner_id)=v_actor
        order by l.updated_at desc limit 50
      ) x
    ),'[]'::jsonb),
    'hotels',coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_type','hotel','subject_id',x.hotel_id::text,'context_type','hotel_property',
        'label',coalesce(x.name,'Hotel'),'detail',replace(coalesce(x.status,'hotel'),'_',' '),
        'updated_at',x.updated_at
      ) order by x.updated_at desc)
      from (
        select h.hotel_id,h.name,h.status,h.updated_at from public.hotels h
        where h.owner_id=v_actor order by h.updated_at desc limit 50
      ) x
    ),'[]'::jsonb)
  );
end
$$;

revoke all on function public.get_my_account_help_targets() from public,anon;
grant execute on function public.get_my_account_help_targets() to authenticated,service_role;

-- First Send for a reason-routed Account Help request. This keeps the same atomic
-- draft/evidence guarantee as Message WeHouse while letting the reason registry
-- choose Support, Finance, Security, Worker Operations, etc.
create or replace function public.send_my_first_contextual_help_message(
  p_draft_id uuid,
  p_reason_code text,
  p_subject_type text,
  p_subject_id text,
  p_summary text default null,
  p_snapshot jsonb default '{}'::jsonb,
  p_content text default '',
  p_attachments text[] default '{}'::text[],
  p_attachment_types text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','storage'
as $$
declare
  v_actor public.profiles;
  v_draft public.support_message_drafts;
  v_opened jsonb;
  v_conversation_id uuid;
  v_message_id uuid;
  v_snapshot jsonb;
  v_prefix text;
  v_path text;
  v_type text;
  v_index integer;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active WeHouse account required'; end if;

  select * into v_draft from public.support_message_drafts
  where draft_id=p_draft_id for update;
  if v_draft.draft_id is null or v_draft.requester_id<>v_actor.user_id then
    raise exception 'Message draft was not found';
  end if;
  if v_draft.consumed_at is not null then
    return jsonb_build_object('conversation_id',v_draft.conversation_id,'message_id',v_draft.message_id,'replayed',true);
  end if;
  if v_draft.expires_at<=now() then raise exception 'Message draft expired'; end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null and coalesce(cardinality(p_attachments),0)=0 then
    raise exception 'Message or attachment is required';
  end if;
  if nullif(btrim(coalesce(p_reason_code,'')),'') is null
     or nullif(btrim(coalesce(p_subject_type,'')),'') is null
     or nullif(btrim(coalesce(p_subject_id,'')),'') is null then
    raise exception 'Help reason and linked record are required';
  end if;
  if coalesce(cardinality(p_attachments),0)<>coalesce(cardinality(p_attachment_types),0) then
    raise exception 'Attachment metadata mismatch';
  end if;
  if coalesce(cardinality(p_attachments),0)>6 then raise exception 'A maximum of 6 evidence files can be sent at once'; end if;

  v_prefix:='drafts/'||v_actor.user_id||'/'||p_draft_id::text||'/';
  if coalesce(cardinality(p_attachments),0)>0 then
    for v_index in 1..cardinality(p_attachments) loop
      v_path:=p_attachments[v_index];
      v_type:=lower(coalesce(p_attachment_types[v_index],''));
      if v_path is null or left(v_path,length(v_prefix))<>v_prefix then
        raise exception 'Evidence path does not belong to this draft';
      end if;
      if v_type not in(
        'image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime',
        'application/pdf','text/plain','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) then raise exception 'Unsupported evidence file type'; end if;
      if not exists(select 1 from storage.objects o where o.bucket_id='support-files' and o.name=v_path) then
        raise exception 'Evidence upload is incomplete';
      end if;
    end loop;
  end if;

  v_snapshot:=coalesce(p_snapshot,'{}'::jsonb)
    -'booking_code'-'check_in_code'-'access_code'-'verification_code'-'handover_code'-'recovery_code';
  v_opened:=public.open_contextual_case_conversation(
    lower(btrim(p_reason_code)),lower(btrim(p_subject_type)),btrim(p_subject_id),
    nullif(btrim(coalesce(p_summary,'')),''),v_snapshot
  );
  v_conversation_id:=(v_opened->>'conversation_id')::uuid;
  if v_conversation_id is null then raise exception 'WeHouse request could not be created'; end if;

  v_message_id:=public.send_support_message(
    v_conversation_id,btrim(coalesce(p_content,'')),coalesce(p_attachments,'{}'::text[]),
    coalesce(p_attachment_types,'{}'::text[]),'message',
    jsonb_build_object('reason_code',lower(btrim(p_reason_code)),'subject_type',lower(btrim(p_subject_type)),
      'subject_id',btrim(p_subject_id),'context_snapshot',v_snapshot),'customer'
  );

  update public.support_message_drafts
  set conversation_id=v_conversation_id,message_id=v_message_id,consumed_at=now()
  where draft_id=p_draft_id;

  return jsonb_build_object('conversation_id',v_conversation_id,'message_id',v_message_id,'replayed',false,
    'operational_case_id',v_opened->>'operational_case_id','owning_domain',v_opened->>'owning_domain');
end
$$;

revoke all on function public.send_my_first_contextual_help_message(uuid,text,text,text,text,jsonb,text,text[],text[]) from public,anon;
grant execute on function public.send_my_first_contextual_help_message(uuid,text,text,text,text,jsonb,text,text[],text[]) to authenticated,service_role;
