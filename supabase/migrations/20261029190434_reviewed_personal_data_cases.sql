-- One account, existing Help intake, assignment, messages, case history and Activity.
-- The owner chose reviewed requests. No automatic erasure or retention period.
insert into public.case_reason_registry(reason_code,label,owning_domain,allowed_subject_types,requires_evidence,customer_description)
values
 ('personal_data_access','Get a copy of my data','support',array['account'],false,'Request a copy of your personal information.'),
 ('personal_data_correction','Correct personal information','support',array['account'],false,'Describe the information you need corrected.'),
 ('personal_data_deletion','Request data deletion','support',array['account'],false,'Request a review of information that can be erased or must be retained.');

-- No client reads/writes this audit authority. Existing scoped SECURITY DEFINER
-- commands project customer-visible history and internal notes separately.
revoke all on public.operational_case_events from anon,authenticated;
revoke insert,update,delete,truncate on public.operational_cases from anon,authenticated;

create function private.personal_data_case_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare case_id uuid; reason text; prior_response boolean;
begin
 if new.status is not distinct from old.status or new.status not in('resolved','closed') then return new;end if;
 if tg_table_name='operational_cases' then case_id:=new.operational_case_id;reason:=new.reason_code;
 else
  case_id:=new.operational_case_id;
  select reason_code into reason from public.operational_cases where operational_case_id=case_id;
 end if;
 if reason is null or reason not in('personal_data_access','personal_data_correction','personal_data_deletion') then return new;end if;
 select exists(select 1 from public.operational_case_events e where e.operational_case_id=case_id
  and e.event_type='personal_data_review_response'
  and (old.status='resolved' and new.status='closed' or e.metadata->>'resolution_transaction'=txid_current()::text)) into prior_response;
 if not prior_response then raise exception 'Record the personal-data review response before resolving this request' using errcode='42501';end if;
 return new;
end $$;
revoke all on function private.personal_data_case_guard() from public,anon,authenticated,service_role;
create trigger personal_data_case_response before update of status on public.operational_cases
 for each row execute function private.personal_data_case_guard();
create trigger personal_data_conversation_response before update of status on public.partner_support_conversations
 for each row execute function private.personal_data_case_guard();

-- Ordinary account requests also require a real trusted session at intake;
-- cannot be opened for another person's account or retargeted by snapshot text.
create function private.personal_data_case_intake() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.reason_code in('personal_data_access','personal_data_correction','personal_data_deletion') then
  if not public._property_document_session_active() or public.current_profile_user_id() is distinct from new.requester_user_id
    or new.subject_type<>'account' or new.subject_id is distinct from new.requester_user_id then
   raise exception 'A trusted account session is required for this request' using errcode='42501';
  end if;
 end if;return new;
end $$;
revoke all on function private.personal_data_case_intake() from public,anon,authenticated,service_role;
create trigger personal_data_case_intake before insert on public.operational_cases
 for each row execute function private.personal_data_case_intake();

