-- Activities belong to the same Provider identity and review system as services.
alter table public.worker_booking_reviews alter column booking_id drop not null;
alter table public.worker_booking_reviews
 add column experience_booking_id uuid references public.experience_bookings(id) on delete restrict,
 add column hidden_at timestamptz,
 add column moderation_reason text check(length(moderation_reason)<=1000),
 add column moderation_request_id uuid,
 add constraint provider_review_one_booking check(num_nonnulls(booking_id,experience_booking_id)=1),
 add constraint provider_review_experience_unique unique(experience_booking_id);
create index provider_reviews_visible on public.worker_booking_reviews(worker_id,created_at desc,id desc) where hidden_at is null;

create function private.experience_review_earned(b public.experience_bookings) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(b.attendance_confirmed_at is not null and b.host_finished_at is not null
  and b.customer_completed_at is not null and (b.contract->>'ends_at')::timestamptz<=now()
  and exists(select 1 from public.booking_payments p where p.id=b.payment_id
   and p.user_id=b.customer_user_id and p.amount>0)
  and exists(select 1 from public.payment_protection_transactions p where p.id=b.payment_protection_id
   and p.protected_ledger_transaction_id is not null),false);
$$;
create function private.provider_review_earned(r public.worker_booking_reviews) returns boolean
language sql stable security definer set search_path='' as $$
 select r.hidden_at is null and (
  exists(select 1 from public.worker_bookings b where b.id=r.booking_id and b.user_id=r.user_id and b.worker_id=r.worker_id and b.status='approved_released')
  or exists(select 1 from public.experience_bookings b where b.id=r.experience_booking_id and b.customer_user_id=r.user_id and b.host_user_id=r.worker_id and private.experience_review_earned(b))
 );
$$;
revoke all on function private.experience_review_earned(public.experience_bookings),private.provider_review_earned(public.worker_booking_reviews) from public,anon,authenticated,service_role;

create or replace function public.refresh_worker_review_summary(p_worker_id text) returns void
language sql security definer set search_path='' as $$
 update public.profiles p set rating=coalesce(s.average_rating,0),review_count=s.review_total,updated_at=now()
 from(select round(avg(r.rating)::numeric,2) average_rating,count(*)::integer review_total
  from public.worker_booking_reviews r where r.worker_id=p_worker_id and private.provider_review_earned(r)) s
 where p.user_id=p_worker_id;
$$;
revoke all on function public.refresh_worker_review_summary(text) from public,anon,authenticated;

-- Keep the established Service review endpoint, with the same retained record.
do $service$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.submit_my_worker_booking_review(uuid,integer,text)'::regprocedure);
 needle:='  if p_rating not between 1 and 5 then';
 if strpos(definition,needle)=0 then raise exception 'Inspect the canonical Service review write';end if;
 definition:=replace(definition,needle,$new$  if not public._property_document_session_active() or not public.workspace_access_allowed(actor.user_id,'personal') then raise exception 'A trusted, unrestricted Personal session is required';end if;
  if p_rating is null or p_rating not between 1 and 5 then$new$);
 needle:='where r.worker_id=booking.worker_id)summary';
 if strpos(definition,needle)=0 then raise exception 'Inspect the Service review summary';end if;
 execute replace(definition,needle,'where r.worker_id=booking.worker_id and private.provider_review_earned(r))summary');
end $service$;

