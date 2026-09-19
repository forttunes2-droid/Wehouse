-- Security Operations can investigate and escalate branch-scoped security cases.
-- Account sanctions remain Admin/Creator authority; Security Staff never receive ban/suspend authority.

create or replace function public.get_my_staff_security_monitor()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','auth'
as $function$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  select * into v_actor
  from public.profiles p
  where p.auth_id=auth.uid()::text
    and p.role='staff'
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor is null or not exists(
    select 1 from public.staff_permissions sp
    where sp.staff_id=v_actor.user_id
      and sp.permission='security'
      and sp.is_active=true
      and sp.revoked_at is null
  ) then
    raise exception 'Security Staff permission required';
  end if;

  if nullif(btrim(v_actor.assigned_state),'') is null
     or nullif(btrim(v_actor.assigned_lga),'') is null then
    raise exception 'Security Staff branch assignment is incomplete';
  end if;

  with scoped_profiles as (
    select p.*
    from public.profiles p
    where lower(coalesce(nullif(p.assigned_state,''),nullif(p.state,''),''))=lower(v_actor.assigned_state)
      and lower(coalesce(nullif(p.assigned_lga,''),nullif(p.local_government,''),nullif(p.city,''),''))=lower(v_actor.assigned_lga)
  ), recent_sessions as (
    select s.*,p.full_name,p.username,p.role
    from public.user_sessions s
    join scoped_profiles p on p.user_id=s.user_id
    where s.login_time>=now()-interval '30 days'
  ), multi_ip as (
    select user_id,
      coalesce(max(full_name),max(username),'Account') name,
      count(distinct ip_address) locations
    from recent_sessions
    where is_active=true and nullif(ip_address,'') is not null
    group by user_id
    having count(distinct ip_address)>=2
  ), bursts as (
    select user_id,
      coalesce(max(full_name),max(username),'Account') name,
      count(*) attempts
    from recent_sessions
    where login_time>=now()-interval '60 minutes'
    group by user_id
    having count(*)>=5
  ), restricted as (
    select count(*)::integer total
    from scoped_profiles
    where coalesce(banned,false) or coalesce(suspended,false) or coalesce(deleted,false)
  ), alerts as (
    select jsonb_build_object(
      'kind','multiple_locations',
      'severity','high',
      'target_user_id',user_id,
      'title','Concurrent location pattern',
      'detail',name||' has '||locations||' active network locations. Review the session trail and escalate if the user does not recognise them.'
    ) item from multi_ip
    union all
    select jsonb_build_object(
      'kind','login_burst',
      'severity','high',
      'target_user_id',user_id,
      'title','Rapid sign-in pattern',
      'detail',name||' recorded '||attempts||' session starts within the last hour. Confirm context before escalation.'
    ) from bursts
  ), auth_events as (
    select a.id,a.created_at,
      coalesce(a.payload->>'action','authentication_event') action,
      coalesce(p.full_name,p.username,'Branch account') name
    from auth.audit_log_entries a
    join scoped_profiles p on p.auth_id=coalesce(a.payload->>'user_id',a.payload->>'actor_id')
    where a.created_at>=now()-interval '30 days'
    order by a.created_at desc
    limit 50
  )
  select jsonb_build_object(
    'stats',jsonb_build_object(
      'active_sessions',(select count(*) from recent_sessions where is_active=true),
      'multi_ip_accounts',(select count(*) from multi_ip),
      'login_bursts',(select count(*) from bursts),
      'restricted_accounts',(select total from restricted)
    ),
    'alerts',coalesce((select jsonb_agg(item) from alerts),'[]'::jsonb),
    'sessions',coalesce((
      select jsonb_agg(x order by x.last_seen desc)
      from (
        select user_id,id session_id,coalesce(full_name,username,'Branch account') name,
          role,device,browser,os,is_active,last_seen,login_time
        from recent_sessions
        order by last_seen desc nulls last
        limit 50
      ) x
    ),'[]'::jsonb),
    'admin_actions',coalesce((
      select jsonb_agg(x order by x.created_at desc)
      from (
        select a.id,a.action,a.target_type,a.target_id,a.details,
          a.admin_id actor_id,a.admin_email actor_email,a.created_at
        from public.admin_audit_log a
        left join public.profiles actor on actor.user_id=a.admin_id
        where a.created_at>=now()-interval '30 days'
          and lower(coalesce(nullif(actor.assigned_state,''),v_actor.assigned_state))=lower(v_actor.assigned_state)
          and lower(coalesce(nullif(actor.assigned_lga,''),v_actor.assigned_lga))=lower(v_actor.assigned_lga)
        order by a.created_at desc
        limit 50
      ) x
    ),'[]'::jsonb),
    'auth_events',coalesce((select jsonb_agg(auth_events order by created_at desc) from auth_events),'[]'::jsonb),
    'auth_audit_available',true
  ) into v_result;

  return v_result;
