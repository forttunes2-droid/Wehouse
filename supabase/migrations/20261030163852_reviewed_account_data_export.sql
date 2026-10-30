-- Reviewed access requests use the existing case/audit authority. No duplicate
-- identity, task queue, copied data archive, retention period or erasure claim.
create function private.personal_data_export_sources()
returns table(section text,table_name text,owner_column text,key_column text,key_type text,fields text[])
language sql immutable set search_path='' as $$
values
 ('account','profiles','user_id','id','uuid',array['user_id','email','username','full_name','phone','avatar_url','bio','occupation','is_student','school','gender','country','state','city','local_government','area','budget_min','budget_max','preferred_location','pref_email_notif','pref_push_notif','privacy_profile_visible','privacy_search_visible','privacy_activity_visible','privacy_email_visible','privacy_phone_visible','terms_accepted_at','privacy_accepted_at','legal_accepted_version','created_at','updated_at']),
 ('private_location','profiles','user_id','id','uuid',array['precise_latitude','precise_longitude','precise_address','precise_location_accuracy_m','precise_location_updated_at']),
 ('age_information','profile_age_eligibility','user_id','user_id','text',array['date_of_birth','verified_at','updated_at']),
 ('services','worker_services','worker_id','id','uuid',array['id','service_name','price','price_type','description','created_at','updated_at']),
 ('service_area','worker_service_coverage','worker_id','worker_id','text',array['country_code','state','lga','areas','updated_at']),
 ('home_bookings','reservations','user_id','id','text',array['id','listing_id','listing_title','listing_location','status','booking_code','amount','currency','stay_type','stay_check_in','stay_check_out','guest_count','requested_move_in_at','tenancy_start_date','tenancy_end_date','lease_term_months','rent_payment_choice','rent_terms_snapshot','annual_rent_snapshot','contract_rent_total','upfront_rent_required','rent_payment_status','rent_paid_at','created_at','updated_at']),
 ('hotel_bookings','hotel_bookings','user_id','booking_id','integer',array['booking_id','hotel_id','room_id','booking_code','check_in','check_out','guest_count','total_nights','total_price','status','guest_name','guest_phone','special_requests','payment_status','paid_at','rate_plan_name','rate_plan_snapshot','cancellation_snapshot','checked_in_at','checked_out_at','created_at','updated_at']),
 ('service_requests','worker_bookings','user_id','id','uuid',array['id','booking_code','service_type','description','address','scheduled_date','agreed_amount','wehouse_fee','status','customer_message','worker_message','service_quote','service_quote_revision','service_quote_accepted_revision','service_quote_accepted_at','request_attachments','started_at','completed_at','cancellation_reason','refund_amount','created_at','updated_at']),
 ('provided_services','worker_bookings','worker_id','id','uuid',array['id','booking_code','service_type','scheduled_date','agreed_amount','worker_commission','worker_receives','status','worker_message','started_at','completed_at','created_at','updated_at']),
 ('activity_bookings','experience_bookings','customer_user_id','id','uuid',array['id','session_id','activity_id','participants','status','contract','attendance_confirmed_at','host_finished_at','customer_completed_at','cancellation_reason','refund_decision','created_at','updated_at']),
 ('payments','booking_payments','payer_user_id','id','uuid',array['id','payment_reference','booking_type','purpose','amount','amount_total','currency','status','payment_method','paid_at','refund_reason','refund_processed_at','created_at','updated_at']),
 ('wallets','wallets','owner_id','id','uuid',array['id','owner_type','available_balance','pending_balance','frozen_balance','total_withdrawn','bank_name','bank_account_number','bank_account_name','is_frozen','created_at','updated_at']),
 ('requests','operational_cases','requester_user_id','operational_case_id','uuid',array['operational_case_id','case_number','reason_code','subject_type','subject_id','status','priority','resolution_code','resolution_summary','created_at','updated_at','resolved_at','closed_at']),
 ('sent_friend_messages','friend_messages','sender_id','id','uuid',array['id','friend_id','ciphertext','encryption_iv','encryption_version','encrypted_attachments','reply_to_id','created_at']);
$$;
revoke all on function private.personal_data_export_sources() from public,anon,authenticated,service_role;

-- Keep the existing trusted-session, ownership, assignment and review checks.
alter function public.get_personal_data_case_review(uuid) set schema private;
alter function private.get_personal_data_case_review(uuid) rename to personal_data_case_review_before_export;
revoke all on function private.personal_data_case_review_before_export(uuid) from public,anon,authenticated,service_role;

