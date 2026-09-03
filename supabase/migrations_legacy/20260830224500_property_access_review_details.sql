create or replace function public.get_property_access_review_details(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_request public.inspection_requests;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text
    and role in ('creator','admin') and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Authorized property reviewer required'; end if;
  select * into v_request from public.inspection_requests where id=p_request_id;
  if v_request.id is null then raise exception 'Property request not found'; end if;
  if v_actor.role='admin' and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then raise exception 'Property is outside your assigned area'; end if;
  return jsonb_build_object('status',v_request.access_evidence_status,'video_path',v_request.access_evidence_video_path,
    'submitted_at',v_request.access_evidence_submitted_at,'code',v_request.access_challenge_code);
end $$;
revoke all on function public.get_property_access_review_details(uuid) from public,anon;
grant execute on function public.get_property_access_review_details(uuid) to authenticated;
