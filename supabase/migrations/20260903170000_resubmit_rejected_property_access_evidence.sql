-- A rejected access recording is corrected on the original submission. This
-- keeps one property lifecycle and prevents partners creating duplicates.

create or replace function public.create_my_property_access_correction(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_request public.inspection_requests;
  v_challenge public.property_access_challenges; v_code text;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text
    and role='property_partner' and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  select * into v_request from public.inspection_requests
    where id=p_request_id and owner_id=v_actor.user_id for update;
  if v_request.id is null then raise exception 'Property submission not found'; end if;
  if v_request.published_at is not null or v_request.lifecycle_stage='live'
    then raise exception 'A public property does not require new access evidence'; end if;
  if v_request.lifecycle_stage='rejected' or lower(coalesce(v_request.status,''))='rejected'
    then raise exception 'This submission was stopped. Contact WeHouse from Inbox'; end if;
  if v_request.access_evidence_status<>'rejected'
    then raise exception 'WeHouse has not requested replacement access evidence'; end if;
  if coalesce(v_request.assigned_field_officer_id,v_request.field_officer_id,v_request.assigned_to) is not null
    then raise exception 'Access evidence cannot be replaced after a Field Officer is assigned'; end if;

  update public.property_access_challenges set status='expired'
    where partner_id=v_actor.user_id and request_id=p_request_id and status='prepared';
  v_code:=lpad(((('x'||substr(encode(gen_random_bytes(4),'hex'),1,8))::bit(32)::bigint % 1000000))::text,6,'0');
  insert into public.property_access_challenges(partner_id,code,expires_at,request_id)
  values(v_actor.user_id,v_code,now()+interval '1 hour',p_request_id)
  returning * into v_challenge;
  return jsonb_build_object('id',v_challenge.id,'code',v_challenge.code,'expires_at',v_challenge.expires_at);
end $$;

create or replace function public.submit_my_property_access_correction(
  p_request_id uuid,p_challenge_id uuid,p_video_path text
) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','storage' as $$
declare v_actor public.profiles; v_request public.inspection_requests;
  v_challenge public.property_access_challenges; v_previous_path text;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text
    and role='property_partner' and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  select * into v_request from public.inspection_requests
    where id=p_request_id and owner_id=v_actor.user_id for update;
  if v_request.id is null then raise exception 'Property submission not found'; end if;
  if v_request.access_evidence_status<>'rejected' or v_request.lifecycle_stage<>'changes_requested'
    then raise exception 'Replacement evidence is not currently requested'; end if;
  select * into v_challenge from public.property_access_challenges
    where id=p_challenge_id and partner_id=v_actor.user_id and request_id=p_request_id for update;
  if v_challenge.id is null or v_challenge.status<>'prepared'
    then raise exception 'This one-use correction code is unavailable'; end if;
  if v_challenge.expires_at<=now() then
    update public.property_access_challenges set status='expired' where id=p_challenge_id;
    raise exception 'The one-use code expired. Create a new code and record again';
  end if;
  if split_part(p_video_path,'/',1)<>v_actor.user_id or split_part(p_video_path,'/',2)<>p_challenge_id::text
    then raise exception 'Invalid private property access path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='property-access-private' and name=p_video_path)
    then raise exception 'Private property access recording was not found'; end if;

  v_previous_path:=v_request.access_evidence_video_path;
  update public.property_access_challenges set video_path=p_video_path,status='consumed',
    submitted_at=now(),consumed_at=now() where id=p_challenge_id;
  update public.inspection_requests set access_evidence_video_path=p_video_path,
    access_evidence_status='submitted',access_evidence_submitted_at=now(),
    access_evidence_verified_at=null,access_evidence_verified_by=null,
    rejection_reason=null,updated_at=now() where id=p_request_id;
  insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email)
  values('PROPERTY_ACCESS_EVIDENCE_RESUBMITTED','inspection_requests',p_request_id::text,
    jsonb_build_object('previous_video_path',v_previous_path,'replacement_video_path',p_video_path)::text,
    v_actor.user_id,v_actor.email);
  return jsonb_build_object('success',true,'status','submitted');
end $$;

revoke all on function public.create_my_property_access_correction(uuid),
  public.submit_my_property_access_correction(uuid,uuid,text) from public,anon;
grant execute on function public.create_my_property_access_correction(uuid),
  public.submit_my_property_access_correction(uuid,uuid,text) to authenticated;
