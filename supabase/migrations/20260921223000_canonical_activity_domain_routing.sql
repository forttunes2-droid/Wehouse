-- Make canonical Activity the authoritative read model.
-- Legacy notifications remain a compatibility/delivery layer while domain
-- transitions increasingly emit directly into activity_events + audiences.

alter table public.activity_event_audiences
  add column if not exists action_required boolean not null default false;

create index if not exists activity_audience_feed_idx
  on public.activity_event_audiences(
    recipient_user_id, workspace, action_required, resolved_at, read_at
  );

create or replace function private.activity_workspace_matches(
  p_requested text,
  p_actual text
)
returns boolean
language sql
immutable
set search_path to 'pg_catalog','public','private'
as $$
  select case
    when p_requested='personal' then p_actual in ('personal','account')
    when p_requested='partner' then p_actual in ('partner','property_partner')
    when p_requested='property_partner' then p_actual in ('partner','property_partner')
    when p_requested='hotel' then p_actual in ('hotel','hotel_staff')
    when p_requested='staff' then p_actual in (
      'staff','property_operations','field_operations','worker_operations',
      'finance_operations','security_operations','support'
    )
    when p_requested in (
      'property_operations','field_operations','worker_operations',
      'finance_operations','security_operations','support'
    ) then p_actual in (p_requested,'staff')
    else p_actual=p_requested
  end
$$;

create or replace function private.activity_type_requires_action(
  p_type text,
  p_title text default null,
  p_summary text default null
)
returns boolean
language sql
immutable
set search_path to 'pg_catalog','public','private'
as $$
  select (
    lower(coalesce(p_type,'')) ~
      '(action_required|payment_conflict|dispute|changes_requested|escalat|verification_required|refund_due|failed|service_price_ready|service_completion_review_required|service_request_received|work_post_confirmation_requested|roommate_interest|property_move_in_requested|waiting_payment|payment_required|approval_required|inspection_requested|review_required)'
    or lower(concat_ws(' ',p_title,p_summary)) ~
      '(needs (your|my) action|needs review|review required|waiting for (your|my) (approval|payment|response)|requires (your|my) (approval|payment|response))'
  )
$$;

