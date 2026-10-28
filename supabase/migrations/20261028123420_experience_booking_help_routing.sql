-- Ordinary Help uses existing queues; it never releases money or cancels a booking.
insert into public.case_reason_registry(reason_code,label,owning_domain,allowed_subject_types,requires_evidence,customer_description)
 values('experience_booking_help','Activity booking help','worker_operations',array['experience_booking'],false,'Ask about your booked activity, participation or a review decision.');
update public.case_reason_registry set allowed_subject_types=array_append(allowed_subject_types,'experience_booking')
 where reason_code in('payment_issue','safety_threat') and not ('experience_booking'=any(allowed_subject_types));

do $authority$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.actor_can_open_case_for_subject(text,text,text)'::regprocedure);
 needle:='p_user_id in(experience_booking.customer_user_id,experience_booking.host_user_id)';
 if strpos(definition,needle)=0 then raise exception 'Inspect Experience case participant authority';end if;
 execute replace(definition,needle,$new$((p_user_id=experience_booking.customer_user_id and public.workspace_access_allowed(p_user_id,'personal'))
  or (p_user_id=experience_booking.host_user_id and public.user_has_active_workspace(p_user_id,'worker')))$new$);
 definition:=pg_get_functiondef('public.open_contextual_case(text,text,text,text)'::regprocedure);
 needle:='if v_user is null then raise exception ''Authentication required''; end if;';
 if strpos(definition,needle)=0 then raise exception 'Inspect contextual case authentication';end if;
 definition:=replace(definition,needle,needle||$new$
  if p_subject_type='experience_booking' and not public._property_document_session_active() then raise exception 'A trusted active session is required' using errcode='42501';end if;
 $new$);
 definition:=replace(definition,'coalesce(experience_activity.details->>''state'',l.state,h.state,p.state)',
  'coalesce(experience_booking.contract#>>''{activity_details,state}'',experience_activity.details->>''state'',l.state,h.state,p.state)');
 execute definition;
end $authority$;

create function public.get_my_experience_help_targets(p_host boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null or not public._property_document_session_active() then raise exception 'Trusted sign-in required' using errcode='42501';end if;
 if p_host is null or (p_host and not public.user_has_active_workspace(actor,'worker'))
  or (not p_host and not public.workspace_access_allowed(actor,'personal')) then raise exception 'Workspace access required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('subject_type','experience_booking','subject_id',b.id::text,
  'context_type','experience_booking','label',b.contract->>'title','status',b.status,'updated_at',b.updated_at,
  'record_date',b.created_at,'record_reference','Record '||left(md5('experience_booking:'||b.id),8),
  'payment_eligible',b.payment_protection_id is not null or exists(select 1 from public.booking_payments p
   where p.experience_booking_id=b.id and (p.verified_at is not null or p.paid_at is not null
    or (b.expires_at>now() and p.status not in('cancelled','canceled','expired','abandoned')))))
  order by b.created_at desc,b.id desc),'[]'::jsonb)
 from(select * from public.experience_bookings where case when p_host then host_user_id=actor else customer_user_id=actor end
  order by created_at desc,id desc limit 50)b);
end $$;
revoke all on function public.get_my_experience_help_targets(boolean) from public,anon,service_role;
grant execute on function public.get_my_experience_help_targets(boolean) to authenticated;

-- Preserve the canonical Help function identity and existing payment projection.
do $projection$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.get_my_workspace_help_targets(text)'::regprocedure);
 needle:='if actor is null or not coalesce((access->>''personal_workspace'')::boolean,false) then';
 if strpos(definition,needle)=0 then raise exception 'Inspect workspace Help access guard';end if;
 definition:=replace(definition,needle,'if actor is null or (p_workspace=''personal'' and not coalesce((access->>''personal_workspace'')::boolean,false)) then');
 needle:='return result || jsonb_build_object(''payment_targets'',rows);';
 if strpos(definition,needle)=0 then raise exception 'Inspect canonical payment Help projection';end if;
 definition:=replace(definition,needle,$new$
  if p_workspace in('personal','worker') then
   result:=result||jsonb_build_object('experience_bookings',public.get_my_experience_help_targets(p_workspace='worker'));
   rows:=rows||(select coalesce(jsonb_agg(item),'[]'::jsonb) from jsonb_array_elements(result->'experience_bookings') item where item->>'payment_eligible'='true');
  end if;
  return result || jsonb_build_object('payment_targets',rows);
 $new$);
 execute definition;
end $projection$;
