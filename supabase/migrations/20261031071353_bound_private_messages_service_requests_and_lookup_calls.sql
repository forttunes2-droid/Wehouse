begin;
set local search_path='';
-- Composite IS NOT NULL requires every nullable field to be populated. A live
-- reservation is identified by its primary key, including a retry at the cap.
do $retry$
declare definition text;needle text:='IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;';
begin
 definition:=pg_catalog.pg_get_functiondef('public.create_apartment_reservation(text)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'Inspect Long Let retry identity';end if;
 execute replace(definition,needle,'IF v_existing.id IS NOT NULL THEN RETURN v_existing; END IF;');
end $retry$;

create function private.check_private_message_size(p_ciphertext text,p_iv text,p_attachments jsonb)
returns void language plpgsql immutable set search_path='' as $$
begin
 if octet_length(coalesce(p_ciphertext,''))>65536 or octet_length(coalesce(p_iv,''))>128
  or pg_column_size(coalesce(p_attachments,'[]'::jsonb))>65536 then
  raise exception 'This message is too large. Shorten the text or send its files separately' using errcode='22023';end if;
 if jsonb_typeof(coalesce(p_attachments,'[]'::jsonb))<>'array' then raise exception 'Choose valid message attachments' using errcode='22023';end if;
 if jsonb_array_length(coalesce(p_attachments,'[]'::jsonb))>6 then raise exception 'Send up to six attachments per message' using errcode='22023';end if;
end $$;
revoke all on function private.check_private_message_size(text,text,jsonb) from public,anon,authenticated,service_role;
create function private.private_message_write_budget() returns void
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();
begin
 if actor is null then raise exception 'Active account required' using errcode='42501';end if;
 if not (private.consume_user_action(actor,'private_message_send',90,60)->>'allowed')::boolean then
  raise exception 'You are sending messages too quickly. Wait a minute before trying again' using errcode='53400';end if;
end $$;
revoke all on function private.private_message_write_budget() from public,anon,authenticated,service_role;
do $messages$
declare signature text;definition text;needle text;
begin
 foreach signature in array array[
  'public.send_private_encrypted_message(text,uuid,text,text,jsonb,uuid,text)',
  'public.send_friend_encrypted_message(uuid,text,text,jsonb,uuid,uuid,text)'] loop
  definition:=replace(pg_catalog.pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  if strpos(definition,E'begin\n')=0 then raise exception 'Inspect private-message entry point';end if;
  definition:=replace(definition,E'begin\n',E'begin\n perform private.check_private_message_size(p_ciphertext,p_encryption_iv,p_encrypted_attachments);\n');
  needle:=case when signature like '%send_friend_encrypted_message%' then
   $needle$ perform private.assert_current_private_message_envelope('friend',p_friend_id,p_envelope_token);$needle$
   else ' perform private.assert_current_private_message_envelope(p_conversation_kind,p_conversation_id,p_envelope_token);' end;
  if strpos(definition,needle)=0 then raise exception 'Inspect private-message key/budget order';end if;
  -- Owned, already-recorded Friend retries return before this new-send budget.
  definition:=replace(definition,needle,needle||E'\n perform private.private_message_write_budget();');
  execute definition;
 end loop;
end $messages$;

do $service$
declare definition text;needle text:='  if v_service='''' then raise exception ''Choose a service''; end if;';
begin
 definition:=replace(pg_catalog.pg_get_functiondef('public.create_booking_request(text,text,text,text,text,text)'::regprocedure),E'\r\n',E'\n');
 if strpos(definition,needle)=0 then raise exception 'Inspect Service request input/budget authority';end if;
 definition:=replace(definition,needle,$limits$
  if length(coalesce(p_worker_id,''))>120 or length(v_service)>120 or length(coalesce(p_description,''))>4000
    or length(coalesce(p_address,''))>1000 or length(coalesce(p_customer_message,''))>2000
    or length(coalesce(p_scheduled_date,''))>40 then raise exception 'Service request details are too long';end if;
  if not (private.consume_user_action(v_customer.user_id,'service_request_create',10,60)->>'allowed')::boolean then
    raise exception 'Too many service requests. Wait a minute before trying again' using errcode='53400';end if;
$limits$||needle);
 execute definition;
end $service$;

-- Reuse the existing durable service-only rate ledger. Serialize admission to
-- the public geocoder across Edge instances; a per-instance counter is unsafe.
create function public.take_reverse_geocode_provider_slot() returns boolean
language plpgsql security definer set search_path='' as $$
declare admitted boolean;
begin
 if coalesce(auth.jwt()->>'role',current_setting('request.jwt.claim.role',true),'')<>'service_role' then
  raise exception 'Service role required' using errcode='42501';end if;
 insert into public.user_action_rate_limits as budget(user_key,action,window_started_at,attempt_count,updated_at)
 values('nominatim-provider','reverse_geocode_provider',clock_timestamp(),1,clock_timestamp())
 on conflict(user_key,action) do update set window_started_at=excluded.window_started_at,attempt_count=1,updated_at=excluded.updated_at
 where budget.window_started_at<=excluded.window_started_at-interval '1 second' returning true into admitted;
 return coalesce(admitted,false);
end $$;
revoke all on function public.take_reverse_geocode_provider_slot() from public,anon,authenticated;
grant execute on function public.take_reverse_geocode_provider_slot() to service_role;
commit;
