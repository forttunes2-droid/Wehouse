-- Establish one conversation key exactly once. Concurrent participants may both
-- prepare envelopes, but only the transaction holding the conversation lock wins.
create or replace function public.establish_private_conversation_key(
  p_conversation_kind text,
  p_conversation_id uuid,
  p_envelopes jsonb
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  actor text := public.current_profile_user_id();
  first_user text;
  second_user text;
  envelope_count integer;
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if p_conversation_kind='roommate' then
    select participant_a,participant_b into first_user,second_user
    from public.conversations where id=p_conversation_id and actor in(participant_a,participant_b);
  elsif p_conversation_kind='worker' then
    select user_id,worker_id into first_user,second_user
    from public.booking_conversations where id=p_conversation_id and actor in(user_id,worker_id);
  else
    raise exception 'Unsupported private conversation kind';
  end if;
  if first_user is null or second_user is null then raise exception 'Conversation access denied'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_kind||':'||p_conversation_id::text,0));
  if exists(select 1 from public.conversation_key_envelopes where conversation_kind=p_conversation_kind and conversation_id=p_conversation_id) then
    return false;
  end if;

  select count(*) into envelope_count from jsonb_array_elements(coalesce(p_envelopes,'[]'::jsonb));
  if envelope_count<>2 then raise exception 'Exactly two participant envelopes are required'; end if;
  if not exists(select 1 from jsonb_array_elements(p_envelopes) e where e->>'recipient_user_id'=first_user)
     or not exists(select 1 from jsonb_array_elements(p_envelopes) e where e->>'recipient_user_id'=second_user)
     or exists(select 1 from jsonb_array_elements(p_envelopes) e where e->>'recipient_user_id' not in(first_user,second_user)) then
    raise exception 'Envelope recipients must be the conversation participants';
  end if;

  insert into public.conversation_key_envelopes(
    conversation_kind,conversation_id,recipient_user_id,recipient_key_version,
    sender_ephemeral_public_key_jwk,wrapped_key,wrap_iv
  )
  select p_conversation_kind,p_conversation_id,e->>'recipient_user_id',
    (e->>'recipient_key_version')::integer,e->'sender_ephemeral_public_key_jwk',
    e->>'wrapped_key',e->>'wrap_iv'
  from jsonb_array_elements(p_envelopes) e
  join public.user_encryption_identities identity
    on identity.user_id=e->>'recipient_user_id'
   and identity.key_version=(e->>'recipient_key_version')::integer;
  if not found then raise exception 'Current participant encryption identities are required'; end if;
  if (select count(*) from public.conversation_key_envelopes where conversation_kind=p_conversation_kind and conversation_id=p_conversation_id)<>2 then
    raise exception 'Both current participant keys are required';
  end if;
  return true;
end;
$$;

revoke all on function public.establish_private_conversation_key(text,uuid,jsonb) from public,anon;
grant execute on function public.establish_private_conversation_key(text,uuid,jsonb) to authenticated;
revoke insert on public.conversation_key_envelopes from authenticated;
