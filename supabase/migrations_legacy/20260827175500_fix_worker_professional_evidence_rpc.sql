create or replace function public.save_my_worker_professional_evidence(
  p_certificate_path text,
  p_video_path text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_profile public.profiles;
  v_paid boolean;
  v_id uuid;
begin
  select * into v_profile
  from public.profiles
  where auth_id=auth.uid()::text and role='worker'
    and coalesce(deleted,false)=false
    and coalesce(suspended,false)=false
    and coalesce(banned,false)=false
  limit 1;
  if v_profile is null then raise exception 'Active Worker account required'; end if;
  if v_profile.worker_status='verified' then raise exception 'Live Worker evidence changes require a new review process'; end if;
  if not public.worker_professional_profile_ready(v_profile.user_id) then raise exception 'Complete your professional profile and service coverage first'; end if;
  if not public.worker_identity_is_current(v_profile.user_id) then raise exception 'Complete the current private WeHouse face check first'; end if;

  select exists(
    select 1 from public.booking_payments
    where user_id=v_profile.user_id and purpose='worker_verification' and status in ('paid','completed')
  ) into v_paid;
  if not v_paid then raise exception 'Verified Paystack payment is required first'; end if;
  if nullif(btrim(coalesce(p_video_path,'')),'') is null then raise exception 'Skill demonstration video is required'; end if;
  if split_part(p_video_path,'/',1)<>v_profile.user_id then raise exception 'Invalid Worker video path'; end if;
  if nullif(btrim(coalesce(p_certificate_path,'')),'') is not null
     and split_part(p_certificate_path,'/',1)<>v_profile.user_id then
    raise exception 'Invalid Worker certificate path';
  end if;

  insert into public.worker_verifications(
    worker_id,certificate_path,verification_video_url,status,submitted_at,created_at,updated_at
  ) values(
    v_profile.user_id,nullif(btrim(coalesce(p_certificate_path,'')),''),btrim(p_video_path),
    'evidence_ready',null,now(),now()
  )
  on conflict(worker_id) do update set
    certificate_path=excluded.certificate_path,
    verification_video_url=excluded.verification_video_url,
    status='evidence_ready',
    submitted_at=null,
    reviewed_by=null,
    review_notes=null,
    reviewed_at=null,
    updated_at=now()
  returning id into v_id;

  update public.profiles
  set worker_status='verification_paid',worker_verified=false,available=false,
      worker_cert_url=nullif(btrim(coalesce(p_certificate_path,'')),''),
      worker_video_url=btrim(p_video_path),updated_at=now()
  where user_id=v_profile.user_id;
  return v_id;
end;
$$;

revoke execute on function public.save_my_worker_professional_evidence(text,text) from public,anon;
grant execute on function public.save_my_worker_professional_evidence(text,text) to authenticated,service_role;
