begin;
-- Keep customer enquiries and property operations distinct for multi-role people.
CREATE OR REPLACE FUNCTION public.open_property_operations_conversation(p_subject_type text, p_subject_id text, p_snapshot jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_actor public.profiles;
  v_thread public.canonical_threads;
  v_conversation public.partner_support_conversations;
  v_snapshot jsonb;
  v_title text;
  v_state text;
  v_allowed boolean:=false;
  v_owns boolean:=false;
  v_hotel_staff boolean:=false;
  v_default_workspace text;
  v_workspace text;
  v_thread_key text;
  v_access jsonb;
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
      )),coalesce(v_actor.user_id in(l.owner_id,l.partner_id),false)
    into v_title,v_state,v_allowed,v_owns
    from public.listings l
    where l.id::text=p_subject_id or l.listing_id=p_subject_id limit 1;
  else
    select coalesce(h.name,'Hotel'),h.state,
      (h.status='active' and h.approved_at is not null)
      or h.owner_id=v_actor.user_id
      or public.hotel_actor_has_capability(h.hotel_id,'stay.read'),
      coalesce(h.owner_id=v_actor.user_id,false),
      public.hotel_actor_has_capability(h.hotel_id,'stay.read')
    into v_title,v_state,v_allowed,v_owns,v_hotel_staff
    from public.hotels h where h.hotel_id::text=p_subject_id limit 1;
  end if;
  if not coalesce(v_allowed,false) then
    raise exception 'This property is not available to this account'; end if;

  v_default_workspace:=case when v_owns then 'property_partner'
    when v_hotel_staff then 'hotel' else 'personal' end;
  v_workspace:=coalesce(nullif(p_snapshot->>'requester_workspace',''),v_default_workspace);
  if v_workspace not in ('personal','worker','property_partner','hotel') then
    raise exception 'Unsupported workspace'; end if;
  v_access:=public.get_my_workspace_access();
  if v_workspace<>'personal' and not exists(
    select 1 from jsonb_array_elements(v_access->'privileged_workspaces') item
    where item->>'role'=v_workspace
  ) then raise exception 'Workspace access required'; end if;

  -- Retain a legacy thread only when its origin matches. Otherwise the same
  -- person gets a separate customer/work topic; no existing message is moved.
  select t.thread_key into v_thread_key
  from public.canonical_threads t
  join public.partner_support_conversations c on c.canonical_thread_id=t.thread_id
  where t.thread_type='property_inquiry' and t.subject_type=p_subject_type
    and t.subject_id=p_subject_id and c.partner_id=v_actor.user_id
    and coalesce(nullif(c.context_snapshot->>'requester_workspace',''),v_default_workspace)=v_workspace
  order by c.created_at limit 1;
  v_thread_key:=coalesce(v_thread_key,p_subject_type||':'||p_subject_id||':requester:'||v_actor.user_id||':workspace:'||v_workspace);

  v_snapshot:=coalesce(p_snapshot,'{}'::jsonb)
    -'booking_code'-'check_in_code'-'access_code'-'verification_code'
    -'handover_code'-'recovery_code';
  v_snapshot:=v_snapshot||jsonb_build_object(
    'source_type',p_subject_type,'source_id',p_subject_id,
    'owning_domain','property_operations','state_scope',v_state,
    'requester_workspace',v_workspace,
    case when p_subject_type='listing' then 'listing_title' else 'hotel_name' end,v_title
  );

  insert into public.canonical_threads(
    thread_type,thread_key,subject_type,subject_id,state,created_at,updated_at
  ) values(
    'property_inquiry',v_thread_key,
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

CREATE OR REPLACE FUNCTION public.open_my_reservation_conversation(p_context_type text, p_context_id text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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
      -- A personal booking may inherit its customer enquiry, never the owner's
      -- property work conversation. Legacy records use real property ownership.
      and coalesce(nullif(c.context_snapshot->>'requester_workspace',''),case
        when v_prior_subject_type='listing' and exists(
          select 1 from public.listings l where (l.listing_id=v_prior_subject_id or l.id::text=v_prior_subject_id)
            and v_actor.user_id in(l.owner_id,l.partner_id)) then 'property_partner'
        when v_prior_subject_type='hotel_property' and exists(
          select 1 from public.hotels h where h.hotel_id::text=v_prior_subject_id
            and (h.owner_id=v_actor.user_id or public.hotel_actor_has_capability(h.hotel_id,'stay.read'))) then 'hotel'
        else 'personal' end)='personal'
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
revoke all on function public.open_property_operations_conversation(text,text,jsonb) from public,anon;
revoke all on function public.open_my_reservation_conversation(text,text) from public,anon;
grant execute on function public.open_property_operations_conversation(text,text,jsonb) to authenticated,service_role;
grant execute on function public.open_my_reservation_conversation(text,text) to authenticated,service_role;
commit;
