-- Canonical Inbox, Activity and operational case routing.
-- Communication, awareness and operational work are separate records joined by
-- one typed subject identity.

create table if not exists public.canonical_threads(
  thread_id uuid primary key default gen_random_uuid(),
  thread_type text not null check(thread_type in (
    'direct','property_inquiry','long_let','short_let','hotel','worker_job','case'
  )),
  subject_type text not null,
  subject_id text not null,
  state text not null default 'open' check(state in ('open','read_only','closed')),
  continuation_of_thread_id uuid references public.canonical_threads(thread_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique(thread_type,subject_type,subject_id)
);

create table if not exists public.canonical_thread_participants(
  thread_id uuid not null references public.canonical_threads(thread_id) on delete restrict,
  user_id text not null references public.profiles(user_id) on delete restrict,
  participant_role text not null,
  can_message boolean not null default true,
  can_view_obligation boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  last_read_at timestamptz,
  primary key(thread_id,user_id)
);

create table if not exists public.canonical_thread_items(
  thread_item_id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.canonical_threads(thread_id) on delete restrict,
  item_type text not null check(item_type in (
    'message','property_share','system_event','payment_notice','case_action','attachment'
  )),
  sender_user_id text references public.profiles(user_id) on delete restrict,
  body text,
  payload jsonb not null default '{}'::jsonb,
  event_key text unique,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check(
    (item_type='message' and sender_user_id is not null and nullif(btrim(body),'') is not null)
    or item_type<>'message'
  )
);

create table if not exists public.activity_events(
  activity_event_id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  subject_type text not null,
  subject_id text not null,
  actor_user_id text,
  title text not null,
  summary text,
  route text not null,
  route_params jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_event_audiences(
  activity_event_id uuid not null
    references public.activity_events(activity_event_id) on delete restrict,
  recipient_user_id text not null references public.profiles(user_id) on delete restrict,
  workspace text not null,
  domain text,
  state_scope text,
  read_at timestamptz,
  resolved_at timestamptz,
  primary key(activity_event_id,recipient_user_id,workspace)
);

create table if not exists public.case_reason_registry(
  reason_code text primary key,
  label text not null,
  owning_domain text not null check(owning_domain in (
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
  )),
  allowed_subject_types text[] not null,
  requires_evidence boolean not null default false,
  customer_description text not null,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.operational_cases(
  operational_case_id uuid primary key default gen_random_uuid(),
  case_number bigint generated always as identity unique,
  reason_code text not null references public.case_reason_registry(reason_code),
  owning_domain text not null check(owning_domain in (
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
  )),
  subject_type text not null,
  subject_id text not null,
  requester_user_id text not null references public.profiles(user_id) on delete restrict,
  state_scope text,
  status text not null default 'open' check(status in (
    'open','triaged','assigned','investigating','waiting_customer',
    'waiting_partner','waiting_provider','decision_ready','resolved','closed'
  )),
  priority text not null default 'normal' check(priority in (
    'low','normal','high','urgent'
  )),
  assigned_user_id text references public.profiles(user_id),
  service_level_due_at timestamptz,
  resolution_code text,
  resolution_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz
);

create unique index if not exists operational_case_one_open_reason_subject_requester
  on public.operational_cases(reason_code,subject_type,subject_id,requester_user_id)
  where status not in ('resolved','closed');

create table if not exists public.operational_case_events(
  case_event_id uuid primary key default gen_random_uuid(),
  operational_case_id uuid not null
    references public.operational_cases(operational_case_id) on delete restrict,
  event_key text not null unique,
  event_type text not null,
  from_status text,
  to_status text,
  actor_user_id text,
  public_note text,
  internal_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.operational_case_evidence(
  case_evidence_id uuid primary key default gen_random_uuid(),
  operational_case_id uuid not null
    references public.operational_cases(operational_case_id) on delete restrict,
  object_path text not null,
  evidence_class text not null check(evidence_class in (
    'customer','partner','worker','property','financial','security_private'
  )),
  submitted_by text not null references public.profiles(user_id) on delete restrict,
  visibility_domains text[] not null,
  description text,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.canonical_threads enable row level security;
alter table public.canonical_thread_participants enable row level security;
alter table public.canonical_thread_items enable row level security;
alter table public.activity_events enable row level security;
alter table public.activity_event_audiences enable row level security;
alter table public.case_reason_registry enable row level security;
alter table public.operational_cases enable row level security;
alter table public.operational_case_events enable row level security;
alter table public.operational_case_evidence enable row level security;

create policy canonical_thread_participant_read
on public.canonical_threads for select to authenticated
using(exists(
  select 1 from public.canonical_thread_participants p
  where p.thread_id=canonical_threads.thread_id
    and p.user_id=public.current_profile_user_id()
    and p.left_at is null
));
create policy canonical_thread_participants_self_read
on public.canonical_thread_participants for select to authenticated
using(exists(
  select 1 from public.canonical_thread_participants mine
  where mine.thread_id=canonical_thread_participants.thread_id
    and mine.user_id=public.current_profile_user_id()
    and mine.left_at is null
));
create policy canonical_thread_items_participant_read
on public.canonical_thread_items for select to authenticated
using(exists(
  select 1 from public.canonical_thread_participants p
  where p.thread_id=canonical_thread_items.thread_id
    and p.user_id=public.current_profile_user_id()
    and p.left_at is null and p.can_view_obligation
));
create policy activity_event_recipient_read
on public.activity_events for select to authenticated
using(exists(
  select 1 from public.activity_event_audiences a
  where a.activity_event_id=activity_events.activity_event_id
    and a.recipient_user_id=public.current_profile_user_id()
));
create policy activity_audience_self_read
on public.activity_event_audiences for select to authenticated
using(recipient_user_id=public.current_profile_user_id());
create policy active_case_reasons_read
on public.case_reason_registry for select to authenticated
using(active=true);
create policy operational_case_requester_read
on public.operational_cases for select to authenticated
using(requester_user_id=public.current_profile_user_id());
create policy operational_case_events_requester_read
on public.operational_case_events for select to authenticated
using(exists(
  select 1 from public.operational_cases c
  where c.operational_case_id=operational_case_events.operational_case_id
    and c.requester_user_id=public.current_profile_user_id()
));
create policy operational_case_evidence_submitter_read
on public.operational_case_evidence for select to authenticated
using(submitted_by=public.current_profile_user_id());

revoke all on table public.canonical_threads from public,anon,authenticated;
revoke all on table public.canonical_thread_participants from public,anon,authenticated;
revoke all on table public.canonical_thread_items from public,anon,authenticated;
revoke all on table public.activity_events from public,anon,authenticated;
revoke all on table public.activity_event_audiences from public,anon,authenticated;
revoke all on table public.case_reason_registry from public,anon,authenticated;
revoke all on table public.operational_cases from public,anon,authenticated;
revoke all on table public.operational_case_events from public,anon,authenticated;
revoke all on table public.operational_case_evidence from public,anon,authenticated;
grant select on table public.canonical_threads to authenticated;
grant select on table public.canonical_thread_participants to authenticated;
grant select on table public.canonical_thread_items to authenticated;
grant select on table public.activity_events to authenticated;
grant select on table public.activity_event_audiences to authenticated;
grant update(read_at) on table public.activity_event_audiences to authenticated;
grant select on table public.case_reason_registry to authenticated;
grant select on table public.operational_cases to authenticated;
grant select on table public.operational_case_events to authenticated;
grant select on table public.operational_case_evidence to authenticated;
grant all on table public.canonical_threads to service_role;
grant all on table public.canonical_thread_participants to service_role;
grant all on table public.canonical_thread_items to service_role;
grant all on table public.activity_events to service_role;
grant all on table public.activity_event_audiences to service_role;
grant all on table public.case_reason_registry to service_role;
grant all on table public.operational_cases to service_role;
grant all on table public.operational_case_events to service_role;
grant all on table public.operational_case_evidence to service_role;

insert into public.case_reason_registry(
  reason_code,label,owning_domain,allowed_subject_types,requires_evidence,
  customer_description
) values
('account_access','Account access','support',array['account'],false,'Help with login, account access or using WeHouse.'),
('app_help','Using WeHouse','support',array['account','page'],false,'Help understanding a WeHouse feature.'),
('listing_misdescription','Property not as listed','property_operations',array['listing','long_let','short_let','hotel'],true,'Review property or stay facts.'),
('availability_failure','Property unavailable','property_operations',array['listing','long_let','short_let','hotel'],false,'Review availability or handover readiness.'),
('inspection_issue','Inspection issue','property_operations',array['long_let','inspection'],true,'Review an inspection or handover fact.'),
('field_visit','On-site visit','field_operations',array['listing','inspection','long_let','short_let','hotel'],true,'Arrange or review on-site evidence.'),
('worker_verification','Worker verification','worker_operations',array['worker'],true,'Review professional verification.'),
('worker_job_issue','Get help with this job','worker_operations',array['worker_job'],false,'Review job scope or completion.'),
('payment_issue','Payment issue','finance_operations',array['long_let','short_let','hotel','worker_job','shared_payment'],false,'Review a payment, refund, release or payout.'),
('caution_claim','Caution claim','finance_operations',array['short_let'],true,'Review the financial outcome after property facts.'),
('payout_issue','Payout issue','finance_operations',array['payout'],false,'Review settlement to a payout account.'),
('safety_threat','Safety concern','security_operations',array['account','conversation','long_let','short_let','hotel','worker_job'],true,'Review a safety or abuse concern.'),
('blocked_active_obligation','Blocked participant with an active obligation','security_operations',array['long_let','short_let','worker_job','shared_payment'],false,'Preserve and review an active obligation after communication is blocked.'),
('account_compromise','Account security','security_operations',array['account'],false,'Review suspected unauthorized access.')
on conflict(reason_code) do update set
  label=excluded.label,owning_domain=excluded.owning_domain,
  allowed_subject_types=excluded.allowed_subject_types,
  requires_evidence=excluded.requires_evidence,
  customer_description=excluded.customer_description,active=true;

create or replace function public.actor_can_open_case_for_subject(
  p_user_id text,p_subject_type text,p_subject_id text
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select
    (p_subject_type='account' and p_subject_id=p_user_id)
    or (p_subject_type in ('listing','page'))
    or (p_subject_type in ('long_let','short_let') and exists(
      select 1 from public.reservations r
      where r.id=p_subject_id and r.user_id=p_user_id
    ))
    or (p_subject_type='hotel' and exists(
      select 1 from public.hotel_bookings h
      where h.booking_id::text=p_subject_id and h.user_id=p_user_id
    ))
    or (p_subject_type='worker_job' and exists(
      select 1 from public.worker_bookings w
      where w.id::text=p_subject_id and p_user_id in (w.user_id,w.worker_id)
    ))
    or (p_subject_type='shared_payment' and exists(
      select 1 from public.shared_payment_groups g
      left join public.shared_payment_members m
        on m.shared_payment_group_id=g.shared_payment_group_id
      where g.shared_payment_group_id::text=p_subject_id
        and p_user_id in (g.created_by,m.user_id)
    ))
$$;

create or replace function public.open_contextual_case(
  p_reason_code text,p_subject_type text,p_subject_id text,
  p_summary text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user text:=public.current_profile_user_id();
  v_reason public.case_reason_registry;
  v_case public.operational_cases;
  v_state text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_reason from public.case_reason_registry
  where reason_code=p_reason_code and active;
  if v_reason.reason_code is null or not (p_subject_type=any(v_reason.allowed_subject_types))
    then raise exception 'Case reason does not apply to this subject'; end if;
  if not public.actor_can_open_case_for_subject(v_user,p_subject_type,p_subject_id)
    then raise exception 'Subject access required'; end if;

  select coalesce(l.state,h.state,p.state) into v_state
  from (select null::text state) z
  left join public.reservations r
    on p_subject_type in ('long_let','short_let') and r.id=p_subject_id
  left join public.listings l
    on l.listing_id=r.listing_id or l.id::text=r.listing_id
  left join public.hotel_bookings hb
    on p_subject_type='hotel' and hb.booking_id::text=p_subject_id
  left join public.hotels h on h.hotel_id=hb.hotel_id
  left join public.profiles p on p.user_id=v_user
  limit 1;

  insert into public.operational_cases(
    reason_code,owning_domain,subject_type,subject_id,requester_user_id,
    state_scope,status,priority,service_level_due_at
  ) values(
    v_reason.reason_code,v_reason.owning_domain,p_subject_type,p_subject_id,
    v_user,v_state,'open',
    case when v_reason.owning_domain='security_operations' then 'urgent' else 'normal' end,
    now()+case when v_reason.owning_domain='security_operations'
      then interval '1 hour' else interval '24 hours' end
  ) on conflict(
    reason_code,subject_type,subject_id,requester_user_id
  ) where status not in ('resolved','closed')
  do update set updated_at=now()
  returning * into v_case;

  insert into public.operational_case_events(
    operational_case_id,event_key,event_type,to_status,actor_user_id,public_note
  ) values(
    v_case.operational_case_id,'case_opened:'||v_case.operational_case_id,
    'case_opened','open',v_user,nullif(btrim(p_summary),'')
  ) on conflict(event_key) do nothing;
  return v_case.operational_case_id;
end
$$;

create or replace function public.send_canonical_thread_message(
  p_thread_id uuid,p_body text,p_client_message_id text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user text:=public.current_profile_user_id();
  v_thread public.canonical_threads;
  v_id uuid;
begin
  select * into v_thread from public.canonical_threads
  where thread_id=p_thread_id and state='open';
  if not exists(
    select 1 from public.canonical_thread_participants p
    where p.thread_id=p_thread_id and p.user_id=v_user
      and p.left_at is null and p.can_message
  ) then raise exception 'Messaging is not available in this thread'; end if;
  if exists(
    select 1
    from public.canonical_thread_participants mine
    join public.canonical_thread_participants peer
      on peer.thread_id=mine.thread_id and peer.user_id<>mine.user_id
    where mine.thread_id=p_thread_id and mine.user_id=v_user
      and (
        exists(select 1 from public.roommate_user_blocks b
          where (b.blocker_user_id=mine.user_id and b.blocked_user_id=peer.user_id)
             or (b.blocker_user_id=peer.user_id and b.blocked_user_id=mine.user_id))
        or exists(select 1 from public.worker_user_blocks b
          where (b.blocker_user_id=mine.user_id and b.blocked_user_id=peer.user_id)
             or (b.blocker_user_id=peer.user_id and b.blocked_user_id=mine.user_id))
      )
  ) then raise exception 'Communication is blocked'; end if;
  insert into public.canonical_thread_items(
    thread_id,item_type,sender_user_id,body,event_key
  ) values(
    p_thread_id,'message',v_user,btrim(p_body),
    'client_message:'||v_user||':'||p_client_message_id
  ) on conflict(event_key) do update set event_key=excluded.event_key
  returning thread_item_id into v_id;
  return v_id;
end
$$;

create or replace function public.active_obligation_visibility(
  p_actor_user_id text,p_other_user_id text
)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select jsonb_build_object(
    'worker_jobs',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',w.id,'status',coalesce(w.canonical_job_state,w.status),
        'payment_protection_id',w.payment_protection_id
      ))
      from public.worker_bookings w
      where p_actor_user_id in (w.user_id,w.worker_id)
        and p_other_user_id in (w.user_id,w.worker_id)
        and coalesce(w.canonical_job_state,w.status) not in (
          'completed','approved_released','cancelled','refunded'
        )
    ),'[]'::jsonb),
    'shared_payments',coalesce((
      select jsonb_agg(distinct jsonb_build_object(
        'id',g.shared_payment_group_id,'status',g.status,
        'reservation_id',g.reservation_id
      ))
      from public.shared_payment_groups g
      join public.shared_payment_members a
        on a.shared_payment_group_id=g.shared_payment_group_id
      join public.shared_payment_members b
        on b.shared_payment_group_id=g.shared_payment_group_id
      where a.user_id=p_actor_user_id and b.user_id=p_other_user_id
        and g.status not in ('expired','cancelled','refunded')
    ),'[]'::jsonb)
  )
$$;

create or replace function public.unblock_my_contact(
  p_context text,p_other_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_still_blocked boolean;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_context='worker' then
    delete from public.worker_user_blocks
    where blocker_user_id=v_actor and blocked_user_id=p_other_user_id;
  elsif p_context='roommate' then
    delete from public.roommate_user_blocks
    where blocker_user_id=v_actor and blocked_user_id=p_other_user_id;
  else
    raise exception 'Context must be worker or roommate';
  end if;

  select exists(
    select 1 from public.worker_user_blocks b
    where (b.blocker_user_id=v_actor and b.blocked_user_id=p_other_user_id)
       or (b.blocker_user_id=p_other_user_id and b.blocked_user_id=v_actor)
    union all
    select 1 from public.roommate_user_blocks b
    where (b.blocker_user_id=v_actor and b.blocked_user_id=p_other_user_id)
       or (b.blocker_user_id=p_other_user_id and b.blocked_user_id=v_actor)
  ) into v_still_blocked;

  if not v_still_blocked then
    update public.canonical_thread_participants participant
    set can_message=true
    where participant.user_id in (v_actor,p_other_user_id)
      and exists(
        select 1 from public.canonical_thread_participants mine
        join public.canonical_thread_participants peer on peer.thread_id=mine.thread_id
        where mine.thread_id=participant.thread_id and mine.user_id=v_actor
          and peer.user_id=p_other_user_id
      );
  end if;
  return jsonb_build_object(
    'unblocked',true,
    'communication_restored',not v_still_blocked,
    'active_obligations',public.active_obligation_visibility(v_actor,p_other_user_id)
  );
end
$$;

revoke all on function public.open_contextual_case(text,text,text,text)
from public,anon;
grant execute on function public.open_contextual_case(text,text,text,text)
to authenticated,service_role;
revoke all on function public.send_canonical_thread_message(uuid,text,text)
from public,anon;
grant execute on function public.send_canonical_thread_message(uuid,text,text)
to authenticated,service_role;
revoke all on function public.active_obligation_visibility(text,text)
from public,anon;
grant execute on function public.active_obligation_visibility(text,text)
to authenticated,service_role;
revoke all on function public.unblock_my_contact(text,text) from public,anon;
grant execute on function public.unblock_my_contact(text,text)
to authenticated,service_role;

-- User-facing names remain stable while old permission codes migrate.
update public.staff_permissions
set permission='worker_operations'
where permission in ('worker_verification','worker_review');
update public.staff_permissions
set permission='field_operations'
where permission in ('field_officer','field_operation','filed_officer','filed_operation');

insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,scope_state,status,granted_by,
  granted_at,created_at,updated_at
)
select sp.staff_id,
  case sp.permission
    when 'operations' then 'property_operations'
    when 'field_operations' then 'field_operations'
    when 'worker_operations' then 'worker_operations'
    when 'finance' then 'finance_operations'
    when 'security' then 'security_operations'
    when 'support' then 'support'
  end,
  'state',coalesce(nullif(btrim(p.assigned_state),''),nullif(btrim(p.state),'')),
  'active',sp.granted_by,coalesce(sp.granted_at,now()),now(),now()
from public.staff_permissions sp
join public.profiles p on p.user_id=sp.staff_id
where sp.is_active and sp.revoked_at is null
  and sp.permission in (
    'operations','field_operations','worker_operations','finance','security','support'
  )
on conflict(user_id,workspace_role) where status='active' do update
set scope_state=excluded.scope_state,updated_at=now();

comment on table public.canonical_thread_items
is 'Typed Inbox items. A property_share is a live property object, never a payment proposal.';
comment on table public.activity_events
is 'Durable awareness events. Notifications are delivery copies, not source of truth.';
comment on table public.operational_cases
is 'Typed operational work; Support owns only account/app/how-to reasons.';