end;
$function$;

create or replace function public.get_my_staff_security_cases()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','auth'
as $function$
declare
  v_actor public.profiles;
  v_cases jsonb;
begin
  select * into v_actor
  from public.profiles p
  where p.auth_id=auth.uid()::text
    and p.role='staff'
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor is null or not exists(
    select 1 from public.staff_permissions sp
    where sp.staff_id=v_actor.user_id
      and sp.permission='security'
      and sp.is_active=true
      and sp.revoked_at is null
  ) then
    raise exception 'Security Staff permission required';
  end if;

  if nullif(btrim(v_actor.assigned_state),'') is null
     or nullif(btrim(v_actor.assigned_lga),'') is null then
    raise exception 'Security Staff branch assignment is incomplete';
  end if;

  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.updated_at desc),'[]'::jsonb)
  into v_cases
  from (
    select
      c.operational_case_id,
      c.case_number,
      c.reason_code,
      coalesce(r.label,c.reason_code) reason_label,
      c.subject_type,
      c.subject_id,
      c.status,
      c.priority,
      c.assigned_user_id,
      coalesce(assigned.full_name,assigned.username) assigned_name,
      c.service_level_due_at,
      c.created_at,
      c.updated_at,
      c.resolved_at,
      coalesce(subject.full_name,subject.username,requester.full_name,requester.username,'Account') subject_name,
      case when c.subject_type='account' then subject.user_id else null end target_user_id,
      coalesce(last_event.internal_note,last_event.public_note) last_note,
      last_event.created_at last_event_at
    from public.operational_cases c
    left join public.case_reason_registry r on r.reason_code=c.reason_code
    left join public.profiles requester on requester.user_id=c.requester_user_id
    left join public.profiles subject on c.subject_type='account' and subject.user_id=c.subject_id
    left join public.profiles assigned on assigned.user_id=c.assigned_user_id
    left join lateral (
      select e.internal_note,e.public_note,e.created_at
      from public.operational_case_events e
      where e.operational_case_id=c.operational_case_id
      order by e.created_at desc
      limit 1
    ) last_event on true
    where c.owning_domain='security_operations'
      and lower(coalesce(
        nullif(subject.assigned_state,''),nullif(subject.state,''),
        nullif(requester.assigned_state,''),nullif(requester.state,''),''
      ))=lower(v_actor.assigned_state)
      and lower(coalesce(
        nullif(subject.assigned_lga,''),nullif(subject.local_government,''),nullif(subject.city,''),
        nullif(requester.assigned_lga,''),nullif(requester.local_government,''),nullif(requester.city,''),''
      ))=lower(v_actor.assigned_lga)
    order by
      case c.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
      c.updated_at desc
    limit 100
  ) q;

  return jsonb_build_object('actor_user_id',v_actor.user_id,'cases',v_cases);
end;
$function$;

