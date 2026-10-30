-- Bind submission retries/recovery to the exact JSONB payload, not only a row count.
alter table public.property_submission_batches add column submitted_payload_sha256 text check(submitted_payload_sha256 is null or submitted_payload_sha256~'^[a-f0-9]{64}$');
create function private.guard_submission_payload_receipt()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='INSERT' then
  if new.submitted_payload_sha256 is not null then raise exception 'Submission proof is server controlled';end if;
 elsif new.submitted_payload_sha256 is distinct from old.submitted_payload_sha256 then
  if old.submitted_payload_sha256 is not null or current_setting('wehouse.property_submission_commit',true) is distinct from 'confirmed' then raise exception 'Submission proof is server controlled';end if;
 end if;
 return new;
end; $$;
revoke all on function private.guard_submission_payload_receipt() from public,anon,authenticated,service_role;
create trigger property_submission_payload_receipt before insert or update of submitted_payload_sha256 on public.property_submission_batches for each row execute function private.guard_submission_payload_receipt();
drop function public.get_my_property_submission_receipt(uuid);
CREATE OR REPLACE FUNCTION public.get_my_property_submission_receipt(p_batch_id uuid, p_items jsonb default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor text:=public.current_profile_user_id();requests jsonb;payload_hash text;matches boolean;
begin
 if not public._property_document_session_active() or actor is null or not public.current_actor_has_workspace('property_partner',null) then raise exception 'Active trusted Property Partner session required';end if;
 if not exists(select 1 from public.property_submission_batches b where b.id=p_batch_id and b.partner_user_id=(auth.uid())::text) then raise exception 'Submission batch not found';end if;
 if not exists(select 1 from public.property_submission_batches where id=p_batch_id and status='submitted') then return null;end if;
 select submitted_payload_sha256 into payload_hash from public.property_submission_batches where id=p_batch_id;
 matches:=p_items is not null and payload_hash is not null and payload_hash=encode(extensions.digest(p_items::text,'sha256'),'hex');
 if p_items is not null and not matches then raise exception 'This batch was submitted with different property details. Review the saved submission';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'request_code',r.request_code,'position',r.submission_batch_position) order by r.submission_batch_position),'[]'::jsonb)
 into requests from public.inspection_requests r where r.submission_batch_id=p_batch_id and r.owner_id=actor;
 return jsonb_build_object('batch_id',p_batch_id,'count',jsonb_array_length(requests),'requests',requests,'payload_matches',coalesce(matches,false));
end; $function$;
revoke all on function public.get_my_property_submission_receipt(uuid,jsonb) from public,anon,service_role;
grant execute on function public.get_my_property_submission_receipt(uuid,jsonb) to authenticated;
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
  v_previous_command text;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  if public.account_identity_checks_enabled()
     and not public.account_identity_is_current(v_actor) then
    raise exception 'Complete the private identity check before submitting properties';
  end if;
  if exists(select 1 from public.property_submission_batches where id=p_batch_id and partner_user_id=v_auth_id and status='submitted') then
    return public.get_my_property_submission_receipt(p_batch_id,p_items);
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
  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_item->>'property_type'='apartment' and coalesce(v_item->>'management_mode','') not in ('host','wehouse') then
      raise exception 'Choose who will manage each home before submission';
    end if;
  end loop;
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
      requested_management_mode=case when v_item->>'property_type'='apartment' then v_item->>'management_mode' else null end,
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
    perform private.link_submission_space(v_request_id,v_item,v_actor);
    update public.property_submission_items
    set inspection_request_id=v_request_id,status='submitted',updated_at=now()
    where batch_id=p_batch_id and position=v_position-1;
  end loop;
  v_previous_command:=current_setting('wehouse.property_submission_commit',true);
  perform set_config('wehouse.property_submission_commit','confirmed',true);
  update public.property_submission_batches
  set submitted_payload_sha256=encode(extensions.digest(p_items::text,'sha256'),'hex'),status='submitted',submitted_at=now(),updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  perform set_config('wehouse.property_submission_commit',coalesce(v_previous_command,''),true);
  return v_result||jsonb_build_object('batch_id',p_batch_id,'payload_matches',true);
exception when others then
  update public.property_submission_batches
  set status='draft',updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  raise;
end;
$function$;
