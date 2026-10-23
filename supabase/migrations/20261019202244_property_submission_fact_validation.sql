-- Validate prospective submission facts before creating inspection records.
-- This does not rewrite historical properties or add identity requirements.
create or replace function public._validate_property_submission_facts(p_items jsonb)
returns void language plpgsql set search_path to 'pg_catalog','public'
as $$
declare item jsonb; room jsonb; position integer:=0; field text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Provide a property submission list'; end if;
  if jsonb_array_length(p_items)=0 then raise exception 'Add a property before submitting'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    position:=position+1;
    if item->>'property_type'='apartment' then
      foreach field in array array['bedrooms','bathrooms'] loop
        if coalesce(item->>field,'') !~ '^[0-9]+$' then raise exception 'Property %: enter a whole-number % count',position,field; end if;
        if (item->>field)::numeric>2147483647 then raise exception 'Property %: % count is too large',position,field; end if;
      end loop;
    elsif item->>'property_type'='hotel' then
      if jsonb_typeof(item->'hotel_program'->'room_types') is distinct from 'array' then raise exception 'Property %: add Hotel room types',position; end if;
      if jsonb_array_length(item->'hotel_program'->'room_types')=0 then raise exception 'Property %: add Hotel room types',position; end if;
      for room in select value from jsonb_array_elements(item->'hotel_program'->'room_types') loop
        foreach field in array array['guest_capacity','inventory'] loop
          if coalesce(room->>field,'') !~ '^[0-9]+$' then raise exception 'Property %: Hotel % must be a whole number',position,field; end if;
          if (room->>field)::numeric<1 or (room->>field)::numeric>2147483647 then raise exception 'Property %: Hotel % must be at least 1 and within the supported range',position,field; end if;
        end loop;
      end loop;
    end if;
  end loop;
end;
$$;
revoke all on function public._validate_property_submission_facts(jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_my_property_inspection_batch_v4(p_batch_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_auth_id text:=(select auth.uid())::text;
  v_actor text:=public.current_profile_user_id();
  v_result jsonb;
  v_created jsonb;
  v_item jsonb;
  v_position integer;
  v_request_id uuid;
  v_max_guests integer;
  v_display_name text;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  if public.account_identity_checks_enabled()
     and not public.account_identity_is_current(v_actor) then
    raise exception 'Complete the private identity check before submitting properties';
  end if;
  if not exists(
    select 1 from public.property_submission_batches batch
    where batch.id=p_batch_id
      and batch.partner_user_id=v_auth_id
      and batch.status in ('draft','submitting')
    for update
  ) then raise exception 'Property submission batch not found'; end if;
  update public.property_submission_batches
  set status='submitting',updated_at=now() where id=p_batch_id;
  perform public._validate_property_submission_facts(p_items);
  v_result:=public.create_my_property_inspection_batch_v3(p_items);
  for v_created in select value from jsonb_array_elements(v_result->'requests') loop
    v_position:=(v_created->>'position')::integer;
    v_request_id:=(v_created->>'id')::uuid;
    v_item:=p_items->(v_position-1);
    v_max_guests:=nullif(v_item->>'max_guests','')::integer;
    v_display_name:=nullif(btrim(coalesce(v_item->>'property_display_name','')),'');
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and coalesce(v_max_guests,0)<1 then
      raise exception 'Property %: Short Let guest capacity must be at least 1',v_position;
    end if;
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and v_display_name is null then
      raise exception 'Property %: Short Let property or host name is required',v_position;
    end if;
    update public.inspection_requests set
      submission_schema_version=2,
      hotel_program=case when v_item->>'property_type'='hotel'
        then v_item->'hotel_program' else null end,
      max_guests=case
        when v_item->>'property_type'='apartment'
          and v_item->>'sub_type'='short_let'
        then v_max_guests else null end,
      property_display_name=case
        when v_item->>'property_type'='apartment'
          and v_item->>'sub_type'='short_let'
        then v_display_name else null end,
      submission_batch_id=p_batch_id,
      updated_at=now()
    where id=v_request_id and owner_id=v_actor;
    update public.property_submission_items
    set inspection_request_id=v_request_id,status='submitted',updated_at=now()
    where batch_id=p_batch_id and position=v_position-1;
  end loop;
  update public.property_submission_batches
  set status='submitted',submitted_at=now(),updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  return v_result||jsonb_build_object('batch_id',p_batch_id);
exception when others then
  update public.property_submission_batches
  set status='draft',updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  raise;
end;
$function$;
revoke all on function public.create_my_property_inspection_batch_v4(uuid,jsonb) from public,anon; grant execute on function public.create_my_property_inspection_batch_v4(uuid,jsonb) to authenticated,service_role;