create or replace function public.staff_security_open_signal_case(
  p_target_user_id text,
  p_signal_type text,
  p_summary text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public','auth'
as $function$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_case public.operational_cases;
  v_summary text:=nullif(btrim(coalesce(p_summary,'')),'');
begin
  select * into v_actor
  from public.profiles p
  where p.auth_id=auth.uid()::text
    and p.role='staff'
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor is null or not exists(
    select 1 from public.staff_permissions sp
    where sp.staff_id=v_actor.user_id
      and sp.permission='security'
      and sp.is_active=true
      and sp.revoked_at is null
  ) then
    raise exception 'Security Staff permission required';
  end if;

  select * into v_target from public.profiles where user_id=p_target_user_id limit 1;
  if v_target is null then raise exception 'Account not found'; end if;

  if lower(coalesce(nullif(v_target.assigned_state,''),nullif(v_target.state,''),''))<>lower(v_actor.assigned_state)
     or lower(coalesce(nullif(v_target.assigned_lga,''),nullif(v_target.local_government,''),nullif(v_target.city,''),''))<>lower(v_actor.assigned_lga) then
    raise exception 'Account is outside your Security Operations branch';
  end if;

  select * into v_case
  from public.operational_cases c
  where c.owning_domain='security_operations'
    and c.reason_code='account_compromise'
    and c.subject_type='account'
    and c.subject_id=p_target_user_id
    and c.status not in('resolved','closed')
  order by c.updated_at desc
  limit 1
  for update;

  if v_case.operational_case_id is null then
    insert into public.operational_cases(
      reason_code,owning_domain,subject_type,subject_id,requester_user_id,
      state_scope,status,priority,assigned_user_id,service_level_due_at
    ) values(
      'account_compromise','security_operations','account',p_target_user_id,v_actor.user_id,
      coalesce(nullif(v_target.assigned_state,''),nullif(v_target.state,'')),
      'investigating','high',v_actor.user_id,now()+interval '1 hour'
    ) returning * into v_case;

    insert into public.operational_case_events(
      operational_case_id,event_key,event_type,from_status,to_status,actor_user_id,internal_note,metadata
    ) values(
      v_case.operational_case_id,
      'security_signal_opened:'||v_case.operational_case_id::text,
      'security_signal_opened',null,'investigating',v_actor.user_id,v_summary,
      jsonb_build_object('signal_type',coalesce(nullif(btrim(p_signal_type),''),'recorded_signal'))
    );
  elsif v_case.assigned_user_id is null then
    update public.operational_cases
    set assigned_user_id=v_actor.user_id,status='investigating',updated_at=now()
    where operational_case_id=v_case.operational_case_id;
  end if;

  return v_case.operational_case_id;
end;
$function$;

create or replace function public.staff_security_case_action(
  p_case_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','auth'
as $function$
declare
  v_actor public.profiles;
  v_case public.operational_cases;
  v_requester public.profiles;
  v_subject public.profiles;
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_from text;
  v_to text;
  v_event text;
begin
  select * into v_actor
  from public.profiles p
  where p.auth_id=auth.uid()::text
    and p.role='staff'
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;

  if v_actor is null or not exists(
    select 1 from public.staff_permissions sp
    where sp.staff_id=v_actor.user_id
      and sp.permission='security'
      and sp.is_active=true
      and sp.revoked_at is null
  ) then
    raise exception 'Security Staff permission required';
  end if;

  select * into v_case
  from public.operational_cases
  where operational_case_id=p_case_id and owning_domain='security_operations'
  for update;
  if v_case.operational_case_id is null then raise exception 'Security case not found'; end if;

  select * into v_requester from public.profiles where user_id=v_case.requester_user_id limit 1;
  if v_case.subject_type='account' then
    select * into v_subject from public.profiles where user_id=v_case.subject_id limit 1;
  end if;

  if lower(coalesce(
       nullif(v_subject.assigned_state,''),nullif(v_subject.state,''),
       nullif(v_requester.assigned_state,''),nullif(v_requester.state,''),''
     ))<>lower(v_actor.assigned_state)
     or lower(coalesce(
       nullif(v_subject.assigned_lga,''),nullif(v_subject.local_government,''),nullif(v_subject.city,''),
       nullif(v_requester.assigned_lga,''),nullif(v_requester.local_government,''),nullif(v_requester.city,''),''
     ))<>lower(v_actor.assigned_lga) then
    raise exception 'Security case is outside your branch';
  end if;

  if p_action not in('claim','note','escalate','resolve') then
    raise exception 'Unsupported Security Operations action';
  end if;

  if p_action='claim' then
    if v_case.status in('resolved','closed') then raise exception 'Closed security case cannot be claimed'; end if;
    if v_case.assigned_user_id is not null and v_case.assigned_user_id<>v_actor.user_id then
      raise exception 'Security case is already assigned to another team member';
    end if;
    v_from:=v_case.status;
    v_to:='investigating';
    v_event:='security_case_claimed';
    update public.operational_cases
    set assigned_user_id=v_actor.user_id,status=v_to,updated_at=now()
    where operational_case_id=p_case_id;
  else
    if v_case.assigned_user_id is distinct from v_actor.user_id then
      raise exception 'Claim this security case before taking action';
    end if;
    if v_case.status in('resolved','closed') then raise exception 'Security case is already closed'; end if;

    if p_action='note' then
      if v_note is null then raise exception 'An internal note is required'; end if;
      v_from:=v_case.status;
      v_to:=v_case.status;
      v_event:='security_internal_note';
      update public.operational_cases set updated_at=now() where operational_case_id=p_case_id;
    elsif p_action='escalate' then
      if v_note is null then raise exception 'Explain why Admin or Creator action is required'; end if;
      v_from:=v_case.status;
      v_to:='decision_ready';
      v_event:='security_escalated';
      update public.operational_cases set status=v_to,updated_at=now() where operational_case_id=p_case_id;
    else
      if v_note is null then raise exception 'Add the security review outcome'; end if;
      v_from:=v_case.status;
      v_to:='resolved';
      v_event:='security_review_resolved';
      update public.operational_cases
      set status=v_to,resolution_code='security_review_complete',resolution_summary=v_note,
          resolved_at=now(),updated_at=now()
      where operational_case_id=p_case_id;
    end if;
  end if;

  insert into public.operational_case_events(
    operational_case_id,event_key,event_type,from_status,to_status,actor_user_id,internal_note
  ) values(
    p_case_id,
    v_event||':'||gen_random_uuid()::text,
    v_event,v_from,v_to,v_actor.user_id,v_note
  );

  if p_action='escalate' then
    insert into public.notifications(
      recipient_id,type,title,message,source_type,source_id,destination_route,destination_params,event_key,workspace_scope
    )
    select p.user_id,'security_case_escalated','Security case needs a decision',
      'Security Operations escalated case #'||v_case.case_number::text||'. '||left(v_note,180),
      'security_case',p_case_id::text,'security_operations',
      jsonb_build_object('case_id',p_case_id::text,'case_number',v_case.case_number),
      'security_case_escalated:'||p_case_id::text,
      case when p.role='creator' then 'creator' else 'admin' end
    from public.profiles p
    where p.role in('admin','creator')
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        p.role='creator'
        or (
          lower(coalesce(nullif(p.assigned_state,''),nullif(p.state,''),''))=lower(v_actor.assigned_state)
          and lower(coalesce(nullif(p.assigned_lga,''),nullif(p.local_government,''),nullif(p.city,''),''))=lower(v_actor.assigned_lga)
        )
      )
    on conflict(recipient_id,event_key) where event_key is not null
    do update set
      title=excluded.title,
      message=excluded.message,
      destination_params=excluded.destination_params,
      read=false,
      read_at=null,
      created_at=now();
  end if;

  return jsonb_build_object('success',true,'status',v_to,'case_id',p_case_id);
end;
$function$;

create or replace function public.get_my_admin_security_cases()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public','auth'
as $function$
declare
  v_actor public.profiles;
  v_cases jsonb;
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'admin' then raise exception 'Branch Admin required'; end if;

  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.updated_at desc),'[]'::jsonb)
  into v_cases
  from (
    select
      c.operational_case_id,
      c.case_number,
      c.reason_code,
      coalesce(r.label,c.reason_code) reason_label,
      c.subject_type,
      c.subject_id,
      c.status,
      c.priority,
      c.assigned_user_id,
      coalesce(assigned.full_name,assigned.username) assigned_name,
      c.service_level_due_at,
      c.created_at,
      c.updated_at,
      c.resolved_at,
      coalesce(subject.full_name,subject.username,requester.full_name,requester.username,'Account') subject_name,
      case when c.subject_type='account' then subject.user_id else null end target_user_id,
      coalesce(last_event.internal_note,last_event.public_note) last_note,
      last_event.created_at last_event_at
    from public.operational_cases c
    left join public.case_reason_registry r on r.reason_code=c.reason_code
    left join public.profiles requester on requester.user_id=c.requester_user_id
    left join public.profiles subject on c.subject_type='account' and subject.user_id=c.subject_id
    left join public.profiles assigned on assigned.user_id=c.assigned_user_id
    left join lateral (
      select e.internal_note,e.public_note,e.created_at
      from public.operational_case_events e
      where e.operational_case_id=c.operational_case_id
      order by e.created_at desc
      limit 1
    ) last_event on true
    where c.owning_domain='security_operations'
      and lower(coalesce(
        nullif(subject.assigned_state,''),nullif(subject.state,''),
        nullif(requester.assigned_state,''),nullif(requester.state,''),''
      ))=lower(v_actor.assigned_state)
      and lower(coalesce(
        nullif(subject.assigned_lga,''),nullif(subject.local_government,''),nullif(subject.city,''),
        nullif(requester.assigned_lga,''),nullif(requester.local_government,''),nullif(requester.city,''),''
      ))=lower(v_actor.assigned_lga)
    order by
      case when c.status='decision_ready' then 0 else 1 end,
      case c.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
      c.updated_at desc
    limit 100
  ) q;

  return jsonb_build_object('cases',v_cases);
