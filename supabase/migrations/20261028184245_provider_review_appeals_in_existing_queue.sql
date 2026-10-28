-- A reviewer appeals the visibility decision in the existing Reports queue.
-- This is not an accusation against the Provider and does not change bookings,
-- payments, earned evidence or independent workspace approvals.
alter table public.content_reports drop constraint content_reports_subject_type_check;
alter table public.content_reports add constraint content_reports_subject_type_check check(subject_type in('roommate_chat','friend_chat','worker_chat','hotel_chat','support_case','profile','message','listing','hotel','provider_review','provider_review_appeal'));
alter table public.content_reports drop constraint content_reports_check;
alter table public.content_reports add constraint content_reports_check check(
 (subject_type='provider_review_appeal' and reporter_user_id=subject_user_id)
 or (subject_type<>'provider_review_appeal' and reporter_user_id<>subject_user_id)
);
create unique index provider_review_appeal_revision on public.content_reports(reporter_user_id,subject_ref,(content_snapshot->>'moderation_request_id')) where subject_type='provider_review_appeal';
create unique index provider_review_appeal_request on public.content_reports(reporter_user_id,(content_snapshot->>'request_id')) where subject_type='provider_review_appeal';
create index provider_review_appeal_budget on public.content_reports(reporter_user_id,created_at desc) where subject_type='provider_review_appeal';