create or replace function private.upsert_activity_event(
  p_event_key text,
  p_event_type text,
  p_subject_type text,
  p_subject_id text,
  p_actor_user_id text,
  p_title text,
  p_summary text,
  p_route text,
  p_route_params jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare v_id uuid;
begin
  if nullif(btrim(coalesce(p_event_key,'')),'') is null then
    raise exception 'Activity event key is required';
  end if;
  insert into public.activity_events(
    event_key,event_type,subject_type,subject_id,actor_user_id,
    title,summary,route,route_params,occurred_at,created_at
  ) values(
    p_event_key,p_event_type,p_subject_type,p_subject_id,p_actor_user_id,
    p_title,p_summary,p_route,coalesce(p_route_params,'{}'::jsonb),
    coalesce(p_occurred_at,now()),now()
  )
  on conflict(event_key) do update set
    event_type=excluded.event_type,
    subject_type=excluded.subject_type,
    subject_id=excluded.subject_id,
    actor_user_id=excluded.actor_user_id,
    title=excluded.title,
    summary=excluded.summary,
    route=excluded.route,
    route_params=excluded.route_params,
    occurred_at=excluded.occurred_at
  returning activity_event_id into v_id;
  return v_id;
end
$$;

create or replace function private.add_activity_audience(
  p_event_id uuid,
  p_recipient_user_id text,
  p_workspace text,
  p_domain text default null,
  p_state text default null,
  p_action_required boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
begin
  insert into public.activity_event_audiences(
    activity_event_id,recipient_user_id,workspace,domain,state_scope,
    read_at,resolved_at,action_required
  ) values(
    p_event_id,p_recipient_user_id,p_workspace,p_domain,p_state,
    null,null,coalesce(p_action_required,false)
  )
  on conflict(activity_event_id,recipient_user_id,workspace) do update set
    domain=excluded.domain,
    state_scope=excluded.state_scope,
    action_required=excluded.action_required,
    resolved_at=null;
end
$$;

create or replace function private.fanout_team_activity(
  p_event_id uuid,
  p_domain text,
  p_state text,
  p_lga text default null,
  p_action_required boolean default true
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_row record;
  v_count integer:=0;
begin
  if p_domain not in (
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
  ) then
    raise exception 'Invalid Activity domain';
  end if;

  for v_row in
    select distinct w.user_id,w.workspace_role
    from public.workspace_role_assignments w
    join public.profiles p on p.user_id=w.user_id
    where w.status='active'
      and w.revoked_at is null
      and w.workspace_role in (p_domain,'admin')
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        w.scope_type='global'
        or (
          w.scope_type in ('state','branch')
          and nullif(public.wehouse_state_key(w.scope_state),'') is not null
          and public.wehouse_state_key(w.scope_state)=public.wehouse_state_key(p_state)
          and (
            w.scope_type='state'
            or (
              nullif(lower(btrim(coalesce(w.scope_lga,''))),'') is not null
              and lower(btrim(w.scope_lga))=lower(btrim(coalesce(p_lga,'')))
            )
          )
        )
      )
  loop
    perform private.add_activity_audience(
      p_event_id,
      v_row.user_id,
      case when v_row.workspace_role='admin' then 'admin' else p_domain end,
      p_domain,
      p_state,
      p_action_required
    );
    v_count:=v_count+1;
  end loop;

  if v_count=0 then
    for v_row in
      select distinct w.user_id
      from public.workspace_role_assignments w
      join public.profiles p on p.user_id=w.user_id
      where w.workspace_role='creator'
        and w.status='active'
        and w.revoked_at is null
        and not coalesce(p.deleted,false)
        and not coalesce(p.suspended,false)
        and not coalesce(p.banned,false)
    loop
      perform private.add_activity_audience(
        p_event_id,v_row.user_id,'creator',p_domain,p_state,p_action_required
      );
      v_count:=v_count+1;
    end loop;
  end if;

  return v_count;
end
$$;

create or replace function private.fanout_hotel_activity(
  p_event_id uuid,
  p_hotel_id integer,
  p_action_required boolean default false
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $
declare
  v_member record;
  v_count integer:=0;
begin
  for v_member in
    select distinct member.member_user_id
    from public.hotel_team_members member
    join public.profiles p on p.user_id=member.member_user_id
    where member.hotel_id=p_hotel_id
      and member.status='active'
      and member.revoked_at is null
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
  loop
    perform private.add_activity_audience(
      p_event_id,v_member.member_user_id,'hotel','hotel',null,p_action_required
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end
$;

create or replace function private.resolve_subject_activity(
  p_subject_type text,
  p_subject_id text,
  p_event_type text default null,
  p_domain text default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare v_count integer;
begin
  update public.activity_event_audiences a
  set resolved_at=coalesce(a.resolved_at,now())
  from public.activity_events e
  where e.activity_event_id=a.activity_event_id
    and e.subject_type=p_subject_type
    and e.subject_id=p_subject_id
    and (p_event_type is null or e.event_type=p_event_type)
    and (p_domain is null or a.domain=p_domain)
    and a.resolved_at is null;
  get diagnostics v_count=row_count;
  return v_count;
end
$$;

create or replace function public.get_my_canonical_activity_v2(
  p_workspace text default 'personal',
  p_limit integer default 100
)
returns table(
  id uuid,
  type text,
  title text,
  message text,
  read boolean,
  created_at timestamptz,
  source_type text,
  source_id text,
  destination_route text,
  destination_params jsonb,
  workspace text,
  action_required boolean,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare v_user text:=public.current_profile_user_id();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_workspace not in(
    'personal','account','worker','partner','property_partner','hotel',
    'staff','admin','creator','property_operations','field_operations',
    'worker_operations','finance_operations','security_operations','support'
  ) then raise exception 'Invalid Activity workspace'; end if;

  return query
  select e.activity_event_id,e.event_type,e.title,e.summary,
    a.read_at is not null,e.occurred_at,e.subject_type,e.subject_id,
    e.route,e.route_params,a.workspace,
    coalesce(a.action_required,false) and a.resolved_at is null,
    a.resolved_at
  from public.activity_event_audiences a
  join public.activity_events e on e.activity_event_id=a.activity_event_id
  where a.recipient_user_id=v_user
    and private.activity_workspace_matches(p_workspace,a.workspace)
  order by e.occurred_at desc
  limit greatest(1,least(coalesce(p_limit,100),200));
end
$$;

create or replace function public.get_my_canonical_activity_summary(
  p_workspace text default 'personal'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_user text:=public.current_profile_user_id();
  v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_workspace not in(
    'personal','account','worker','partner','property_partner','hotel',
    'staff','admin','creator','property_operations','field_operations',
    'worker_operations','finance_operations','security_operations','support'
  ) then raise exception 'Invalid Activity workspace'; end if;

  select jsonb_build_object(
    'unread',count(*) filter(
      where a.read_at is null
        and e.occurred_at>=now()-interval '180 days'
    ),
    'needs_action',count(*) filter(
      where coalesce(a.action_required,false)
        and a.resolved_at is null
    ),
    'latest_at',max(e.occurred_at)
  )
  into v_result
  from public.activity_event_audiences a
  join public.activity_events e on e.activity_event_id=a.activity_event_id
  where a.recipient_user_id=v_user
    and private.activity_workspace_matches(p_workspace,a.workspace);

  return coalesce(v_result,jsonb_build_object(
    'unread',0,'needs_action',0,'latest_at',null
  ));
end
$$;

create or replace function public.mark_my_canonical_activity_read(
  p_activity_event_id uuid,
  p_workspace text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare v_user text:=public.current_profile_user_id();
begin
  update public.activity_event_audiences
  set read_at=coalesce(read_at,now())
  where activity_event_id=p_activity_event_id
    and recipient_user_id=v_user
    and private.activity_workspace_matches(p_workspace,workspace);
  return found;
end
$$;

create or replace function public.mark_all_my_canonical_activity_read(
  p_workspace text
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare v_user text:=public.current_profile_user_id(); v_count integer;
begin
  update public.activity_event_audiences
  set read_at=coalesce(read_at,now())
  where recipient_user_id=v_user
    and read_at is null
    and private.activity_workspace_matches(p_workspace,workspace);
  get diagnostics v_count=row_count;
  return v_count;
end
$$;

create or replace function public.mirror_notification_to_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_event_id uuid;
  v_workspace text:=coalesce(nullif(btrim(new.workspace_scope),''),'personal');
  v_state text;
begin
  select coalesce(nullif(btrim(p.assigned_state),''),nullif(btrim(p.state),''))
  into v_state from public.profiles p where p.user_id=new.recipient_id;

  v_event_id:=private.upsert_activity_event(
    coalesce(nullif(btrim(new.event_key),''),'notification:'||new.id),
    new.type,
    coalesce(nullif(btrim(new.source_type),''),'notification'),
    coalesce(nullif(btrim(new.source_id),''),nullif(btrim(new.related_id),''),new.id::text),
    null,
    new.title,
    new.message,
    coalesce(nullif(btrim(new.destination_route),''),'activity'),
    coalesce(new.destination_params,'{}'::jsonb),
    new.created_at
  );

  insert into public.activity_event_audiences(
    activity_event_id,recipient_user_id,workspace,domain,state_scope,
    read_at,resolved_at,action_required
  ) values(
    v_event_id,new.recipient_id,v_workspace,
    case when v_workspace in(
      'property_operations','field_operations','worker_operations',
      'finance_operations','security_operations','support'
    ) then v_workspace else null end,
    v_state,
    case when new.read then coalesce(new.read_at,now()) else null end,
    null,
    private.activity_type_requires_action(new.type,new.title,new.message)
  )
  on conflict(activity_event_id,recipient_user_id,workspace) do update set
    read_at=case when new.read then coalesce(new.read_at,now())
      else activity_event_audiences.read_at end,
    action_required=excluded.action_required;
  return new;
end
$$;

create or replace function public.emit_worker_review_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_profile public.profiles;
  v_event_id uuid;
  v_event_key text;
  v_lga text;
begin
  if tg_op<>'UPDATE' or new.status is not distinct from old.status then
    return new;
  end if;

  select * into v_profile
  from public.profiles p
  where p.user_id=new.worker_id
  limit 1;
  if v_profile.user_id is null then return new; end if;
  v_lga:=coalesce(nullif(v_profile.local_government,''),nullif(v_profile.city,''));

  if new.status='profile_under_review' then
    v_event_key:='worker_review:'||new.id::text||':submitted:'||
      coalesce(new.submitted_at,new.updated_at,now())::text;
    v_event_id:=private.upsert_activity_event(
      v_event_key,
      'worker.review_submitted',
      'worker',
      new.worker_id,
      new.worker_id,
      'Worker profile needs review',
      coalesce(v_profile.full_name,v_profile.username,'A Worker')||
        ' submitted professional evidence for WeHouse review.',
      'operations_workers',
      jsonb_build_object(
        'worker_id',new.worker_id,
        'verification_id',new.id
      ),
      coalesce(new.submitted_at,new.updated_at,now())
    );
    perform private.fanout_team_activity(
      v_event_id,'worker_operations',v_profile.state,v_lga,true
    );
  elsif old.status='profile_under_review'
        and new.status in ('verified','rejected') then
    perform private.resolve_subject_activity(
      'worker',new.worker_id,'worker.review_submitted','worker_operations'
    );
    v_event_id:=private.upsert_activity_event(
      'worker_review:'||new.id::text||':'||new.status||':'||
        coalesce(new.reviewed_at,new.updated_at,now())::text,
      case when new.status='verified'
        then 'worker.review_approved'
        else 'worker.review_rejected' end,
      'worker',
      new.worker_id,
      new.reviewed_by,
      case when new.status='verified'
        then 'Worker profile approved'
        else 'Worker profile needs changes' end,
      case when new.status='verified'
        then 'Your Service Worker profile passed WeHouse review.'
        else coalesce(nullif(btrim(new.review_notes),''),
          'Your Service Worker profile was not approved. Review the feedback and update your profile.') end,
      'worker_dashboard',
      jsonb_build_object(
        'worker_id',new.worker_id,
        'verification_id',new.id
      ),
      coalesce(new.reviewed_at,new.updated_at,now())
    );
    perform private.add_activity_audience(
      v_event_id,new.worker_id,'worker','worker_operations',
      v_profile.state,new.status='rejected'
    );
  end if;
  return new;
end
$$;

drop trigger if exists worker_verification_canonical_activity
on public.worker_verifications;
create trigger worker_verification_canonical_activity
after update of status,submitted_at,reviewed_at
on public.worker_verifications
for each row execute function public.emit_worker_review_activity();

create or replace function public.notify_property_operations_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $
declare
  v_stage text:=lower(coalesce(new.lifecycle_stage,''));
  v_event_id uuid;
  v_title text;
begin
  if tg_op='UPDATE' and new.lifecycle_stage is not distinct from old.lifecycle_stage then
    return new;
  end if;

  perform private.resolve_subject_activity(
    'inspection_request',new.id::text,null,'property_operations'
  );

  if v_stage not in (
    'access_review','inspection_ready','awaiting_review','listing_prepared'
  ) then
    return new;
  end if;

  v_title:=case v_stage
    when 'access_review' then 'Access evidence needs review'
    when 'inspection_ready' then 'Property needs a field assignment'
    when 'awaiting_review' then 'Field evidence needs review'
    else 'Listing is ready for publication review'
  end;

  v_event_id:=private.upsert_activity_event(
    'operations_property:'||new.id::text||':'||v_stage,
    'property.'||v_stage||'.action_required',
    'inspection_request',
    new.id::text,
    coalesce(new.owner_id,new.approved_by),
    v_title,
    concat_ws(' · ',nullif(new.property_display_name,''),nullif(new.property_address,''),nullif(new.request_code,'')),
    'operations_properties',
    jsonb_build_object(
      'inspection_id',new.id,
      'request_code',new.request_code,
      'lifecycle_stage',v_stage
    ),
    coalesce(new.updated_at,now())
  );

  perform private.fanout_team_activity(
    v_event_id,
    'property_operations',
    new.property_state,
    new.property_city,
    true
  );
  return new;
end
$;

create or replace function public.notify_reservation_operations_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $
declare
  v_listing public.listings;
  v_event_id uuid;
  v_status_changed boolean:=true;
  v_move_in_changed boolean:=true;
begin
  if tg_op='UPDATE' then
    v_status_changed:=old.status is distinct from new.status;
    v_move_in_changed:=old.requested_move_in_at is distinct from new.requested_move_in_at;
  end if;
  select * into v_listing
  from public.listings listing
  where listing.id::text=new.listing_id or listing.listing_id=new.listing_id
  limit 1;
  if v_listing is null then return new; end if;

  if new.status<>'inspection_pending' then
    perform private.resolve_subject_activity(
      'reservation',new.id,'reservation.inspection_coordination','property_operations'
    );
  end if;
  if new.status<>'payment_conflict' then
    perform private.resolve_subject_activity(
      'reservation',new.id,'reservation.payment_conflict','finance_operations'
    );
  end if;
  if new.requested_move_in_at is null
     or new.verified_handover_at is not null
     or new.status in ('occupied','completed','cancelled','refunded') then
    perform private.resolve_subject_activity(
      'reservation',new.id,'reservation.move_in_requested','property_operations'
    );
  end if;

  if new.status='inspection_pending' and v_status_changed then
    v_event_id:=private.upsert_activity_event(
      'operations_reservation:'||new.id||':inspection_pending',
      'reservation.inspection_coordination',
      'reservation',new.id,new.user_id,
      'Inspection request needs coordination',
      coalesce(v_listing.title,'Apartment')||' · assign or continue the requested visit.',
      'operations_bookings',
      jsonb_build_object(
        'reservation_id',new.id,'listing_id',v_listing.id::text,
        'workflow_state','inspection_pending'
      ),
      coalesce(new.updated_at,now())
    );
    perform private.fanout_team_activity(
      v_event_id,'property_operations',v_listing.state,v_listing.city,true
    );
  end if;

  if new.status='payment_conflict' and v_status_changed then
    v_event_id:=private.upsert_activity_event(
      'operations_reservation:'||new.id||':payment_conflict',
      'reservation.payment_conflict',
      'reservation',new.id,new.user_id,
      'Reservation payment needs review',
      coalesce(v_listing.title,'Apartment')||' · payment must be reviewed before this reservation can continue.',
      'operations_bookings',
      jsonb_build_object(
        'reservation_id',new.id,'listing_id',v_listing.id::text,
        'workflow_state','payment_conflict'
      ),
      coalesce(new.updated_at,now())
    );
    perform private.fanout_team_activity(
      v_event_id,'finance_operations',v_listing.state,v_listing.city,true
    );
  end if;

  if new.requested_move_in_at is not null
     and new.verified_handover_at is null
     and v_move_in_changed then
    v_event_id:=private.upsert_activity_event(
      'operations_reservation:'||new.id||':move_in_requested:'||new.requested_move_in_at::text,
      'reservation.move_in_requested',
      'reservation',new.id,new.user_id,
      'Customer selected a move-in time',
      coalesce(v_listing.title,'Apartment')||' · prepare the verified handover.',
      'operations_bookings',
      jsonb_build_object(
        'reservation_id',new.id,'listing_id',v_listing.id::text,
        'requested_move_in_at',new.requested_move_in_at
      ),
      coalesce(new.move_in_requested_at,new.updated_at,now())
    );
    perform private.fanout_team_activity(
      v_event_id,'property_operations',v_listing.state,v_listing.city,true
    );
  end if;

  return new;
end
$;

drop trigger if exists reservations_operations_activity on public.reservations;
create trigger reservations_operations_activity
after insert or update of
  status,rent_payment_status,rent_paid_at,requested_move_in_at,verified_handover_at
on public.reservations
for each row execute function public.notify_reservation_operations_activity();

create or replace function public.emit_withdrawal_review_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $
declare
  v_wallet public.wallets;
  v_owner public.profiles;
  v_event_id uuid;
  v_status_changed boolean:=true;
begin
  if tg_op='UPDATE' then
    v_status_changed:=old.status is distinct from new.status;
  end if;
  select * into v_wallet from public.wallets where id=new.wallet_id;
  if v_wallet.id is null then return new; end if;
  select * into v_owner from public.profiles where user_id=v_wallet.owner_id limit 1;
  if v_owner.user_id is null then return new; end if;

  if new.status<>'awaiting_review' then
    perform private.resolve_subject_activity(
      'withdrawal',new.id::text,'finance.withdrawal_review_required','finance_operations'
    );
  end if;

  if new.status='awaiting_review' and v_status_changed then
    v_event_id:=private.upsert_activity_event(
      'withdrawal_review:'||new.id::text,
      'finance.withdrawal_review_required',
      'withdrawal',new.id::text,v_wallet.owner_id,
      'Withdrawal needs review',
      coalesce(v_owner.full_name,v_owner.username,'Account')||
        ' requested a withdrawal of ₦'||trim(to_char(new.amount,'FM999,999,999,990.00'))||'.',
      'finance',
      jsonb_build_object(
        'withdrawal_id',new.id,
        'owner_id',v_wallet.owner_id,
        'owner_type',v_wallet.owner_type
      ),
      coalesce(new.updated_at,new.created_at,now())
    );
    perform private.fanout_team_activity(
      v_event_id,'finance_operations',v_owner.state,
      coalesce(nullif(v_owner.local_government,''),v_owner.city),true
    );
  end if;
  return new;
end
$;

drop trigger if exists withdrawal_canonical_activity on public.withdrawals;
create trigger withdrawal_canonical_activity
after insert or update of status
on public.withdrawals
for each row execute function public.emit_withdrawal_review_activity();

create or replace function public.emit_operational_case_activity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $
declare
  v_requester public.profiles;
  v_event_id uuid;
  v_lga text;
  v_route text;
begin
  select * into v_requester
  from public.profiles where user_id=new.requester_user_id limit 1;
  v_lga:=coalesce(nullif(v_requester.local_government,''),nullif(v_requester.city,''));

  if new.status in ('resolved','closed') then
    perform private.resolve_subject_activity(
      'operational_case',new.operational_case_id::text,
      'case.action_required',new.owning_domain
    );
    return new;
  end if;

  if new.owning_domain not in (
    'property_operations','field_operations','worker_operations',
    'finance_operations','security_operations','support'
  ) then return new; end if;

  if tg_op='UPDATE'
     and new.status is not distinct from old.status
     and new.assigned_user_id is not distinct from old.assigned_user_id
     and new.priority is not distinct from old.priority then
    return new;
  end if;

  -- Ordinary support conversations already live in Inbox. Activity is for
  -- escalated/actionable operational work, not every support message.
  if new.owning_domain='support'
     and new.priority not in ('high','urgent')
     and new.status<>'decision_ready' then
    return new;
  end if;

  v_route:=case new.owning_domain
    when 'property_operations' then 'operations_properties'
    when 'field_operations' then 'staff_inspections'
    when 'worker_operations' then 'operations_workers'
    when 'finance_operations' then 'finance'
    when 'security_operations' then 'security'
    else 'operations_inbox'
  end;

  v_event_id:=private.upsert_activity_event(
    'operational_case:'||new.operational_case_id::text||':'||new.status,
    'case.action_required',
    'operational_case',new.operational_case_id::text,new.requester_user_id,
    case
      when new.owning_domain='security_operations' then 'Security case needs attention'
      when new.owning_domain='finance_operations' then 'Finance case needs attention'
      else 'Operational case needs attention'
    end,
    'Case #'||new.case_number::text||' · '||replace(new.reason_code,'_',' '),
    v_route,
    jsonb_build_object(
      'case_id',new.operational_case_id,
      'case_number',new.case_number,
      'context_type',new.owning_domain,
      'subject_type',new.subject_type,
      'subject_id',new.subject_id
    ),
    coalesce(new.updated_at,new.created_at,now())
  );

  perform private.fanout_team_activity(
    v_event_id,new.owning_domain,
    coalesce(new.state_scope,v_requester.state),v_lga,true
  );
  return new;
end
$;

drop trigger if exists operational_case_canonical_activity on public.operational_cases;
create trigger operational_case_canonical_activity
after insert or update of status,assigned_user_id,priority
on public.operational_cases
for each row execute function public.emit_operational_case_activity();

create or replace function public.notify_hotel_booking_lifecycle()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $
declare
  v_hotel public.hotels;
  v_event_id uuid;
begin
  select * into v_hotel from public.hotels where hotel_id=new.hotel_id;
  if v_hotel.hotel_id is null then return new; end if;

  if new.status='confirmed' and new.payment_status='paid'
     and (tg_op='INSERT'
       or old.status is distinct from new.status
       or old.payment_status is distinct from new.payment_status) then
    v_event_id:=private.upsert_activity_event(
      'hotel_booking:'||new.booking_id||':confirmed',
      'hotel.stay_confirmed',
      'hotel_booking',new.booking_id::text,new.user_id,
      'Hotel stay confirmed',
      v_hotel.name||' · '||to_char(new.check_in,'Mon DD')||' to '||to_char(new.check_out,'Mon DD')||'.',
      'my_reservations',
      jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),
      coalesce(new.updated_at,new.created_at,now())
    );
    perform private.add_activity_audience(
      v_event_id,new.user_id,'personal','hotel',v_hotel.state,false
    );
    if v_hotel.owner_id is not null then
      perform private.add_activity_audience(
        v_event_id,v_hotel.owner_id,'partner','hotel',v_hotel.state,false
      );
    end if;
    perform private.fanout_hotel_activity(v_event_id,new.hotel_id,true);
    return new;
  end if;

  if tg_op='UPDATE' and new.status is distinct from old.status
     and new.status in ('checked_in','checked_out') then
    v_event_id:=private.upsert_activity_event(
      'hotel_booking:'||new.booking_id||':'||new.status,
      case when new.status='checked_in'
        then 'hotel.checked_in' else 'hotel.checked_out' end,
      'hotel_booking',new.booking_id::text,new.user_id,
      case when new.status='checked_in'
        then 'Hotel check-in completed' else 'Hotel checkout completed' end,
      case when new.status='checked_in'
        then 'You are checked in at '||v_hotel.name||'.'
        else 'Your stay at '||v_hotel.name||' is complete.' end,
      'my_reservations',
      jsonb_build_object('bookingId',new.booking_id,'hotelId',new.hotel_id),
      coalesce(new.updated_at,now())
    );
    perform private.add_activity_audience(
      v_event_id,new.user_id,'personal','hotel',v_hotel.state,false
    );
    perform private.fanout_hotel_activity(v_event_id,new.hotel_id,false);
  end if;
  return new;
end
$;

revoke all on function public.get_my_canonical_activity_v2(text,integer)
from public,anon;
grant execute on function public.get_my_canonical_activity_v2(text,integer)
to authenticated,service_role;

revoke all on function public.get_my_canonical_activity_summary(text)
from public,anon;
grant execute on function public.get_my_canonical_activity_summary(text)
to authenticated,service_role;

revoke all on function public.emit_worker_review_activity()
from public,anon,authenticated;
grant execute on function public.emit_worker_review_activity()
to service_role;

revoke all on function private.activity_workspace_matches(text,text)
from public,anon,authenticated;
revoke all on function private.activity_type_requires_action(text,text,text)
from public,anon,authenticated;
revoke all on function private.upsert_activity_event(
  text,text,text,text,text,text,text,text,jsonb,timestamptz
) from public,anon,authenticated;
revoke all on function private.add_activity_audience(
  uuid,text,text,text,text,boolean
) from public,anon,authenticated;
revoke all on function private.fanout_team_activity(
  uuid,text,text,text,boolean
) from public,anon,authenticated;
revoke all on function private.resolve_subject_activity(
  text,text,text,text
) from public,anon,authenticated;
revoke all on function private.fanout_hotel_activity(uuid,integer,boolean)
from public,anon,authenticated;
revoke all on function public.notify_property_operations_activity()
from public,anon,authenticated;
revoke all on function public.notify_reservation_operations_activity()
from public,anon,authenticated;
revoke all on function public.emit_withdrawal_review_activity()
from public,anon,authenticated;
revoke all on function public.emit_operational_case_activity()
from public,anon,authenticated;
revoke all on function public.notify_hotel_booking_lifecycle()
from public,anon,authenticated;
grant execute on function public.notify_property_operations_activity() to service_role;
grant execute on function public.notify_reservation_operations_activity() to service_role;
grant execute on function public.emit_withdrawal_review_activity() to service_role;
grant execute on function public.emit_operational_case_activity() to service_role;
grant execute on function public.notify_hotel_booking_lifecycle() to service_role;

-- Clients may read their own legacy delivery rows and mark them read, but may
-- not fabricate/delete Activity by writing arbitrary notifications.
drop policy if exists notifications_operational_insert_canonical
on public.notifications;
revoke all on table public.notifications from anon;
revoke insert,delete on table public.notifications from authenticated;
revoke update on table public.notifications from authenticated;
grant select on table public.notifications to authenticated;
grant update(read,read_at) on table public.notifications to authenticated;
grant all on table public.notifications to service_role;
