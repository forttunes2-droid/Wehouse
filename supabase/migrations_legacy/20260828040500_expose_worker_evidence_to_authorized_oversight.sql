create or replace function public.admin_get_worker_review_trust_status(p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_worker public.profiles;
  v_ver public.worker_verifications;
  v_identity public.worker_identity_checks;
  v_payment boolean:=false;
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role in ('staff','admin','creator')
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if v_actor is null then raise exception 'Worker oversight access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('verification') then
    raise exception 'Verification Staff permission required';
  end if;

  select * into v_worker from public.profiles where user_id=p_worker_id and role='worker' limit 1;
  if v_worker is null then raise exception 'Worker not found'; end if;
  if v_actor.role in ('staff','admin')
     and (v_actor.assigned_state is distinct from v_worker.state
       or v_actor.assigned_lga is distinct from coalesce(v_worker.local_government,v_worker.city)) then
    raise exception 'Worker is outside your assigned branch';
  end if;

  select * into v_ver from public.worker_verifications where worker_id=p_worker_id limit 1;
  select * into v_identity from public.worker_identity_checks where worker_id=p_worker_id;
  select exists(
    select 1 from public.booking_payments
    where user_id=p_worker_id and purpose='worker_verification' and status in ('paid','completed')
  ) into v_payment;

  return jsonb_build_object(
    'payment_confirmed',v_payment,
    'identity_status',case when public.worker_identity_is_current(p_worker_id) then 'passed' else coalesce(v_identity.status,'not_started') end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',public.worker_identity_is_current(p_worker_id),
    'face_match_score',v_identity.face_match_score,
    'liveness_score',v_identity.liveness_score,
    'anti_spoof_score',v_identity.anti_spoof_score,
    'readiness_passed',true,
    'readiness_percent',100,
    'evidence_saved',coalesce(nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is not null,false),
    'certificate_path',v_ver.certificate_path,
    'verification_video_url',v_ver.verification_video_url,
    'submitted',coalesce(v_ver.submitted_at is not null,false),
    'review_status',v_ver.status
  );
end;
$$;

revoke execute on function public.admin_get_worker_review_trust_status(text) from public,anon;
grant execute on function public.admin_get_worker_review_trust_status(text) to authenticated,service_role;