create function public.get_my_provider_review_appeal(p_review_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();r public.worker_booking_reviews;appeal public.content_reports;
begin
 if actor is null or not public._property_document_session_active() then raise exception 'A trusted signed-in session is required' using errcode='42501';end if;
 select * into r from public.worker_booking_reviews where id=p_review_id and user_id=actor;
 if r.id is null then raise exception 'Your review is unavailable' using errcode='42501';end if;
 select * into appeal from public.content_reports where reporter_user_id=actor and subject_type='provider_review_appeal' and subject_ref=r.id::text
  and (content_snapshot->>'moderation_request_id'=r.moderation_request_id::text or content_snapshot->>'result_moderation_request_id'=r.moderation_request_id::text)
  order by created_at desc,id desc limit 1;
 return jsonb_build_object('review_id',r.id,'moderation_request_id',r.moderation_request_id,
  'eligible',r.hidden_at is not null and r.moderation_request_id is not null and appeal.id is null,
  'appeal',case when appeal.id is not null then jsonb_build_object('id',appeal.id,'status',appeal.status,'explanation',appeal.details,
   'created_at',appeal.created_at,'resolved_at',appeal.resolved_at,'decision',appeal.resolution_note,'outcome',appeal.content_snapshot->>'outcome') end);
end $$;

create function public.submit_my_provider_review_appeal(p_review_id uuid,p_moderation_request_id uuid,p_explanation text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();r public.worker_booking_reviews;appeal public.content_reports;place jsonb;
begin
 if actor is null or not public._property_document_session_active() then raise exception 'A trusted signed-in session is required' using errcode='42501';end if;
 if p_request_id is null or p_moderation_request_id is null or length(btrim(coalesce(p_explanation,''))) not between 10 and 1000 then raise exception 'Explain your appeal in 10 to 1000 characters';end if;
 -- Serialize an account's submissions for bounded creation and safe retries.
 perform 1 from public.profiles where user_id=actor for update;
 select * into r from public.worker_booking_reviews where id=p_review_id and user_id=actor for update;
 if r.id is null then raise exception 'Your review is unavailable' using errcode='42501';end if;
 select * into appeal from public.content_reports where reporter_user_id=actor and subject_type='provider_review_appeal' and content_snapshot->>'request_id'=p_request_id::text;
 if appeal.id is not null then
  if appeal.subject_ref<>r.id::text or appeal.content_snapshot->>'moderation_request_id'<>p_moderation_request_id::text or appeal.details<>btrim(p_explanation) then raise exception 'This appeal reference was already used';end if;
  return public.get_my_provider_review_appeal(r.id);
 end if;
 if r.hidden_at is null or r.moderation_request_id is distinct from p_moderation_request_id then raise exception 'Review decision changed. Refresh before appealing';end if;
 if not (public.get_my_provider_review_appeal(r.id)->>'eligible')::boolean then return public.get_my_provider_review_appeal(r.id);end if;
 if (select count(*) from public.content_reports where reporter_user_id=actor and subject_type='provider_review_appeal' and created_at>now()-interval '10 minutes')>=5 then raise exception 'Too many appeals. Please wait';end if;
 place:=private.provider_review_place(r.id);
 insert into public.content_reports(reporter_user_id,subject_user_id,subject_type,subject_ref,reason,details,state_key,content_snapshot)
 values(actor,actor,'provider_review_appeal',r.id::text,'other',btrim(p_explanation),public.wehouse_state_key(place->>'state'),
  jsonb_build_object('kind','review_appeal','rating',r.rating,'comment',r.comment,'updated_at',r.updated_at,'title',place->>'title',
   'moderation_request_id',r.moderation_request_id,'moderation_reason',r.moderation_reason,'request_id',p_request_id));
 return public.get_my_provider_review_appeal(r.id);
end $$;
revoke all on function public.get_my_provider_review_appeal(uuid),public.submit_my_provider_review_appeal(uuid,uuid,text,uuid) from public,anon,service_role;
grant execute on function public.get_my_provider_review_appeal(uuid),public.submit_my_provider_review_appeal(uuid,uuid,text,uuid) to authenticated;

-- Extend the existing geographic authority and atomic moderation command.
-- Fail replay if its inspected definition changed rather than silently weakening it.
do $extend$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public._content_report_in_actor_scope(text,text,text,text,public.profiles)'::regprocedure);
 needle:='if p_subject_type<>''provider_review'' then';
 if strpos(definition,needle)=0 then raise exception 'Inspect review report coverage before extending appeals';end if;
 execute replace(definition,needle,'if p_subject_type not in(''provider_review'',''provider_review_appeal'') then');

 definition:=pg_get_functiondef('public.report_content(text,text,text,text,text)'::regprocedure);
 needle:='if p_subject_type=''provider_review'' then';
 if strpos(definition,needle)=0 then raise exception 'Inspect the shared report command';end if;
 execute replace(definition,needle,'if p_subject_type=''provider_review_appeal'' then raise exception ''Use the tracked review appeal command'';end if; '||needle);

 definition:=pg_get_functiondef('public.get_provider_review_moderation(uuid)'::regprocedure);
 needle:='subject_type=''provider_review''';
 if strpos(definition,needle)=0 then raise exception 'Inspect review evidence projection';end if;
 definition:=replace(definition,needle,'subject_type in(''provider_review'',''provider_review_appeal'')');
 definition:=replace(definition,'''snapshot'',report.content_snapshot,','''snapshot'',report.content_snapshot||case when report.subject_type=''provider_review_appeal'' then jsonb_build_object(''explanation'',report.details) else ''{}''::jsonb end,');
 definition:=replace(definition,'actor.user_id not in(r.user_id,r.worker_id)',
  'actor.user_id not in(r.user_id,r.worker_id) and (report.subject_type<>''provider_review_appeal'' or (report.status in(''open'',''reviewing'') and report.content_snapshot->>''moderation_request_id''=r.moderation_request_id::text))');
 execute definition;

 definition:=pg_get_functiondef('public.moderate_provider_review(uuid,boolean,text,timestamptz,uuid)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'Inspect atomic review decision';end if;
 definition:=replace(definition,needle,'subject_type in(''provider_review'',''provider_review_appeal'')');
 -- All decisions lock the review before any report to avoid opposing report /
 -- appeal decisions deadlocking while they resolve the other pending record.
 definition:=replace(definition,'and subject_type in(''provider_review'',''provider_review_appeal'') for update;',
  'and subject_type in(''provider_review'',''provider_review_appeal'');');
 needle:='if r.id is null or actor.user_id in(r.user_id,r.worker_id) then';
 if strpos(definition,needle)=0 then raise exception 'Inspect the review moderator lock order';end if;
 definition:=replace(definition,needle,'select * into report from public.content_reports where id=p_report_id for update; '||needle);
 needle:='if r.updated_at is distinct from p_expected_updated_at then';
 if strpos(definition,needle)=0 then raise exception 'Inspect review stale decision guard';end if;
 definition:=replace(definition,needle,$guard$if report.subject_type='provider_review_appeal' and (report.status not in('open','reviewing') or report.content_snapshot->>'moderation_request_id' is distinct from r.moderation_request_id::text) then raise exception 'Appeal decision changed. Refresh the review';end if;
 if r.updated_at is distinct from p_expected_updated_at then$guard$);
 needle:='resolved_at=now() where id=report.id;';
 if strpos(definition,needle)=0 then raise exception 'Inspect report decision receipt';end if;
 definition:=replace(definition,needle,$receipt$resolved_at=now(),content_snapshot=case when report.subject_type='provider_review_appeal' then content_snapshot||jsonb_build_object('result_moderation_request_id',p_request_id,'outcome',case when p_hidden then 'upheld' else 'restored' end) else content_snapshot end where id=report.id;
 -- A newer authoritative decision also resolves an older pending appeal.
 update public.content_reports set status='dismissed',resolution_note='A newer review decision was recorded: '||btrim(p_note),resolved_by=actor.user_id,resolved_at=now(),
  content_snapshot=content_snapshot||jsonb_build_object('result_moderation_request_id',p_request_id,'outcome','superseded')
 where subject_type='provider_review_appeal' and subject_ref=r.id::text and id<>report.id and status in('open','reviewing');$receipt$);
 execute definition;

 definition:=pg_get_functiondef('public.admin_resolve_content_report(uuid,text,text)'::regprocedure);
 needle:='subject_type=''provider_review''';
 if strpos(definition,needle)=0 then raise exception 'Inspect generic report closure guard';end if;
 execute replace(definition,needle,'subject_type in(''provider_review'',''provider_review_appeal'')');
end $extend$;