create function public.get_personal_data_case_review(p_conversation_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare conversation public.partner_support_conversations;case_record public.operational_cases;receipt jsonb;can_respond boolean:=false;
begin
 if public.current_profile_user_id() is null or not public._property_document_session_active()
  or not public.current_actor_can_access_operational_conversation(p_conversation_id,false) then
  raise exception 'This request is unavailable to this account' using errcode='42501';end if;
 select * into conversation from public.partner_support_conversations where id=p_conversation_id;
 select * into case_record from public.operational_cases where operational_case_id=conversation.operational_case_id;
 if case_record.reason_code not in('personal_data_access','personal_data_correction','personal_data_deletion') or case_record.operational_case_id is null then
  raise exception 'This is not a personal-data request' using errcode='22023';end if;
 if public.current_actor_can_access_operational_conversation(p_conversation_id,true)
  and public.current_profile_user_id()<>case_record.requester_user_id
  and case_record.status not in('resolved','closed')
  and (public.current_actor_has_workspace('creator',null) or public.user_has_active_workspace(public.current_profile_user_id(),'admin')) then
  perform private.account_review_authority(case_record.requester_user_id,false,null);can_respond:=true;
 end if;
 select jsonb_build_object('request_id',e.metadata->>'request_id','outcome',e.metadata->>'outcome',
  'completed',e.metadata->>'completed','retained',e.metadata->>'retained','responded_at',e.created_at)
 into receipt from public.operational_case_events e where e.operational_case_id=case_record.operational_case_id
 and e.event_type='personal_data_review_response' order by e.created_at desc,e.case_event_id desc limit 1;
 return jsonb_build_object('conversation_id',p_conversation_id,'case_id',case_record.operational_case_id,
  'case_number',case_record.case_number,'reason_code',case_record.reason_code,'status',case_record.status,
  'revision',conversation.updated_at,'can_respond',can_respond,'response',receipt);
end $$;
revoke all on function public.get_personal_data_case_review(uuid) from public,anon;
grant execute on function public.get_personal_data_case_review(uuid) to authenticated;

-- This records the reviewer's completed work and specific retention/rejection
-- reasons. It does not pretend that a text entry physically erases data. Actual
-- erasure/export actions must be performed and checked before completion is attested.
create function public.respond_to_personal_data_case(p_request_id uuid,p_conversation_id uuid,p_revision timestamptz,
 p_outcome text,p_completed text,p_retained text,p_creator_elevation_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare conversation public.partner_support_conversations;case_record public.operational_cases;actor text;
 completed text:=btrim(coalesce(p_completed,''));retained text:=btrim(coalesce(p_retained,''));
 payload jsonb;existing public.operational_case_events;response_note text;
begin
 actor:=public.current_profile_user_id();
 if actor is null or not public._property_document_session_active()
  or not (public.current_actor_has_workspace('creator',null) or public.user_has_active_workspace(actor,'admin')) then
  raise exception 'Authorised Admin or Creator review required' using errcode='42501';end if;
 select * into conversation from public.partner_support_conversations where id=p_conversation_id for update;
 if conversation.id is null or not public.current_actor_can_access_operational_conversation(p_conversation_id,true) then
  raise exception 'Only the assigned authorised reviewer can record this response' using errcode='42501';end if;
 select * into case_record from public.operational_cases where operational_case_id=conversation.operational_case_id for update;
 if case_record.reason_code not in('personal_data_access','personal_data_correction','personal_data_deletion') or case_record.operational_case_id is null then
  raise exception 'This is not a personal-data request' using errcode='22023';end if;
 perform private.account_review_authority(case_record.requester_user_id,true,p_creator_elevation_id);
 if p_request_id is null or p_revision is null or p_outcome is null or p_outcome not in('completed','partly_completed','not_completed')
  or length(completed)>4000 or length(retained)>4000
  or (p_outcome in('completed','partly_completed') and length(completed)<20)
  or (p_outcome in('partly_completed','not_completed') and length(retained)<20)
  or (p_outcome='completed' and retained<>'') or (p_outcome='not_completed' and completed<>'') then
  raise exception 'Describe the completed work and any information retained, including its specific reason' using errcode='22023';end if;
 payload:=jsonb_build_object('conversation_id',p_conversation_id,'revision',p_revision,'outcome',p_outcome,'completed',completed,'retained',retained);
 select * into existing from public.operational_case_events where event_key='personal_data_response:'||p_request_id;
 if existing.case_event_id is not null then
  if existing.actor_user_id<>actor or existing.operational_case_id<>case_record.operational_case_id or existing.metadata->'payload' is distinct from payload then
   raise exception 'This response key has already been used for different work' using errcode='22023';end if;
  return public.get_personal_data_case_review(p_conversation_id);
 end if;
 if conversation.updated_at is distinct from p_revision or conversation.status not in('assigned','in_progress','waiting_for_user','escalated')
  or case_record.status in('resolved','closed') then raise exception 'Refresh the request before recording its review response' using errcode='40001';end if;
 response_note:='Personal-data review: '||replace(p_outcome,'_',' ')||'.'
  ||case when completed<>'' then E'\n\nWork completed:\n'||completed else '' end
  ||case when retained<>'' then E'\n\nInformation retained or request not completed:\n'||retained else '' end;
 insert into public.operational_case_events(operational_case_id,event_key,event_type,actor_user_id,public_note,metadata)
 values(case_record.operational_case_id,'personal_data_response:'||p_request_id,'personal_data_review_response',actor,response_note,
  jsonb_build_object('request_id',p_request_id,'payload',payload,'outcome',p_outcome,'completed',completed,'retained',retained,
   'resolution_transaction',txid_current()::text));
 perform public.transition_my_support_case(p_conversation_id,'resolve',response_note);
 return public.get_personal_data_case_review(p_conversation_id);
end $$;
revoke all on function public.respond_to_personal_data_case(uuid,uuid,timestamptz,text,text,text,uuid) from public,anon;
grant execute on function public.respond_to_personal_data_case(uuid,uuid,timestamptz,text,text,text,uuid) to authenticated;
