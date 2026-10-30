-- Helpers only for rollback contracts, never installed in an application schema.
create function pg_temp.prepare_private_message_fixture(prefixes text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into auth.users(id,aud,role,email,created_at,updated_at)
 select p.auth_id::uuid,'authenticated','authenticated',p.email,now(),now() from public.profiles p
 where p.email like '%@example.invalid' and left(p.auth_id,8)=any(prefixes) on conflict(id) do nothing;
 insert into auth.sessions(id,user_id,created_at,updated_at)
 select p.auth_id::uuid,p.auth_id::uuid,now(),now() from public.profiles p
 where p.email like '%@example.invalid' and left(p.auth_id,8)=any(prefixes) on conflict(id) do nothing;
 insert into public.user_sessions(user_id,auth_id,auth_session_id,device_id,device,is_active,trust_status)
 select p.user_id,p.auth_id,p.auth_id,'private-contract-'||p.user_id,'Synthetic trusted browser',true,'trusted'
 from public.profiles p where p.email like '%@example.invalid' and left(p.auth_id,8)=any(prefixes)
 and not exists(select 1 from public.user_sessions s where s.auth_session_id=p.auth_id);
 insert into public.user_encryption_identities(user_id,public_key_jwk,encrypted_private_key,backup_iv,backup_salt)
 select p.user_id,'{"kty":"EC","crv":"P-256","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","y":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',repeat('A',64),repeat('A',16),repeat('A',24)
 from public.profiles p where p.email like '%@example.invalid' and left(p.auth_id,8)=any(prefixes)
 on conflict(user_id) do nothing;
end $$;
create function pg_temp.current_envelope_token(kind text,conversation_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare actor text:=public.current_profile_user_id();a text;b text;envelopes jsonb;token text;
begin
 if kind='friend' then select user_low,user_high into a,b from public.friends where id=conversation_id;
 elsif kind='roommate' then select participant_a,participant_b into a,b from public.conversations where id=conversation_id;
 elsif kind='worker' then select user_id,worker_id into a,b from public.booking_conversations where id=conversation_id;
 end if;
 if actor is null or actor not in(a,b) or a is null or b is null then raise exception 'Synthetic participant required';end if;
 select jsonb_agg(jsonb_build_object('recipient_user_id',i.user_id,'recipient_key_version',i.key_version,
 'sender_ephemeral_public_key_jwk','{}'::jsonb,'wrapped_key','k','wrap_iv','i')) into envelopes
 from public.user_encryption_identities i where i.user_id in(a,b);
 perform public.establish_private_conversation_key(kind,conversation_id,envelopes);
 select e.key_id::text||':'||e.recipient_key_version::text||':'||e.wrap_iv||':'||e.wrapped_key into token
 from public.conversation_key_envelopes e where e.conversation_kind=kind and e.conversation_id=current_envelope_token.conversation_id and e.recipient_user_id=actor and e.is_current
 order by recipient_key_version desc limit 1;
 return token;
end $$;
grant execute on function pg_temp.current_envelope_token(text,uuid) to authenticated;
