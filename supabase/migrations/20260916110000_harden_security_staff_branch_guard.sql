-- Follow-up guard: Security Operations mutations must fail closed if the Staff
-- member has no explicit State/LGA assignment.

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

  if nullif(btrim(v_actor.assigned_state),'') is null
     or nullif(btrim(v_actor.assigned_lga),'') is null then
    raise exception 'Security Staff branch assignment is incomplete';
  end if;

  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
  limit 1;
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

  if nullif(btrim(v_actor.assigned_state),'') is null
     or nullif(btrim(v_actor.assigned_lga),'') is null then
    raise exception 'Security Staff branch assignment is incomplete';
  end if;

  select * into v_case
  from public.operational_cases
  where operational_case_id=p_case_id and owning_domain='security_operations'
  for update;
  if v_case.operational_case_id is null then raise exception 'Security case not found'; end if;

  select * into v_requester
  from public.profiles
  where user_id=v_case.requester_user_id
  limit 1;
  if v_case.subject_type='account' then
    select * into v_subject
    from public.profiles
    where user_id=v_case.subject_id
    limit 1;
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
    if v_case.status in('resolved','closed') then
      raise exception 'Closed security case cannot be claimed';
    end if;
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
    if v_case.status in('resolved','closed') then
      raise exception 'Security case is already closed';
    end if;

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
    p_case_id,v_event||':'||gen_random_uuid()::text,v_event,
    v_from,v_to,v_actor.user_id,v_note
  );

  if p_action='escalate' then
    insert into public.notifications(
      recipient_id,type,title,message,source_type,source_id,destination_route,
      destination_params,event_key,workspace_scope
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

revoke all on function public.staff_security_open_signal_case(text,text,text) from public,anon;
revoke all on function public.staff_security_case_action(uuid,text,text) from public,anon;
grant execute on function public.staff_security_open_signal_case(text,text,text) to authenticated,service_role;
grant execute on function public.staff_security_case_action(uuid,text,text) to authenticated,service_role;
