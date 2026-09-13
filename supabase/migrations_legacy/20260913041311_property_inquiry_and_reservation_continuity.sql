-- A pre-reservation WeHouse property conversation is an inquiry, not a case.
-- When that same customer reserves the same subject, the thread evolves into
-- the booking conversation instead of creating a disconnected second thread.

create unique index if not exists partner_support_canonical_thread_unique
  on public.partner_support_conversations(canonical_thread_id)
  where canonical_thread_id is not null;

create or replace function public.open_property_operations_conversation(
  p_subject_type text,p_subject_id text,p_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_thread public.canonical_threads;
  v_conversation public.partner_support_conversations;
  v_snapshot jsonb;
  v_title text;
  v_state text;
  v_allowed boolean:=false;
begin
  if p_subject_type not in('listing','hotel_property')
    or nullif(btrim(coalesce(p_subject_id,'')),'') is null then
    raise exception 'Property conversation subject is invalid'; end if;
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active Personal account required'; end if;

  if p_subject_type='listing' then
    select coalesce(l.title,'Property'),l.state,
      (l.deleted_at is null and (
        (l.status='available' and l.approved_at is not null)
        or v_actor.user_id in(l.owner_id,l.partner_id)
      ))
    into v_title,v_state,v_allowed
    from public.listings l
    where l.id::text=p_subject_id or l.listing_id=p_subject_id limit 1;
  else
    select coalesce(h.name,'Hotel'),h.state,
      (h.status='active' and h.approved_at is not null)
      or h.owner_id=v_actor.user_id
      or public.hotel_actor_has_capability(h.hotel_id,'stay.read')
    into v_title,v_state,v_allowed
    from public.hotels h where h.hotel_id::text=p_subject_id limit 1;
  end if;
  if not coalesce(v_allowed,false) then
    raise exception 'This property is not available to this account'; end if;

  v_snapshot:=coalesce(p_snapshot,'{}'::jsonb)
    -'booking_code'-'check_in_code'-'access_code'-'verification_code'
    -'handover_code'-'recovery_code';
  v_snapshot:=v_snapshot||jsonb_build_object(
    'source_type',p_subject_type,'source_id',p_subject_id,
    'owning_domain','property_operations','state_scope',v_state
  );

  insert into public.canonical_threads(
    thread_type,thread_key,subject_type,subject_id,state,created_at,updated_at
  ) values(
    'property_inquiry',p_subject_type||':'||p_subject_id||':requester:'||v_actor.user_id,
    p_subject_type,p_subject_id,'open',now(),now()
  ) on conflict(thread_type,thread_key) do update set
    state=case when canonical_threads.state='closed' then 'open'
      else canonical_threads.state end,updated_at=now()
  returning * into v_thread;
  insert into public.canonical_thread_participants(
    thread_id,user_id,participant_role,can_message,can_view_obligation
  ) values(v_thread.thread_id,v_actor.user_id,'requester',true,true)
  on conflict(thread_id,user_id) do update set
    left_at=null,can_message=true,can_view_obligation=true;

  insert into public.partner_support_conversations(
    partner_id,requester_role,subject,status,category,context_type,context_id,
    context_snapshot,priority,channel_kind,canonical_thread_id,
    created_at,updated_at
  ) values(
    v_actor.user_id,v_actor.role,v_title,'open','property_inquiry',
    case when p_subject_type='listing' then 'property_listing'
      else 'hotel_operations' end,
    p_subject_id,v_snapshot,'normal','property_operations',
    v_thread.thread_id,now(),now()
  ) on conflict(canonical_thread_id) where canonical_thread_id is not null
  do update set subject=excluded.subject,context_snapshot=excluded.context_snapshot,
    status=case when partner_support_conversations.status='closed'
      then 'open' else partner_support_conversations.status end,updated_at=now()
  returning * into v_conversation;

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,
    attachment_types,action_type,action_metadata,is_read,visibility,created_at
  ) select
    v_conversation.id,v_actor.user_id,'system',
    'Property conversation linked to this record.',array[]::text[],
    array[]::text[],'request_received',jsonb_build_object(
      'thread_type','property_inquiry','owning_domain','property_operations'
    ),false,'customer',now()
  where not exists(select 1 from public.partner_support_messages m
    where m.conversation_id=v_conversation.id);
  return jsonb_build_object(
    'conversation_id',v_conversation.id,'canonical_thread_id',v_thread.thread_id,
    'owning_domain','property_operations','case_started',false
  );
end
$$;

