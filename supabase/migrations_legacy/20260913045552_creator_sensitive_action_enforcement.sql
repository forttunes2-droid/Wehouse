-- Sensitive Creator actions require a current, session-bound elevation grant.
-- Admin keeps ordinary State-scoped authority; the Creator cannot bypass
-- reauthentication by calling an older Admin or table path directly.

create or replace function public._worker_review_trust_payload(p_worker_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_worker public.profiles;
  v_ver public.worker_verifications;
  v_identity public.worker_identity_checks;
  v_payment boolean:=false;
begin
  select * into v_worker from public.profiles
  where user_id=p_worker_id and role='worker' limit 1;
  if v_worker.user_id is null then raise exception 'Worker not found'; end if;
  select * into v_ver from public.worker_verifications
  where worker_id=p_worker_id limit 1;
  select * into v_identity from public.worker_identity_checks
  where worker_id=p_worker_id;
  select exists(select 1 from public.booking_payments
    where user_id=p_worker_id and purpose='worker_verification'
      and status in('paid','completed')) into v_payment;
  return jsonb_build_object(
    'payment_confirmed',v_payment,
    'identity_status',case when public.worker_identity_is_current(p_worker_id)
      then 'passed' else coalesce(v_identity.status,'not_started') end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',public.worker_identity_is_current(p_worker_id),
    'face_match_score',v_identity.face_match_score,
    'liveness_score',v_identity.liveness_score,
    'anti_spoof_score',v_identity.anti_spoof_score,
    'readiness_passed',true,'readiness_percent',100,
    'evidence_saved',coalesce(nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is not null,false),
    'certificate_path',v_ver.certificate_path,
    'verification_video_url',v_ver.verification_video_url,
    'submitted',coalesce(v_ver.submitted_at is not null,false),
    'review_status',v_ver.status
  );
end
$$;

create or replace function public.admin_get_worker_review_trust_status(
  p_worker_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_worker public.profiles;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role in('staff','admin')
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then
    raise exception 'State Worker Operations or Admin access required';
  end if;
  if v_actor.role='staff'
     and not public.current_staff_has_permission('worker_operations') then
    raise exception 'Worker Operations access required';
  end if;
  select * into v_worker from public.profiles
  where user_id=p_worker_id and role='worker';
  if v_worker.user_id is null or public.wehouse_state_key(v_worker.state)
     <>public.wehouse_state_key(v_actor.assigned_state) then
    raise exception 'Worker is outside your assigned State';
  end if;
  return public._worker_review_trust_payload(p_worker_id);
end
$$;

create or replace function public.creator_get_worker_review_trust_status(
  p_worker_id text,p_creator_elevation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if not public.creator_has_elevation(
    p_creator_elevation_id,'private_evidence'
  ) then raise exception 'Recent Creator authentication required'; end if;
  return public._worker_review_trust_payload(p_worker_id);
end
$$;

create or replace function public.creator_review_worker(
  p_worker_id text,p_decision text,p_reason text,p_creator_elevation_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_worker public.profiles;
  v_ver public.worker_verifications;
begin
  if not public.creator_has_elevation(
    p_creator_elevation_id,'private_evidence'
  ) then raise exception 'Recent Creator authentication required'; end if;
  select * into v_worker from public.profiles
  where user_id=p_worker_id and role='worker' and not coalesce(deleted,false)
  for update;
  if v_worker.user_id is null then raise exception 'Worker not found'; end if;
  if v_worker.worker_status<>'profile_under_review' then
    raise exception 'Worker is not in the review queue'; end if;
  select * into v_ver from public.worker_verifications
  where worker_id=p_worker_id limit 1;
  if p_decision='approve' then
    if not public.worker_identity_is_current(p_worker_id) then
      raise exception 'The current private face check has not passed'; end if;
    if v_ver.id is null or nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is null then
      raise exception 'Professional work evidence is incomplete'; end if;
    update public.profiles set worker_status='verified',worker_verified=true,
      available=true,updated_at=now(),updated_by=v_actor where user_id=p_worker_id;
    update public.worker_verifications set status='verified',reviewed_by=v_actor,
      reviewed_at=now(),updated_at=now() where id=v_ver.id;
  elsif p_decision='reject' then
    if nullif(btrim(coalesce(p_reason,'')),'') is null then
      raise exception 'Rejection reason is required'; end if;
    update public.profiles set worker_status='rejected',worker_verified=false,
      available=false,updated_at=now(),updated_by=v_actor where user_id=p_worker_id;
    update public.worker_verifications set status='rejected',reviewed_by=v_actor,
      review_notes=btrim(p_reason),reviewed_at=now(),updated_at=now()
    where id=v_ver.id;
  else raise exception 'Decision must be approve or reject'; end if;
  insert into public.worker_verification_reviews(
    worker_id,reviewer_id,reviewer_role,action,rejection_reason
  ) values(p_worker_id,v_actor,'creator',
    case when p_decision='approve' then 'approved' else 'rejected' end,
    case when p_decision='reject' then btrim(p_reason) end);
  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(v_actor,'creator_worker_review','worker',p_worker_id,
    jsonb_build_object('decision',p_decision,
      'creator_elevation_id',p_creator_elevation_id)::text,now());
end
$$;

create or replace function public._set_account_suspension(
  p_actor_user_id text,p_target_user_id text,p_suspended boolean,p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_target public.profiles;
begin
  select * into v_target from public.profiles
  where user_id=p_target_user_id for update;
  if v_target.user_id is null then raise exception 'Target account not found'; end if;
  if v_target.user_id=p_actor_user_id then raise exception 'Cannot change your own access'; end if;
  if v_target.role='creator' then raise exception 'Cannot modify Creator'; end if;
  if p_suspended then
    if coalesce(v_target.deleted,false) or coalesce(v_target.banned,false) then
      raise exception 'Deleted or banned accounts cannot be suspended'; end if;
    update public.profiles set suspended=true,suspended_at=now(),
      suspended_by=p_actor_user_id,
      suspended_reason=coalesce(nullif(btrim(p_reason),''),'Administrative suspension'),
      worker_status=case when role='worker' then 'suspended' else worker_status end,
      updated_by=p_actor_user_id,updated_at=now()
    where user_id=p_target_user_id;
  else
    if coalesce(v_target.deleted,false) or coalesce(v_target.banned,false) then
      raise exception 'Deleted or banned accounts cannot be reactivated'; end if;
    if not coalesce(v_target.suspended,false) then
      raise exception 'Account is not suspended'; end if;
    update public.profiles set suspended=false,suspended_at=null,
      suspended_by=null,suspended_reason=null,
      worker_status=case when role='worker' then 'pending' else worker_status end,
      updated_by=p_actor_user_id,updated_at=now()
    where user_id=p_target_user_id;
  end if;
  insert into public.audit_logs(
    action,target_type,target_id,details,admin_id
  ) values(case when p_suspended then 'SUSPEND' else 'REACTIVATE' end,
    'profiles',p_target_user_id,jsonb_build_object('reason',nullif(btrim(p_reason),''))::text,
    p_actor_user_id);
end
$$;

create or replace function public.admin_suspend_user(
  p_target_user_id text,p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'admin' then
    raise exception 'Creator must use recent authenticated oversight'; end if;
  perform public._assert_admin_lga_scope(p_target_user_id);
  perform public._set_account_suspension(
    v_actor.user_id,p_target_user_id,true,p_reason
  );
end
$$;

create or replace function public.admin_reactivate_user(p_target_user_id text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'admin' then
    raise exception 'Creator must use recent authenticated oversight'; end if;
  perform public._assert_admin_lga_scope(p_target_user_id);
  perform public._set_account_suspension(
    v_actor.user_id,p_target_user_id,false,null
  );
end
$$;

create or replace function public.creator_set_account_suspension(
  p_target_user_id text,p_suspended boolean,p_reason text,
  p_creator_elevation_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if not public.creator_has_elevation(
    p_creator_elevation_id,'all_sensitive'
  ) then raise exception 'Recent Creator authentication required'; end if;
  perform public._set_account_suspension(
    v_actor,p_target_user_id,p_suspended,p_reason
  );
  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(v_actor,'creator_account_access_change','profile',p_target_user_id,
    jsonb_build_object('suspended',p_suspended,
      'creator_elevation_id',p_creator_elevation_id)::text,now());
end
$$;

create or replace function public.admin_ban_user(
  p_target_user_id text,p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_target public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  if v_actor.role<>'admin' then
    raise exception 'Creator must use recent authenticated oversight'; end if;
  perform public._assert_admin_lga_scope(p_target_user_id);
  select * into v_target from public.profiles where user_id=p_target_user_id for update;
  if v_target.user_id is null or v_target.user_id=v_actor.user_id
     or v_target.role='creator' then raise exception 'Protected account'; end if;
  update public.profiles set banned=true,banned_at=now(),banned_by=v_actor.user_id,
    banned_reason=coalesce(nullif(btrim(p_reason),''),'Account permanently banned'),
    deleted=true,deleted_at=now(),
    worker_status=case when role='worker' then 'suspended' else worker_status end,
    updated_by=v_actor.user_id,updated_at=now() where user_id=p_target_user_id;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id)
  values('BAN','profiles',p_target_user_id,
    jsonb_build_object('reason',coalesce(nullif(btrim(p_reason),''),'Account permanently banned'))::text,
    v_actor.user_id);
end
$$;

create or replace function public.creator_ban_user(
  p_target_user_id text,p_reason text,p_creator_elevation_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_target public.profiles;
begin
  if not public.creator_has_elevation(
    p_creator_elevation_id,'all_sensitive'
  ) then raise exception 'Recent Creator authentication required'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'Ban reason is required'; end if;
  select * into v_target from public.profiles where user_id=p_target_user_id for update;
  if v_target.user_id is null or v_target.user_id=v_actor
     or v_target.role='creator' then raise exception 'Protected account'; end if;
  update public.profiles set banned=true,banned_at=now(),banned_by=v_actor,
    banned_reason=btrim(p_reason),deleted=true,deleted_at=now(),
    worker_status=case when role='worker' then 'suspended' else worker_status end,
    updated_by=v_actor,updated_at=now() where user_id=p_target_user_id;
  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(v_actor,'creator_account_ban','profile',p_target_user_id,
    jsonb_build_object('reason',btrim(p_reason),
      'creator_elevation_id',p_creator_elevation_id)::text,now());
end
$$;

create or replace function public.creator_reject_property_submission(
  p_inspection_id uuid,p_reason text,p_creator_elevation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; v_request public.inspection_requests;
begin
  if not public.creator_has_elevation(
    p_creator_elevation_id,'all_sensitive'
  ) then raise exception 'Recent Creator authentication required'; end if;
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and role='creator';
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'A rejection reason is required'; end if;
  select * into v_request from public.inspection_requests
  where id=p_inspection_id for update;
  if v_request.id is null then raise exception 'Property submission not found'; end if;
  if v_request.published_at is not null then
    raise exception 'A published property must be handled from Published listings'; end if;
  if v_request.draft_listing_id is not null and exists(
    select 1 from public.reservations r
    where r.listing_id=v_request.draft_listing_id::text
      and r.status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
  ) then raise exception 'This draft has an active reservation and cannot be rejected'; end if;
  if v_request.draft_listing_id is not null then
    update public.listings set deleted_at=now(),status='closed',
      availability_status='unavailable',updated_at=now()
    where id=v_request.draft_listing_id and deleted_at is null;
  end if;
  if v_request.draft_hotel_id is not null then
    update public.hotels set status='rejected',updated_at=now()
    where hotel_id=v_request.draft_hotel_id;
  end if;
  update public.inspection_requests set status='rejected',
    rejection_reason=btrim(p_reason),assigned_to=null,
    assigned_field_officer_id=null,field_officer_id=null,
    scheduled_date=null,updated_at=now() where id=p_inspection_id;
  insert into public.audit_logs(
    action,target_type,target_id,details,admin_id,admin_email
  ) values('PROPERTY_SUBMISSION_REJECTED','inspection_requests',
    p_inspection_id::text,jsonb_build_object('reason',btrim(p_reason),
      'request_code',v_request.request_code,
      'creator_elevation_id',p_creator_elevation_id)::text,
    v_actor.user_id,v_actor.email);
  return true;
end
$$;

create or replace function public.creator_reject_property_submission(
  p_inspection_id uuid,p_reason text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$ begin raise exception 'Recent Creator authentication required'; end $$;

create or replace function public.creator_delete_announcement(
  p_announcement_id bigint,p_creator_elevation_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if not public.creator_has_elevation(
    p_creator_elevation_id,'all_sensitive'
  ) then raise exception 'Recent Creator authentication required'; end if;
  if not exists(select 1 from public.announcements where id=p_announcement_id) then
    raise exception 'Announcement not found'; end if;
  delete from public.announcements where id=p_announcement_id;
  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(v_actor,'creator_announcement_delete','announcement',
    p_announcement_id::text,jsonb_build_object(
      'creator_elevation_id',p_creator_elevation_id)::text,now());
end
$$;

drop policy if exists announcements_sender_delete on public.announcements;
create policy announcements_admin_sender_delete on public.announcements
for delete to authenticated
using(current_profile_role()='admin' and sender_id=current_profile_user_id());

create or replace function public.creator_set_maintenance_exempt(
  p_target_user_id text,p_exempt boolean,p_creator_elevation_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id();
begin
  if not public.creator_has_elevation(
    p_creator_elevation_id,'all_sensitive'
  ) then raise exception 'Recent Creator authentication required'; end if;
  if not exists(select 1 from public.profiles
    where user_id=p_target_user_id and role<>'creator') then
    raise exception 'Target account not found or protected'; end if;
  update public.profiles set maintenance_exempt=p_exempt,
    updated_by=v_actor,updated_at=now() where user_id=p_target_user_id;
  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(v_actor,'creator_maintenance_exception','profile',p_target_user_id,
    jsonb_build_object('exempt',p_exempt,
      'creator_elevation_id',p_creator_elevation_id)::text,now());
end
$$;

create or replace function public.admin_toggle_exempt(
  target_user_id text,exempt boolean
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$ begin raise exception 'Recent Creator authentication required'; end $$;

revoke all on function public._worker_review_trust_payload(text)
  from public,anon,authenticated;
revoke all on function public._set_account_suspension(text,text,boolean,text)
  from public,anon,authenticated;
grant execute on function public._worker_review_trust_payload(text) to service_role;
grant execute on function public._set_account_suspension(text,text,boolean,text) to service_role;

revoke all on function public.creator_reject_property_submission(uuid,text)
  from public,anon,authenticated;
revoke all on function public.admin_toggle_exempt(text,boolean)
  from public,anon,authenticated;
grant execute on function public.creator_reject_property_submission(uuid,text) to service_role;
grant execute on function public.admin_toggle_exempt(text,boolean) to service_role;

revoke all on function public.creator_get_worker_review_trust_status(text,uuid)
  from public,anon;
revoke all on function public.creator_review_worker(text,text,text,uuid)
  from public,anon;
revoke all on function public.creator_set_account_suspension(text,boolean,text,uuid)
  from public,anon;
revoke all on function public.creator_ban_user(text,text,uuid)
  from public,anon;
revoke all on function public.creator_reject_property_submission(uuid,text,uuid)
  from public,anon;
revoke all on function public.creator_delete_announcement(bigint,uuid)
  from public,anon;
revoke all on function public.creator_set_maintenance_exempt(text,boolean,uuid)
  from public,anon;
grant execute on function public.creator_get_worker_review_trust_status(text,uuid),
  public.creator_review_worker(text,text,text,uuid),
  public.creator_set_account_suspension(text,boolean,text,uuid),
  public.creator_ban_user(text,text,uuid),
  public.creator_reject_property_submission(uuid,text,uuid),
  public.creator_delete_announcement(bigint,uuid),
  public.creator_set_maintenance_exempt(text,boolean,uuid)
to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,'definer',
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  case when p.proname in('_worker_review_trust_payload','_set_account_suspension')
    then 'approved_service_only' else 'approved_client_rpc' end,
  case when p.proname in('_worker_review_trust_payload','_set_account_suspension')
    then 'Internal implementation helper; direct client execution is removed.'
    else 'Sensitive Creator action requiring a current session-bound elevation grant.' end,
  now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  '_worker_review_trust_payload','_set_account_suspension',
  'creator_get_worker_review_trust_status','creator_review_worker',
  'creator_set_account_suspension','creator_ban_user',
  'creator_delete_announcement','creator_set_maintenance_exempt'
)
or (n.nspname='public' and p.oid::regprocedure::text=
  'creator_reject_property_submission(uuid,text,uuid)')
on conflict(function_signature) do update set
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,
  captured_at=excluded.captured_at;

update public.function_execution_registry set
  public_allowed=false,anon_allowed=false,authenticated_allowed=false,
  service_role_allowed=true,review_state='approved_service_only',
  rationale='Legacy Creator bypass disabled; use the elevation-bound overload.',
  captured_at=now()
where function_signature in(
  'creator_reject_property_submission(uuid,text)',
  'admin_toggle_exempt(text,boolean)'
);
