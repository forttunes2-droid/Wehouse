create or replace function public.create_my_property_inspection_batch_v4(
  p_batch_id uuid,
  p_items jsonb
) returns jsonb language plpgsql security definer set search_path = 'pg_catalog','public' as $$
declare
  actor_id text := (select auth.uid())::text;
  result jsonb;
  created jsonb;
  item jsonb;
  v_position integer;
  request_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.property_submission_batches b
    where b.id=p_batch_id and b.partner_user_id=actor_id and b.status in ('draft','submitting')
    for update
  ) then raise exception 'Property submission batch not found'; end if;
  update public.property_submission_batches set status='submitting',updated_at=now() where id=p_batch_id;
  result := public.create_my_property_inspection_batch_v3(p_items);
  for created in select value from jsonb_array_elements(result->'requests') loop
    v_position := (created->>'position')::integer;
    request_id := (created->>'id')::uuid;
    item := p_items->(v_position-1);
    update public.inspection_requests set
      submission_schema_version=2,
      hotel_program=case when item->>'property_type'='hotel' then item->'hotel_program' else null end,
      submission_batch_id=p_batch_id,
      updated_at=now()
    where id=request_id;
    update public.property_submission_items set
      inspection_request_id=request_id,status='submitted',updated_at=now()
    where batch_id=p_batch_id and position=v_position-1;
  end loop;
  update public.property_submission_batches set status='submitted',submitted_at=now(),updated_at=now() where id=p_batch_id;
  return result || jsonb_build_object('batch_id',p_batch_id);
exception when others then
  update public.property_submission_batches set status='draft',updated_at=now() where id=p_batch_id and partner_user_id=actor_id;
  raise;
end $$;

revoke all on function public.create_my_property_inspection_batch_v4(uuid,jsonb) from public,anon;
grant execute on function public.create_my_property_inspection_batch_v4(uuid,jsonb) to authenticated;
