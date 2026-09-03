create or replace function public.create_my_property_inspection_batch_v3(p_items jsonb) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor public.profiles; v_result jsonb; v_created jsonb; v_item jsonb;
  v_position integer; v_challenge_id uuid; v_challenge public.property_access_challenges; v_request_id uuid;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 then raise exception 'Add at least one property'; end if;
  for v_item,v_position in select value,ordinality::integer from jsonb_array_elements(p_items) with ordinality loop
    begin v_challenge_id:=(v_item->>'access_challenge_id')::uuid;
    exception when others then raise exception 'Property %: valid live access recording required',v_position; end;
    select * into v_challenge from public.property_access_challenges where id=v_challenge_id and partner_id=v_actor.user_id for update;
    if v_challenge.id is null or v_challenge.status<>'submitted' or v_challenge.video_path is null or v_challenge.submitted_at is null then raise exception 'Property %: complete the live access recording before submitting',v_position; end if;
    if v_challenge.submitted_at>v_challenge.expires_at then raise exception 'Property %: the access recording was submitted after its code expired. Record again',v_position; end if;
  end loop;
  v_result:=public.create_my_property_inspection_batch_v2(p_items);
  for v_created in select value from jsonb_array_elements(v_result->'requests') loop
    v_position:=(v_created->>'position')::integer; v_request_id:=(v_created->>'id')::uuid;
    v_challenge_id:=(p_items->(v_position-1)->>'access_challenge_id')::uuid;
    select * into v_challenge from public.property_access_challenges where id=v_challenge_id for update;
    update public.inspection_requests set access_challenge_code=v_challenge.code,access_challenge_expires_at=v_challenge.expires_at,
      access_evidence_video_path=v_challenge.video_path,access_evidence_status='submitted',access_evidence_submitted_at=v_challenge.submitted_at,updated_at=now()
    where id=v_request_id and owner_id=v_actor.user_id;
    update public.property_access_challenges set status='consumed',consumed_at=now(),request_id=v_request_id where id=v_challenge_id and partner_id=v_actor.user_id and status='submitted';
    if not found then raise exception 'Property %: access recording was already used',v_position; end if;
  end loop;
  return v_result;
end $$;
revoke all on function public.create_my_property_inspection_batch_v3(jsonb) from public,anon;
grant execute on function public.create_my_property_inspection_batch_v3(jsonb) to authenticated;