create function public.get_my_experience_review(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();b public.experience_bookings;r public.worker_booking_reviews;
begin
 if actor is null or not public._property_document_session_active() then raise exception 'Sign in on a trusted device' using errcode='42501';end if;
 select * into b from public.experience_bookings where id=p_booking_id and customer_user_id=actor;
 if b.id is null then raise exception 'Booking unavailable' using errcode='42501';end if;
 select * into r from public.worker_booking_reviews where experience_booking_id=b.id and user_id=actor;
 return jsonb_build_object('booking_id',b.id,'eligible',private.experience_review_earned(b)
  and actor<>b.host_user_id and public.workspace_access_allowed(actor,'personal'),
  'review',case when r.id is null then null else to_jsonb(r) end);
end $$;
create function public.submit_my_experience_review(p_booking_id uuid,p_rating integer,p_comment text default null,p_expected_updated_at timestamptz default null)
returns public.worker_booking_reviews language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();b public.experience_bookings;r public.worker_booking_reviews;note text:=nullif(btrim(coalesce(p_comment,'')),'');
begin
 if actor is null or not public.current_actor_has_personal_workspace() or not public.workspace_access_allowed(actor,'personal') or not public._property_document_session_active() then raise exception 'A trusted, unrestricted Personal session is required' using errcode='42501';end if;
 if p_rating is null or p_rating not between 1 and 5 or length(coalesce(note,''))>1200 then raise exception 'Choose 1 to 5 stars and at most 1200 characters';end if;
 select * into b from public.experience_bookings where id=p_booking_id and customer_user_id=actor for update;
 if b.id is null then raise exception 'Booking unavailable' using errcode='42501';end if;
 if actor=b.host_user_id or not private.experience_review_earned(b) then raise exception 'A paid activity with confirmed attendance and completion is required';end if;
 select * into r from public.worker_booking_reviews where experience_booking_id=b.id for update;
 if r.id is not null then
  if r.rating=p_rating and r.comment is not distinct from note then return r;end if;
  if r.updated_at is distinct from p_expected_updated_at then raise exception 'Your review changed. Refresh before editing';end if;
  update public.worker_booking_reviews set rating=p_rating,comment=note,updated_at=clock_timestamp() where id=r.id returning * into r;
 else
  insert into public.worker_booking_reviews(experience_booking_id,user_id,worker_id,rating,comment)
   values(b.id,actor,b.host_user_id,p_rating,note) returning * into r;
 end if;
 return r;
end $$;
revoke all on function public.get_my_experience_review(uuid),public.submit_my_experience_review(uuid,integer,text,timestamptz) from public,anon,service_role;
grant execute on function public.get_my_experience_review(uuid),public.submit_my_experience_review(uuid,integer,text,timestamptz) to authenticated;

-- The raw table remains participant-readable, never browser-writable.
create function public.can_read_provider_review(p_review_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.current_profile_user_id() is not null and exists(
  select 1 from public.worker_booking_reviews r
  left join public.worker_bookings b on b.id=r.booking_id
  left join public.experience_bookings e on e.id=r.experience_booking_id
  where r.id=p_review_id and public.current_profile_user_id() in(b.user_id,b.worker_id,e.customer_user_id,e.host_user_id));
$$;
revoke all on function public.can_read_provider_review(uuid) from public,anon,service_role;
grant execute on function public.can_read_provider_review(uuid) to authenticated;
drop policy worker_booking_reviews_participant_read on public.worker_booking_reviews;
create policy worker_booking_reviews_participant_read on public.worker_booking_reviews for select to authenticated using(
 public.can_read_provider_review(id)
);

create or replace function public.get_public_worker_reviews(p_worker_id text,p_limit integer default 20)
returns table(id uuid,rating smallint,comment text,created_at timestamptz,reviewer_name text,service_name text)
language sql stable security definer set search_path='' as $$
 select r.id,r.rating,r.comment,r.created_at,
  case when r.user_id=public.current_profile_user_id() then 'Your review' else 'Verified customer' end,
  coalesce(e.contract->>'title',s.name,b.service_type,'Service')
 from public.worker_booking_reviews r
 left join public.worker_bookings b on b.id=r.booking_id
 left join public.service_subcategories s on s.id=b.service_subcategory_id
 left join public.experience_bookings e on e.id=r.experience_booking_id
 where r.worker_id=p_worker_id and private.provider_review_earned(r)
 order by r.created_at desc,r.id desc limit least(greatest(coalesce(p_limit,20),1),50);
$$;
create function public.get_public_experience_reviews(p_activity_id uuid,p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_profile_user_id() is null then raise exception 'Sign in to read reviews' using errcode='42501';end if;
 if not coalesce(private.experience_is_published(p_activity_id),false) then raise exception 'Activity unavailable';end if;
 return jsonb_build_object('summary',(select jsonb_build_object('count',count(*),'rating',round(avg(r.rating)::numeric,2))
  from public.worker_booking_reviews r join public.experience_bookings b on b.id=r.experience_booking_id
  where b.activity_id=p_activity_id and private.provider_review_earned(r)),
  'items',(select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb) from(
   select r.id,r.rating,r.comment,r.created_at,case when r.user_id=public.current_profile_user_id() then 'Your review' else 'Verified participant' end reviewer_name
   from public.worker_booking_reviews r join public.experience_bookings b on b.id=r.experience_booking_id
   where b.activity_id=p_activity_id and private.provider_review_earned(r)
    and (p_before is null or (r.created_at,r.id)<(p_before,p_before_id))
   order by r.created_at desc,r.id desc limit 20)q));
end $$;
revoke all on function public.get_public_experience_reviews(uuid,timestamptz,uuid) from public,anon,service_role;
grant execute on function public.get_public_experience_reviews(uuid,timestamptz,uuid) to authenticated;

-- Keep internal and paid-tool rating summaries consistent with public ratings.
do $summaries$declare signature text;definition text;begin
 foreach signature in array array['public.get_internal_profile_record(text)','public.get_my_worker_work_insights(integer)'] loop
  if to_regprocedure(signature) is null then continue;end if;
  definition:=pg_get_functiondef(to_regprocedure(signature));
  definition:=replace(definition,'r.worker_id=p_target_user_id)','r.worker_id=p_target_user_id and private.provider_review_earned(r))');
  definition:=replace(definition,'where review.worker_id=v_worker and booking.status=''approved_released''','where review.worker_id=v_worker and booking.status=''approved_released'' and review.hidden_at is null');
  execute definition;
 end loop;
end $summaries$;

-- Reports go to the existing moderation queue, with immutable report evidence.
alter table public.content_reports add column content_snapshot jsonb;
alter table public.content_reports drop constraint content_reports_subject_type_check;
alter table public.content_reports add constraint content_reports_subject_type_check check(subject_type in('roommate_chat','friend_chat','worker_chat','hotel_chat','support_case','profile','message','listing','hotel','provider_review'));
create unique index provider_review_open_report on public.content_reports(reporter_user_id,subject_ref,reason) where subject_type='provider_review' and status in('open','reviewing');
create index provider_review_report_budget on public.content_reports(reporter_user_id,created_at desc) where subject_type='provider_review';

create function private.provider_review_place(p_review_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('state',coalesce(e.contract->'activity_details'->>'state',p.state),
  'area',coalesce(e.contract->'activity_details'->>'local_area',p.local_government,p.city),
  'title',coalesce(e.contract->>'title',b.service_type,'Service'))
 from public.worker_booking_reviews r join public.profiles p on p.user_id=r.worker_id
 left join public.experience_bookings e on e.id=r.experience_booking_id
 left join public.worker_bookings b on b.id=r.booking_id where r.id=p_review_id;
$$;
revoke all on function private.provider_review_place(uuid) from public,anon,authenticated,service_role;
do $scope_copy$begin
 execute replace(pg_get_functiondef('public._content_report_in_actor_scope(text,text,text,text,public.profiles)'::regprocedure),
  'FUNCTION public._content_report_in_actor_scope(','FUNCTION private.non_review_report_in_scope(');
end $scope_copy$;
revoke all on function private.non_review_report_in_scope(text,text,text,text,public.profiles) from public,anon,authenticated,service_role;
create or replace function public._content_report_in_actor_scope(p_subject_user_id text,p_subject_type text,p_subject_ref text,p_state_key text,p_actor public.profiles) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare place jsonb;
begin
 if p_subject_type<>'provider_review' then return private.non_review_report_in_scope(p_subject_user_id,p_subject_type,p_subject_ref,p_state_key,p_actor);end if;
 select private.provider_review_place(r.id) into place from public.worker_booking_reviews r where r.id::text=p_subject_ref and r.user_id=p_subject_user_id;
 return place is not null and public.current_actor_in_scope(place->>'state',place->>'area');
end $$;

-- Preserve the report RPC and all of its existing authority branches.
do $reports$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.report_content(text,text,text,text,text)'::regprocedure);
 needle:='  select * into s from public.profiles';
 if strpos(definition,needle)=0 then raise exception 'Inspect the shared report write before adding Provider reviews';end if;
 execute replace(definition,needle,$new$  if p_subject_type='provider_review' then
   return public.report_provider_review(p_subject_ref::uuid,p_reason,p_details);
  end if;
  select * into s from public.profiles$new$);
end $reports$;
create function public.report_provider_review(p_review_id uuid,p_reason text,p_details text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();r public.worker_booking_reviews;place jsonb;receipt uuid;
begin
 if actor is null or not public._property_document_session_active() then raise exception 'A trusted signed-in session is required' using errcode='42501';end if;
 if p_reason is null or p_reason not in('spam','harassment','scam','unsafe','inappropriate','other') or length(coalesce(p_details,''))>1000 then raise exception 'Choose a report reason and at most 1000 characters';end if;
 select * into r from public.worker_booking_reviews where id=p_review_id;
 if r.id is null or actor=r.user_id or not private.provider_review_earned(r) then raise exception 'Review unavailable' using errcode='42501';end if;
 perform 1 from public.profiles where user_id=actor for update;
 select id into receipt from public.content_reports where reporter_user_id=actor and subject_type='provider_review'
  and subject_ref=r.id::text and reason=p_reason and status in('open','reviewing');
 if receipt is not null then return receipt;end if;
 if (select count(*) from public.content_reports where reporter_user_id=actor and subject_type='provider_review' and created_at>now()-interval '10 minutes')>=10 then raise exception 'Too many reports. Please wait';end if;
 place:=private.provider_review_place(r.id);
 insert into public.content_reports(reporter_user_id,subject_user_id,subject_type,subject_ref,reason,details,state_key,content_snapshot)
 values(actor,r.user_id,'provider_review',r.id::text,p_reason,nullif(btrim(coalesce(p_details,'')),''),public.wehouse_state_key(place->>'state'),
  jsonb_build_object('rating',r.rating,'comment',r.comment,'updated_at',r.updated_at,'title',place->>'title'))
 on conflict(reporter_user_id,subject_ref,reason) where subject_type='provider_review' and status in('open','reviewing')
 do update set details=public.content_reports.details returning id into receipt;
 return receipt;
end $$;
revoke all on function public.report_provider_review(uuid,text,text) from public,anon,service_role;
grant execute on function public.report_provider_review(uuid,text,text) to authenticated;

create function public.get_provider_review_moderation(p_report_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;report public.content_reports;r public.worker_booking_reviews;
begin
 if public.current_profile_user_id() is null or not public._property_document_session_active() then raise exception 'Trusted moderation session required' using errcode='42501';end if;
 actor:=public._admin_dashboard_actor();
 select * into report from public.content_reports where id=p_report_id and subject_type='provider_review';
 if report.id is null or not public._content_report_in_actor_scope(report.subject_user_id,report.subject_type,report.subject_ref,report.state_key,actor) then raise exception 'Report outside your coverage' using errcode='42501';end if;
 select * into r from public.worker_booking_reviews where id::text=report.subject_ref;
 return jsonb_build_object('report_id',report.id,'status',report.status,'snapshot',report.content_snapshot,
  'review',to_jsonb(r),'context',private.provider_review_place(r.id),'can_moderate',actor.user_id not in(r.user_id,r.worker_id));
end $$;
create function public.moderate_provider_review(p_report_id uuid,p_hidden boolean,p_note text,p_expected_updated_at timestamptz,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles;report public.content_reports;r public.worker_booking_reviews;
begin
 if public.current_profile_user_id() is null or not public._property_document_session_active() then raise exception 'Trusted moderation session required' using errcode='42501';end if;
 actor:=public._admin_dashboard_actor();
 if p_hidden is null or p_request_id is null or length(btrim(coalesce(p_note,''))) not between 10 and 1000 then raise exception 'A clear moderation reason is required';end if;
 select * into report from public.content_reports where id=p_report_id and subject_type='provider_review' for update;
 if report.id is null or not public._content_report_in_actor_scope(report.subject_user_id,report.subject_type,report.subject_ref,report.state_key,actor) then raise exception 'Report outside your coverage' using errcode='42501';end if;
 select * into r from public.worker_booking_reviews where id::text=report.subject_ref for update;
 if r.id is null or actor.user_id in(r.user_id,r.worker_id) then raise exception 'Another authorized moderator must decide this review';end if;
 if r.moderation_request_id=p_request_id then
  if (r.hidden_at is not null) is distinct from p_hidden or r.moderation_reason is distinct from btrim(p_note) then raise exception 'This request reference was already used';end if;
  return public.get_provider_review_moderation(report.id);
 end if;
 if r.updated_at is distinct from p_expected_updated_at then raise exception 'Review changed. Refresh before deciding';end if;
 update public.worker_booking_reviews set hidden_at=case when p_hidden then now() end,moderation_reason=btrim(p_note),moderation_request_id=p_request_id,updated_at=clock_timestamp() where id=r.id;
 update public.content_reports set status=case when p_hidden then 'actioned' else 'dismissed' end,resolution_note=btrim(p_note),resolved_by=actor.user_id,resolved_at=now() where id=report.id;
 insert into public.audit_logs(action,target_type,target_id,admin_id,details)
 values('PROVIDER_REVIEW_MODERATED','worker_booking_reviews',r.id::text,actor.user_id,jsonb_build_object('report_id',report.id,'request_id',p_request_id,'hidden',p_hidden,'reason',btrim(p_note))::text);
 insert into public.notifications(recipient_id,type,title,message,source_type,source_id,destination_route,destination_params,event_key,workspace_scope)
 values(r.user_id,'provider_review_moderation',case when p_hidden then 'Your review was hidden' else 'Your review is visible' end,btrim(p_note),
  case when r.experience_booking_id is not null then 'experience_booking' else 'worker_booking' end,
  coalesce(r.experience_booking_id,r.booking_id)::text,
  case when r.experience_booking_id is not null then 'experience_booking' when exists(select 1 from public.booking_conversations c where c.booking_id=r.booking_id) then 'conversation' else 'my_bookings' end,
  jsonb_build_object('review_reference',r.id,'booking_id',coalesce(r.experience_booking_id,r.booking_id),
   'conversation_id',(select c.id from public.booking_conversations c where c.booking_id=r.booking_id limit 1)),
  'provider-review-moderation:'||p_request_id,'personal');
 return public.get_provider_review_moderation(report.id);
end $$;
revoke all on function public.get_provider_review_moderation(uuid),public.moderate_provider_review(uuid,boolean,text,timestamptz,uuid) from public,anon,service_role;
grant execute on function public.get_provider_review_moderation(uuid),public.moderate_provider_review(uuid,boolean,text,timestamptz,uuid) to authenticated;

-- Generic report controls may mark this evidence as under review, but cannot
-- claim to have hidden/restored a review without the atomic moderation action.
do $guard_resolution$declare definition text;needle text:='  update public.content_reports r';begin
 definition:=pg_get_functiondef('public.admin_resolve_content_report(uuid,text,text)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'Inspect the canonical report resolution';end if;
 execute replace(definition,needle,$new$  if p_status in('actioned','dismissed') and exists(select 1 from public.content_reports where id=p_report_id and subject_type='provider_review') then raise exception 'Use the review moderation decision to change visibility and close this report';end if;
  update public.content_reports r$new$);
end $guard_resolution$;