end;
$function$;

create or replace function public.admin_security_case_decision(
  p_case_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','auth'
as $function$
declare
  v_actor public.profiles;
  v_case public.operational_cases;
  v_requester public.profiles;
  v_subject public.profiles;
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_code text;
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'admin' then raise exception 'Branch Admin required'; end if;
  if p_decision not in('suspend','ban','no_action') then raise exception 'Unsupported security decision'; end if;
  if v_note is null then raise exception 'A decision note is required'; end if;

  select * into v_case
  from public.operational_cases
  where operational_case_id=p_case_id and owning_domain='security_operations'
  for update;
  if v_case.operational_case_id is null then raise exception 'Security case not found'; end if;
  if v_case.status in('resolved','closed') then raise exception 'Security case is already closed'; end if;

  select * into v_requester from public.profiles where user_id=v_case.requester_user_id limit 1;
  if v_case.subject_type='account' then
    select * into v_subject from public.profiles where user_id=v_case.subject_id limit 1;
  end if;

  if lower(coalesce(
       nullif(v_subject.assigned_state,''),nullif(v_subject.state,''),
       nullif(v_requester.assigned_state,''),nullif(v_requester.state,''),''
     ))<>lower(v_actor.assigned_state)
     or lower(coalesce(
       nullif(v_subject.assigned_lga,''),nullif(v_subject.local_government,''),nullif(v_subject.city,''),
       nullif(v_requester.assigned_lga,''),nullif(v_requester.local_government,''),nullif(v_requester.city,''),''
     ))<>lower(v_actor.assigned_lga) then
    raise exception 'Security case is outside your branch';
  end if;

  if p_decision in('suspend','ban') and (v_case.subject_type<>'account' or v_subject.user_id is null) then
    raise exception 'Account sanctions require an account security case';
  end if;

  if p_decision='suspend' then
    perform public.admin_suspend_user(v_subject.user_id,v_note);
    v_code:='account_suspended';
  elsif p_decision='ban' then
    perform public.admin_ban_user(v_subject.user_id,v_note);
    v_code:='account_banned';
  else
    v_code:='no_account_action';
  end if;

  update public.operational_cases
  set status='resolved',resolution_code=v_code,resolution_summary=v_note,
      resolved_at=now(),updated_at=now()
  where operational_case_id=p_case_id;

  insert into public.operational_case_events(
    operational_case_id,event_key,event_type,from_status,to_status,actor_user_id,internal_note,metadata
  ) values(
    p_case_id,
    'admin_security_decision:'||gen_random_uuid()::text,
    'admin_security_decision',v_case.status,'resolved',v_actor.user_id,v_note,
    jsonb_build_object('decision',p_decision)
  );

  return jsonb_build_object('success',true,'status','resolved','decision',p_decision,'case_id',p_case_id);
end;
$function$;

revoke all on function public.get_my_staff_security_cases() from public,anon;
revoke all on function public.staff_security_open_signal_case(text,text,text) from public,anon;
revoke all on function public.staff_security_case_action(uuid,text,text) from public,anon;
revoke all on function public.get_my_admin_security_cases() from public,anon;
revoke all on function public.admin_security_case_decision(uuid,text,text) from public,anon;

grant execute on function public.get_my_staff_security_cases() to authenticated,service_role;
grant execute on function public.staff_security_open_signal_case(text,text,text) to authenticated,service_role;
grant execute on function public.staff_security_case_action(uuid,text,text) to authenticated,service_role;
grant execute on function public.get_my_admin_security_cases() to authenticated,service_role;
grant execute on function public.admin_security_case_decision(uuid,text,text) to authenticated,service_role;
