-- Finance and Security Staff runtime uses active workspace grants and State/LGA coverage.

begin;

CREATE OR REPLACE FUNCTION public.get_my_staff_finance_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.profiles;
  v_payments jsonb;v_withdrawals jsonb;v_commissions jsonb;
  v_payment_protection jsonb;v_refunds jsonb;v_audit jsonb;
begin
  v_actor:=public._current_team_actor();
  if v_actor.user_id is null then raise exception 'Active finance account required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('finance_operations') then
    raise exception 'Finance Operations access required';
  end if;
  if v_actor.role in ('staff','admin') and v_actor.assigned_state is null then
    raise exception 'Coverage assignment required';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_payments from (
    select bp.id,bp.payment_reference,bp.type,bp.booking_type,bp.amount,bp.amount_total,
      bp.amount_commission,bp.net_amount,bp.currency,bp.status,bp.purpose,bp.payment_method,
      bp.paystack_reference,bp.verified_at,bp.paid_at,bp.created_at
    from public.booking_payments bp
    where v_actor.role='creator' or public.can_current_actor_read_profile(bp.user_id)
      or public.can_current_actor_read_profile(bp.payer_user_id) or public.can_current_actor_read_profile(bp.payee_user_id)
      or (bp.listing_id is not null and public.current_actor_can_access_listing_ref(bp.listing_id))
    order by bp.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_withdrawals from (
    select wd.id,wd.amount,wd.status,wd.snapshot_bank_name,wd.snapshot_bank_account_number,
      wd.snapshot_bank_account_name,wd.paystack_transfer_reference,wd.paystack_transfer_code,
      wd.paystack_status,wd.reviewed_by,wd.reviewed_at,wd.processed_at,wd.failed_reason,
      wd.finalized_at,wd.created_at,w.owner_id,w.owner_type,
      coalesce(p.full_name,p.username,p.email) owner_name
    from public.withdrawals wd join public.wallets w on w.id=wd.wallet_id
    left join public.profiles p on p.user_id=w.owner_id
    where v_actor.role='creator' or public.can_current_actor_read_profile(w.owner_id)
    order by wd.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_commissions from (
    select c.id,c.booking_type,c.commission_amount,c.commission_rate,c.gross_amount,
      c.description,c.paystack_reference,c.status,c.created_at
    from public.commission_ledger c
    where v_actor.role='creator' or public.can_current_actor_read_profile(c.source_user_id)
    order by c.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_payment_protection from (
    select t.id,t.booking_id,t.booking_type,t.amount_total,t.amount_commission,t.amount_payee,
      t.commission_rate,t.status,t.released_at,t.released_by,t.paystack_reference,t.created_at
    from public.payment_protection_transactions t
    where v_actor.role='creator' or public.can_current_actor_read_profile(t.payer_user_id)
      or public.can_current_actor_read_profile(t.payee_user_id)
    order by t.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_refunds from (
    select bp.id,bp.payment_reference,bp.booking_type,bp.amount_total,bp.status,
      bp.refund_reason,bp.refund_processed_at,bp.refund_reference,bp.created_at
    from public.booking_payments bp
    where (bp.refund_reason is not null or bp.refund_processed_at is not null
      or bp.refund_reference is not null or lower(coalesce(bp.status,'')) like 'refund%')
      and (v_actor.role='creator' or public.can_current_actor_read_profile(bp.user_id)
        or public.can_current_actor_read_profile(bp.payer_user_id) or public.can_current_actor_read_profile(bp.payee_user_id)
        or (bp.listing_id is not null and public.current_actor_can_access_listing_ref(bp.listing_id)))
    order by bp.created_at desc limit 100
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_audit from (
    select a.id,a.action,a.actor_role,a.target_type,a.target_id,a.amount,a.commission_amount,
      a.description,a.status_before,a.status_after,a.failure_reason,a.created_at
    from public.financial_audit_log a
    where v_actor.role='creator' or (a.target_user_id is not null and public.can_current_actor_read_profile(a.target_user_id))
    order by a.created_at desc limit 100
  ) x;
  return jsonb_build_object('payments',v_payments,'withdrawals',v_withdrawals,
    'commissions',v_commissions,'payment_protection',v_payment_protection,
    'refunds',v_refunds,'audit',v_audit);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_staff_security_cases()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_actor public.profiles;
  v_cases jsonb;
begin
  v_actor:=public._current_team_actor();

  if v_actor.role<>'staff' or not public.current_staff_has_permission('security_operations') then
    raise exception 'Security Operations access required';
  end if;

  if nullif(btrim(v_actor.assigned_state),'') is null then
    raise exception 'Security Operations coverage is incomplete';
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
      and public.current_actor_in_scope(
        coalesce(nullif(subject.assigned_state,''),nullif(subject.state,''),nullif(requester.assigned_state,''),nullif(requester.state,'')),
        coalesce(nullif(subject.assigned_lga,''),nullif(subject.local_government,''),nullif(subject.city,''),nullif(requester.assigned_lga,''),nullif(requester.local_government,''),nullif(requester.city,''))
      )
    order by
      case c.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
      c.updated_at desc
    limit 100
  ) q;

  return jsonb_build_object('actor_user_id',v_actor.user_id,'cases',v_cases);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_staff_security_monitor()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_actor public.profiles;
  v_result jsonb;
begin
  v_actor:=public._current_team_actor();

  if v_actor.role<>'staff' or not public.current_staff_has_permission('security_operations') then
    raise exception 'Security Operations access required';
  end if;

  if nullif(btrim(v_actor.assigned_state),'') is null then
    raise exception 'Security Operations coverage is incomplete';
  end if;

  with scoped_profiles as (
    select p.*
    from public.profiles p
    where public.current_actor_in_scope(
        coalesce(nullif(p.assigned_state,''),nullif(p.state,'')),
        coalesce(nullif(p.assigned_lga,''),nullif(p.local_government,''),nullif(p.city,''))
      )
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
$function$
;

CREATE OR REPLACE FUNCTION public.staff_security_case_action(p_case_id uuid, p_action text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
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
  v_actor:=public._current_team_actor();

  if v_actor.role<>'staff' or not public.current_staff_has_permission('security_operations') then
    raise exception 'Security Operations access required';
  end if;

  if nullif(btrim(v_actor.assigned_state),'') is null then
    raise exception 'Security Operations coverage is incomplete';
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

  if not public.current_actor_in_scope(
      coalesce(nullif(v_subject.assigned_state,''),nullif(v_subject.state,''),nullif(v_requester.assigned_state,''),nullif(v_requester.state,'')),
      coalesce(nullif(v_subject.assigned_lga,''),nullif(v_subject.local_government,''),nullif(v_subject.city,''),nullif(v_requester.assigned_lga,''),nullif(v_requester.local_government,''),nullif(v_requester.city,''))
    ) then
      raise exception 'Security case is outside your assigned coverage';
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
$function$
;

CREATE OR REPLACE FUNCTION public.staff_security_open_signal_case(p_target_user_id text, p_signal_type text, p_summary text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_actor public.profiles;
  v_target public.profiles;
  v_case public.operational_cases;
  v_summary text:=nullif(btrim(coalesce(p_summary,'')),'');
begin
  v_actor:=public._current_team_actor();

  if v_actor.role<>'staff' or not public.current_staff_has_permission('security_operations') then
    raise exception 'Security Operations access required';
  end if;

  if nullif(btrim(v_actor.assigned_state),'') is null then
    raise exception 'Security Operations coverage is incomplete';
  end if;

  select * into v_target
  from public.profiles
  where user_id=p_target_user_id
  limit 1;
  if v_target is null then raise exception 'Account not found'; end if;

  if not public.current_actor_in_scope(
      coalesce(nullif(v_target.assigned_state,''),nullif(v_target.state,'')),
      coalesce(nullif(v_target.assigned_lga,''),nullif(v_target.local_government,''),nullif(v_target.city,''))
    ) then
      raise exception 'Account is outside your Security Operations coverage';
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
$function$
;

commit;
