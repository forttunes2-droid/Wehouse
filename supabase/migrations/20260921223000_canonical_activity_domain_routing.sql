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
    action_required=excluded.action_required;
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
    'notification:'||new.id,
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