create or replace function public.open_my_reservation_conversation(
  p_context_type text,p_context_id text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_thread public.canonical_threads;
  v_snapshot jsonb;
  v_title text;
  v_context text;
  v_thread_type text;
  v_prior_subject_type text;
  v_prior_subject_id text;
  v_state text;
begin
  v_context:=case
    when p_context_type in('apartment_reservation','reservation','apartment_payment')
      then 'apartment_reservation'
    when p_context_type='hotel_booking' then 'hotel_booking'
    else null end;
  if v_context is null or nullif(btrim(coalesce(p_context_id,'')),'') is null then
    raise exception 'Reservation context is invalid'; end if;
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor.user_id is null then raise exception 'Active Personal account required'; end if;

  if v_context='apartment_reservation' then
    select
      (to_jsonb(r)-'booking_code'-'handover_code'-'access_code')
        ||jsonb_build_object(
          'reservation_id',r.id,'listing_title',coalesce(l.title,'Property'),
          'listing_city',l.city,'listing_state',l.state,
          'source_type',case when r.stay_type='short_let' then 'short_let' else 'long_let' end,
          'source_id',r.id,'owning_domain','property_operations'
        ),coalesce(l.title,case when r.stay_type='short_let'
          then 'Short Let' else 'Long Let' end),
      case when r.stay_type='short_let' then 'short_let' else 'long_let' end,
      'listing',r.listing_id,l.state
    into v_snapshot,v_title,v_thread_type,v_prior_subject_type,
      v_prior_subject_id,v_state
    from public.reservations r left join public.listings l
      on l.listing_id=r.listing_id or l.id::text=r.listing_id
    where r.id=p_context_id and r.user_id=v_actor.user_id limit 1;
  else
    select
      (to_jsonb(b)-'booking_code'-'check_in_code'-'access_code')
        ||jsonb_build_object(
          'hotel_name',h.name,'source_type','hotel','source_id',b.booking_id,
          'owning_domain','property_operations'
        ),coalesce(h.name,'Hotel stay'),'hotel','hotel_property',
      h.hotel_id::text,h.state
    into v_snapshot,v_title,v_thread_type,v_prior_subject_type,
      v_prior_subject_id,v_state
    from public.hotel_bookings b join public.hotels h on h.hotel_id=b.hotel_id
    where b.booking_id::text=p_context_id and b.user_id=v_actor.user_id limit 1;
  end if;
  if v_snapshot is null then raise exception 'Reservation was not found'; end if;

  select c.* into v_conversation
  from public.partner_support_conversations c
  where c.partner_id=v_actor.user_id and c.context_id=p_context_id
    and c.context_type=v_context
  order by c.created_at limit 1;
  if v_conversation.id is null then
    select c.* into v_conversation
    from public.partner_support_conversations c
    join public.canonical_threads t on t.thread_id=c.canonical_thread_id
    where c.partner_id=v_actor.user_id and t.thread_type='property_inquiry'
      and t.subject_type=v_prior_subject_type and t.subject_id=v_prior_subject_id
    order by c.created_at limit 1;
  end if;

  if v_conversation.id is not null and v_conversation.canonical_thread_id is not null then
    update public.canonical_threads set
      thread_type=v_thread_type,
      thread_key=v_thread_type||':'||p_context_id||':requester:'||v_actor.user_id,
      subject_type=v_thread_type,subject_id=p_context_id,state='open',updated_at=now()
    where thread_id=v_conversation.canonical_thread_id returning * into v_thread;
  else
    insert into public.canonical_threads(
      thread_type,thread_key,subject_type,subject_id,state,created_at,updated_at
    ) values(
      v_thread_type,v_thread_type||':'||p_context_id||':requester:'||v_actor.user_id,
      v_thread_type,p_context_id,'open',now(),now()
    ) on conflict(thread_type,thread_key) do update set state='open',updated_at=now()
    returning * into v_thread;
  end if;
  insert into public.canonical_thread_participants(
    thread_id,user_id,participant_role,can_message,can_view_obligation
  ) values(v_thread.thread_id,v_actor.user_id,'requester',true,true)
  on conflict(thread_id,user_id) do update set left_at=null,can_message=true,
    can_view_obligation=true;

  if v_conversation.id is null then
    insert into public.partner_support_conversations(
      partner_id,requester_role,subject,status,category,context_type,context_id,
      context_snapshot,priority,channel_kind,canonical_thread_id,
      created_at,updated_at
    ) values(
      v_actor.user_id,v_actor.role,v_title,'open','property_operations',
      v_context,p_context_id,v_snapshot,'normal','property_operations',
      v_thread.thread_id,now(),now()
    ) returning * into v_conversation;
  else
    update public.partner_support_conversations set
      subject=v_title,status=case when status='closed' then 'open' else status end,
      category='property_operations',context_type=v_context,context_id=p_context_id,
      context_snapshot=v_snapshot,channel_kind='property_operations',
      canonical_thread_id=v_thread.thread_id,updated_at=now()
    where id=v_conversation.id returning * into v_conversation;
  end if;

  insert into public.partner_support_messages(
    conversation_id,sender_id,sender_role,content,attachments,
    attachment_types,action_type,action_metadata,is_read,visibility,created_at
  ) select
    v_conversation.id,v_actor.user_id,'system',
    'Booking conversation linked to this record.',array[]::text[],
    array[]::text[],'request_received',jsonb_build_object(
      'thread_type',v_thread_type,'owning_domain','property_operations'
    ),false,'customer',now()
  where not exists(select 1 from public.partner_support_messages m
    where m.conversation_id=v_conversation.id);
  return v_conversation.id;
end
$$;

revoke all on function public.open_property_operations_conversation(
  text,text,jsonb
) from public,anon;
revoke all on function public.open_my_reservation_conversation(text,text)
from public,anon;
grant execute on function public.open_property_operations_conversation(
  text,text,jsonb
) to authenticated,service_role;
grant execute on function public.open_my_reservation_conversation(text,text)
to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  'approved_client_rpc',
  'Actor-scoped property subject; inquiry evolves into the same reservation thread',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'open_property_operations_conversation','open_my_reservation_conversation'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,
  captured_at=excluded.captured_at;
