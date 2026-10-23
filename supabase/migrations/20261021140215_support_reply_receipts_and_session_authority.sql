-- One intent identifies one message in the existing store, including internal notes.
alter table public.partner_support_messages add column client_request_id uuid;
create unique index partner_support_messages_sender_intent on public.partner_support_messages(sender_id,client_request_id) where client_request_id is not null;

create function public.send_support_message_v2(p_request_id uuid,p_conversation_id uuid,p_content text default '',p_attachments text[] default '{}',p_attachment_types text[] default '{}',p_visibility text default 'customer') returns uuid
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id(); prior public.partner_support_messages; message_id uuid;
begin
 if actor is null or not public._property_document_session_active() or p_request_id is null then raise exception 'A trusted active session and message request are required' using errcode='42501';end if;
 if not public.current_actor_can_access_operational_conversation(p_conversation_id,false) then raise exception 'Conversation is unavailable to this account' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor||':support:'||p_request_id::text,0));
 select * into prior from public.partner_support_messages where sender_id=actor and client_request_id=p_request_id;
 if prior.id is not null then
  if prior.conversation_id is distinct from p_conversation_id or prior.content is distinct from btrim(coalesce(p_content,''))
   or prior.attachments is distinct from coalesce(p_attachments,'{}'::text[]) or prior.attachment_types is distinct from coalesce(p_attachment_types,'{}'::text[])
   or prior.visibility is distinct from p_visibility then raise exception 'This message request was already used for different content';end if;
  return prior.id;
 end if;
 message_id:=public.send_support_message(p_conversation_id,p_content,p_attachments,p_attachment_types,null,'{}'::jsonb,p_visibility);
 update public.partner_support_messages set client_request_id=p_request_id where id=message_id and sender_id=actor;
 return message_id;
end $$;
revoke all on function public.send_support_message_v2(uuid,uuid,text,text[],text[],text) from public,anon;
grant execute on function public.send_support_message_v2(uuid,uuid,text,text[],text[],text) to authenticated;
