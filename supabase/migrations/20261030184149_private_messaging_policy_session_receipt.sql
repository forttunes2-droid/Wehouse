-- Policies execute as the caller. Keep the underlying session authority
-- internal, and expose only this argument-free receipt in the private schema.
create function private.private_messaging_session_active() returns boolean
language sql stable security definer set search_path='' as $$
 select public._property_document_session_active();
$$;
revoke all on function private.private_messaging_session_active() from public,anon,authenticated,service_role;
grant execute on function private.private_messaging_session_active() to authenticated;
alter policy private_messaging_trusted_session on public.user_encryption_identities
 using((select private.private_messaging_session_active()))
 with check((select private.private_messaging_session_active()));
alter policy private_messaging_trusted_session on public.conversation_key_envelopes
 using((select private.private_messaging_session_active()))
 with check((select private.private_messaging_session_active()));
