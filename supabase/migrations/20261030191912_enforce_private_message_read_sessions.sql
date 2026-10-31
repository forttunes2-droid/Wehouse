-- A revoked device may already have an old conversation key. Block subsequent
-- ciphertext retrieval as well as key setup; preserve the current DTOs/filters.
do $$
declare target regprocedure;definition text;
begin
 foreach target in array array[
  'public.get_private_encrypted_messages(text,uuid)'::regprocedure,
  'public.get_private_chat_peer_public_key(text,uuid,text)'::regprocedure,
  'public.set_private_message_reaction(text,uuid,uuid,text)'::regprocedure,
  'private.friend_chat_access(uuid,boolean)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(target);
  if position('LANGUAGE plpgsql' in definition)=0 or position('begin' in lower(definition))=0
   or position('public._property_document_session_active()' in definition)>0 then
   raise exception 'Review the current private-message session guard before changing %',target;
  end if;
  definition:=regexp_replace(definition,'\mbegin\M',E'begin\n if not public._property_document_session_active() then raise exception ''A trusted account session is required'' using errcode=''42501'';end if;','i');
  execute definition;
 end loop;
end $$;
create policy private_messaging_trusted_session on public.messages
 as restrictive for all to authenticated using((select private.private_messaging_session_active()))
 with check((select private.private_messaging_session_active()));
create policy private_messaging_trusted_session on public.booking_messages
 as restrictive for all to authenticated using((select private.private_messaging_session_active()))
 with check((select private.private_messaging_session_active()));
create policy private_messaging_trusted_session on public.friend_messages
 as restrictive for all to authenticated using((select private.private_messaging_session_active()))
 with check((select private.private_messaging_session_active()));
