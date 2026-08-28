create or replace function public.start_private_call(
  p_context_type text,
  p_context_id uuid,
  p_call_type text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me text := public.current_profile_user_id();
  v_cap jsonb;
  v_peer text;
  v_call public.private_calls;
begin
  if v_me is null then raise exception 'Authenticated profile required'; end if;
  if p_call_type <> 'audio' then raise exception 'Only audio calls are available'; end if;
  v_cap := public.get_private_call_capabilities(p_context_type, p_context_id);
  v_peer := v_cap->>'peer_id';
  if coalesce((v_cap->>'allow_audio_calls')::boolean, false) = false then
    raise exception 'This person is not accepting audio calls';
  end if;
  if exists(
    select 1 from public.private_calls c
    where c.status in ('ringing', 'accepted')
      and (v_me in (c.caller_id, c.callee_id) or v_peer in (c.caller_id, c.callee_id))
  ) then raise exception 'One of you is already in a call'; end if;
  insert into public.private_calls(context_type, context_id, caller_id, callee_id, call_type, status)
  values (p_context_type, p_context_id, v_me, v_peer, 'audio', 'ringing')
  returning * into v_call;
  return jsonb_build_object(
    'id', v_call.id,
    'context_type', v_call.context_type,
    'context_id', v_call.context_id,
    'caller_id', v_call.caller_id,
    'callee_id', v_call.callee_id,
    'call_type', v_call.call_type,
    'status', v_call.status,
    'created_at', v_call.created_at
  );
end;
$function$;

revoke all on function public.start_private_call(text, uuid, text) from public, anon;
grant execute on function public.start_private_call(text, uuid, text) to authenticated, service_role;

create or replace function public.notify_missed_private_call()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'missed' and old.status is distinct from 'missed' then
    insert into public.notifications(recipient_id, type, title, message, related_id, read)
    select new.callee_id, 'missed_call', 'Missed audio call',
      'You missed an audio call. Open Messages to call back.', new.id::text, false
    where not exists (
      select 1 from public.notifications n
      where n.recipient_id = new.callee_id
        and n.type = 'missed_call'
        and n.related_id = new.id::text
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists private_calls_notify_missed on public.private_calls;
create trigger private_calls_notify_missed
after update of status on public.private_calls
for each row execute function public.notify_missed_private_call();

revoke all on function public.notify_missed_private_call() from public, anon, authenticated;
grant execute on function public.notify_missed_private_call() to service_role;