create function public.get_personal_data_case_review(p_conversation_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare receipt jsonb; decision public.operational_case_events; completed_sections jsonb;
begin
 receipt:=private.personal_data_case_review_before_export(p_conversation_id);
 if receipt->>'reason_code'<>'personal_data_access' then return receipt;end if;
 select * into decision from public.operational_case_events
 where operational_case_id=(receipt->>'case_id')::uuid and event_type='personal_data_export_access'
 order by created_at desc,case_event_id desc limit 1;
 select coalesce(jsonb_agg(distinct e.metadata->>'section'),'[]'::jsonb) into completed_sections
 from public.operational_case_events e where e.operational_case_id=(receipt->>'case_id')::uuid
 and e.event_type='personal_data_export_page' and e.metadata->>'approval_id'=decision.metadata->>'request_id'
 and e.metadata->>'next_cursor' is null;
 return receipt||jsonb_build_object('export',jsonb_build_object(
  'decision_id',decision.metadata->>'request_id',
  'approval_id',case when coalesce((decision.metadata->>'allowed')::boolean,false) then decision.metadata->>'request_id' end,
  'can_download',coalesce((decision.metadata->>'allowed')::boolean,false) and exists(
   select 1 from public.operational_cases c where c.operational_case_id=(receipt->>'case_id')::uuid
   and c.requester_user_id=public.current_profile_user_id()),
  'sections',(select jsonb_agg(section order by section) from private.personal_data_export_sources()),
  'prepared_sections',completed_sections,
  'scope_note','Account, location, service, booking, payment, wallet and request records; your own sent Friend messages remain encrypted. Original media, other conversations and supplementary records require the remaining case review.'));
end $$;
revoke all on function public.get_personal_data_case_review(uuid) from public,anon;
grant execute on function public.get_personal_data_case_review(uuid) to authenticated;

create function public.set_personal_data_export_access(p_request_id uuid,p_conversation_id uuid,p_revision timestamptz,
 p_allowed boolean,p_creator_elevation_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); conversation public.partner_support_conversations;
 case_record public.operational_cases; prior public.operational_case_events; payload jsonb;
begin
 if actor is null or not public._property_document_session_active()
 or not (public.current_actor_has_workspace('creator',null) or public.user_has_active_workspace(actor,'admin')) then
  raise exception 'Authorised Admin or Creator review required' using errcode='42501';end if;
 select * into conversation from public.partner_support_conversations where id=p_conversation_id for update;
 if conversation.id is null or not public.current_actor_can_access_operational_conversation(p_conversation_id,true) then
  raise exception 'Only the assigned authorised reviewer can approve an export' using errcode='42501';end if;
 select * into case_record from public.operational_cases where operational_case_id=conversation.operational_case_id for update;
 if case_record.reason_code<>'personal_data_access' or case_record.operational_case_id is null then
  raise exception 'This is not a data-access request' using errcode='22023';end if;
 if actor=case_record.requester_user_id then raise exception 'Independent review required' using errcode='42501';end if;
 perform private.account_review_authority(case_record.requester_user_id,true,p_creator_elevation_id);
 if p_request_id is null or p_revision is null or p_allowed is null then raise exception 'Export decision is incomplete' using errcode='22023';end if;
 payload:=jsonb_build_object('conversation_id',p_conversation_id,'revision',p_revision,'allowed',p_allowed);
 select * into prior from public.operational_case_events where event_key='personal_data_export_access:'||p_request_id;
 if prior.case_event_id is not null then
  if prior.operational_case_id<>case_record.operational_case_id or prior.actor_user_id<>actor or prior.metadata->'payload' is distinct from payload then
   raise exception 'This decision key already belongs to different work' using errcode='22023';end if;
  return public.get_personal_data_case_review(p_conversation_id);
 end if;
 if conversation.updated_at is distinct from p_revision or conversation.status not in('assigned','in_progress','waiting_for_user','escalated')
 or case_record.status in('resolved','closed') then raise exception 'Refresh the request before changing export access' using errcode='40001';end if;
 insert into public.operational_case_events(operational_case_id,event_key,event_type,actor_user_id,public_note,metadata,created_at)
 values(case_record.operational_case_id,'personal_data_export_access:'||p_request_id,'personal_data_export_access',actor,
  case when p_allowed then 'Account-record download approved. Supplementary data remains under review.' else 'Account-record download access withdrawn.' end,
  jsonb_build_object('request_id',p_request_id,'allowed',p_allowed,'payload',payload),clock_timestamp());
 -- This does not resolve the case or attest that any erasure/download occurred.
 update public.partner_support_conversations set updated_at=clock_timestamp() where id=p_conversation_id;
 return public.get_personal_data_case_review(p_conversation_id);
end $$;
revoke all on function public.set_personal_data_export_access(uuid,uuid,timestamptz,boolean,uuid) from public,anon;
grant execute on function public.set_personal_data_export_access(uuid,uuid,timestamptz,boolean,uuid) to authenticated;

create function public.get_my_personal_data_export_page(p_conversation_id uuid,p_approval_id uuid,p_section text,p_cursor text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person text:=public.current_profile_user_id(); case_id uuid; approval public.operational_case_events;
 source record; rows jsonb; result_rows jsonb; next_cursor text; fingerprint text; old_receipt public.operational_case_events;
 command_key text; page_size constant integer:=25;
begin
 if person is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 select c.operational_case_id into case_id from public.operational_cases c join public.partner_support_conversations s
 on s.operational_case_id=c.operational_case_id
 where s.id=p_conversation_id and c.requester_user_id=person and c.subject_id=person
 and c.subject_type='account' and c.reason_code='personal_data_access';
 if case_id is null then raise exception 'This data request is unavailable to this account' using errcode='42501';end if;
 -- Serialize approval, revocation and page receipts through the same case lock.
 perform 1 from public.partner_support_conversations where id=p_conversation_id for update;
 select * into approval from public.operational_case_events where operational_case_id=case_id
 and event_type='personal_data_export_access' order by created_at desc,case_event_id desc limit 1;
 if approval.metadata->>'request_id' is distinct from p_approval_id::text or not coalesce((approval.metadata->>'allowed')::boolean,false) then
  raise exception 'The reviewed export is no longer available. Refresh the request' using errcode='42501';end if;
 select * into source from private.personal_data_export_sources() where section=p_section;
 if source.section is null or p_cursor='' or length(p_cursor)>128 then raise exception 'Invalid export section or cursor' using errcode='22023';end if;
 if p_cursor is not null and not exists(select 1 from public.operational_case_events e
   where e.operational_case_id=case_id and e.event_type='personal_data_export_page'
   and e.metadata->>'approval_id'=p_approval_id::text and e.metadata->>'section'=p_section
   and e.metadata->>'next_cursor'=p_cursor) then raise exception 'Start this export from its first page' using errcode='22023';end if;
 -- Only server-owned identifiers, key types and explicit field allowlists enter SQL.
 -- No auth credentials, provider tokens, internal notes, counterpart bank details,
 -- hidden recipient messages or future added columns enter this projection.
 execute format('select coalesce(jsonb_agg(jsonb_build_object(''cursor'',t.%1$I::text,''record'',
   (select jsonb_object_agg(f,to_jsonb(t)->f) from unnest($4) f)) order by t.%1$I),''[]''::jsonb)
   from (select * from public.%2$I where %3$I=$1 and ($2::%4$s is null or %1$I>$2::%4$s)
   order by %1$I limit $3) t',source.key_column,source.table_name,source.owner_column,source.key_type)
 into rows using person,p_cursor,page_size+1,source.fields;
 if jsonb_array_length(rows)>page_size then
  next_cursor:=rows->(page_size-1)->>'cursor';
 end if;
 select coalesce(jsonb_agg(item->'record' order by ordinal),'[]'::jsonb) into result_rows
 from jsonb_array_elements(rows) with ordinality x(item,ordinal) where ordinal<=page_size;
 fingerprint:=md5(coalesce(p_cursor,''));
 command_key:='personal_data_export_page:'||p_approval_id||':'||p_section||':'||fingerprint;
 select * into old_receipt from public.operational_case_events where event_key=command_key;
 if old_receipt.case_event_id is not null and old_receipt.metadata->>'next_cursor' is distinct from next_cursor then
  raise exception 'These records changed during preparation. Ask WeHouse to refresh export access' using errcode='40001';end if;
 insert into public.operational_case_events(operational_case_id,event_key,event_type,actor_user_id,metadata)
 values(case_id,command_key,'personal_data_export_page',person,jsonb_build_object('approval_id',p_approval_id,
  'section',p_section,'cursor',p_cursor,'next_cursor',next_cursor,'record_count',jsonb_array_length(result_rows)))
 on conflict(event_key) do nothing;
 return jsonb_build_object('conversation_id',p_conversation_id,'approval_id',p_approval_id,'section',p_section,
  'cursor',p_cursor,'next_cursor',next_cursor,'records',result_rows,'prepared_at',clock_timestamp());
end $$;
revoke all on function public.get_my_personal_data_export_page(uuid,uuid,text,text) from public,anon;
grant execute on function public.get_my_personal_data_export_page(uuid,uuid,text,text) to authenticated;

