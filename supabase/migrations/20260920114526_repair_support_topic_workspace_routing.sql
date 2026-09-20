begin;

-- A person can buy services and also provide them. Keep those inboxes separate.
-- Existing functions still own message visibility, hidden threads and unread rules.
-- This authenticated projection only narrows their results; it creates no records.
create or replace function public.get_my_workspace_inbox(p_workspace text, p_kind text)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare actor text; result jsonb; access jsonb;
begin
  select user_id into actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false);
  if actor is null then raise exception 'Authentication required'; end if;
  if p_workspace is null or p_workspace not in ('personal','worker','property_partner','hotel') then
    raise exception 'Unsupported workspace';
  end if;
  access:=public.get_my_workspace_access();
  if p_workspace<>'personal' and not exists (
    select 1 from jsonb_array_elements(access->'privileged_workspaces') item where item->>'role'=p_workspace
  ) then raise exception 'Workspace access required'; end if;

  if p_kind='service' and p_workspace in ('personal','worker') then
    select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc),'[]'::jsonb) into result
    from public.get_my_booking_conversations_v3(actor) row
    join public.booking_conversations thread on thread.id=row.conversation_id
    where (p_workspace='personal' and thread.user_id=actor)
       or (p_workspace='worker' and thread.worker_id=actor);
  elsif p_kind='hotel' and p_workspace in ('personal','property_partner','hotel') then
    select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc),'[]'::jsonb) into result
    from public.get_my_hotel_booking_conversations() row
    where (p_workspace='personal' and row.guest_user_id=actor)
       or (p_workspace<>'personal' and row.guest_user_id<>actor);
  elsif p_kind='wehouse' then
    select coalesce(jsonb_agg(to_jsonb(row) order by coalesce(row.last_message_time,row.created_at) desc),'[]'::jsonb) into result
    from public.get_my_support_conversations() row
    join public.partner_support_conversations thread on thread.id=row.conversation_id
    where thread.partner_id=actor and (case
      when thread.context_type in ('apartment_reservation','reservation','apartment_payment','hotel_booking') then 'personal'
      when thread.context_type in ('worker_booking','worker_job')
        or thread.context_snapshot->>'subject_type'='worker_job'
        or thread.context_snapshot->>'source_type'='worker_job'
        or thread.context_snapshot->>'reason_code'='worker_job_issue' then
        case when exists(select 1 from public.worker_bookings booking
          where booking.id::text=coalesce(thread.context_snapshot->>'source_id',thread.context_id)
            and booking.worker_id=actor) then 'worker' else 'personal' end
      when thread.context_snapshot->>'requester_workspace' in ('personal','worker','property_partner','hotel') then thread.context_snapshot->>'requester_workspace'
      -- Public hotel/listing enquiries are customer work even when the legacy
      -- profile role is Worker. Explicit originating workspace above takes
      -- precedence; older records fall back to real ownership/capability.
      when thread.context_type='property_inspection' then 'property_partner'
      when thread.context_type in ('property_listing','listing') then
        case when exists(select 1 from public.listings listing
          where (listing.id::text=thread.context_id or listing.listing_id=thread.context_id)
            and actor in (listing.owner_id,listing.partner_id))
          then 'property_partner' else 'personal' end
      when thread.context_type in ('hotel_property','hotel_operations') then
        case when exists(select 1 from public.hotels hotel
          where hotel.hotel_id::text=thread.context_id and hotel.owner_id=actor)
          then 'property_partner'
        when exists(select 1 from public.hotels hotel
          where hotel.hotel_id::text=thread.context_id
            and public.hotel_actor_has_capability(hotel.hotel_id,'stay.read'))
          then 'hotel' else 'personal' end
      when coalesce(thread.requester_role,'user')='user' then 'personal'
      when thread.requester_role='hotel_staff' then 'hotel'
      else thread.requester_role end)=p_workspace;
  else raise exception 'Unsupported inbox';
  end if;
  return result;
end;
$$;
revoke all on function public.get_my_workspace_inbox(text,text) from public,anon;
grant execute on function public.get_my_workspace_inbox(text,text) to authenticated,service_role;
comment on function public.get_my_workspace_inbox(text,text) is
  'Read-only authenticated projection separating customer, provider and property work conversations without duplicating messages.';

-- The property factory accepts listing/hotel_property and returns JSON.
-- Preserve the atomic draft, attachment and ownership checks on first Send.
create or replace function public.send_my_first_wehouse_message(
  p_draft_id uuid,
  p_subject text,
  p_category text default 'general',
  p_context_type text default 'general',
  p_context_id text default null,
  p_context_snapshot jsonb default '{}'::jsonb,
  p_priority text default 'normal',
  p_content text default '',
  p_attachments text[] default '{}'::text[],
  p_attachment_types text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','storage'
as $$
declare
  v_actor public.profiles;
  v_draft public.support_message_drafts;
  v_conversation_id uuid;
  v_message_id uuid;
  v_context text:=lower(coalesce(nullif(btrim(p_context_type),''),'general'));
  v_source text;
  v_snapshot jsonb;
  v_prefix text;
  v_path text;
  v_type text;
  v_index integer;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active WeHouse account required'; end if;

  select * into v_draft
  from public.support_message_drafts
  where draft_id=p_draft_id
  for update;
  if v_draft.draft_id is null or v_draft.requester_id<>v_actor.user_id then
    raise exception 'Message draft was not found';
  end if;
  if v_draft.consumed_at is not null then
    return jsonb_build_object(
      'conversation_id',v_draft.conversation_id,
      'message_id',v_draft.message_id,
      'replayed',true
    );
  end if;
  if v_draft.expires_at<=now() then raise exception 'Message draft expired'; end if;

  if nullif(btrim(coalesce(p_content,'')),'') is null
     and coalesce(cardinality(p_attachments),0)=0 then
    raise exception 'Message or attachment is required';
  end if;
  if coalesce(cardinality(p_attachments),0)<>coalesce(cardinality(p_attachment_types),0) then
    raise exception 'Attachment metadata mismatch';
  end if;
  if coalesce(cardinality(p_attachments),0)>6 then
    raise exception 'A maximum of 6 evidence files can be sent at once';
  end if;

  v_prefix:='drafts/'||v_actor.user_id||'/'||p_draft_id::text||'/';
  if coalesce(cardinality(p_attachments),0)>0 then
    for v_index in 1..cardinality(p_attachments) loop
      v_path:=p_attachments[v_index];
      v_type:=lower(coalesce(p_attachment_types[v_index],''));
      if v_path is null or left(v_path,length(v_prefix))<>v_prefix then
        raise exception 'Evidence path does not belong to this draft';
      end if;
      if v_type not in(
        'image/jpeg','image/png','image/webp','image/gif',
        'video/mp4','video/webm','video/quicktime',
        'application/pdf','text/plain','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) then
        raise exception 'Unsupported evidence file type';
      end if;
      if not exists(
        select 1 from storage.objects o
        where o.bucket_id='support-files' and o.name=v_path
      ) then
        raise exception 'Evidence upload is incomplete';
      end if;
    end loop;
  end if;

  v_snapshot:=coalesce(p_context_snapshot,'{}'::jsonb)
    -'booking_code'-'check_in_code'-'access_code'-'verification_code'
    -'handover_code'-'recovery_code';
  v_source:=lower(coalesce(nullif(btrim(v_snapshot->>'source_type'),''),v_context));

  if v_context in('reservation','apartment_payment') then
    v_context:='apartment_reservation';
  elsif v_context='listing' then
    v_context:='property_listing';
  end if;

  -- Reuse an already-created context if another device won the race. This keeps
  -- one context/purpose identity without creating a second customer thread.
  if v_context='property_inspection'
     and nullif(btrim(coalesce(v_snapshot->>'reservation_id','')),'') is not null then
    v_conversation_id:=public.open_my_reservation_conversation(
      'apartment_reservation',v_snapshot->>'reservation_id'
    );
  elsif v_context in('apartment_reservation','hotel_booking') then
    select c.id into v_conversation_id
    from public.partner_support_conversations c
    where c.partner_id=v_actor.user_id
      and (case when c.context_type in('reservation','apartment_payment')
        then 'apartment_reservation' else c.context_type end)=v_context
      and coalesce(c.context_id,'')=coalesce(p_context_id,'')
    order by c.created_at
    limit 1;

    if v_conversation_id is null then
      v_conversation_id:=public.open_my_reservation_conversation(v_context,p_context_id);
    end if;
  elsif v_context='worker_booking' then
    v_conversation_id:=(public.open_contextual_case_conversation(
      'worker_job_issue','worker_job',p_context_id,
      nullif(btrim(coalesce(p_subject,'')),''),v_snapshot
    )->>'conversation_id')::uuid;
  elsif v_context='property_listing' then
    v_conversation_id:=(public.open_property_operations_conversation(
      'listing',p_context_id,v_snapshot
    )->>'conversation_id')::uuid;
  elsif v_context in('hotel_property','hotel_operations') then
    v_conversation_id:=(public.open_property_operations_conversation(
      'hotel_property',p_context_id,v_snapshot
    )->>'conversation_id')::uuid;
  else
    select c.id into v_conversation_id
    from public.partner_support_conversations c
    where c.partner_id=v_actor.user_id
      and c.context_type='support_case'
      and coalesce(c.context_id,'')=coalesce(p_context_id,'')
      and lower(coalesce(nullif(c.context_snapshot->>'source_type',''),'general'))=v_source
    order by c.created_at
    limit 1;

    if v_conversation_id is null then
      v_conversation_id:=public.create_my_support_case(
        coalesce(nullif(btrim(p_subject),''),'WeHouse'),
        coalesce(nullif(btrim(p_category),''),'general'),
        v_source,
        p_context_id,
        v_snapshot,
        coalesce(nullif(btrim(p_priority),''),'normal')
      );
    end if;
  end if;

  if v_conversation_id is null then raise exception 'WeHouse conversation could not be created'; end if;

  v_message_id:=public.send_support_message(
    v_conversation_id,
    btrim(coalesce(p_content,'')),
    coalesce(p_attachments,'{}'::text[]),
    coalesce(p_attachment_types,'{}'::text[]),
    'message',
    jsonb_build_object(
      'category',coalesce(nullif(btrim(p_category),''),'general'),
      'context_type',v_context,
      'context_id',p_context_id,
      'context_snapshot',v_snapshot,
      'subject',nullif(btrim(coalesce(p_subject,'')),'')
    ),
    'customer'
  );

  update public.support_message_drafts
  set conversation_id=v_conversation_id,
      message_id=v_message_id,
      consumed_at=now()
  where draft_id=p_draft_id;

  return jsonb_build_object(
    'conversation_id',v_conversation_id,
    'message_id',v_message_id,
    'replayed',false
  );
end;
$$;

revoke all on function public.send_my_first_wehouse_message(uuid,text,text,text,text,jsonb,text,text,text[],text[]) from public,anon;
grant execute on function public.send_my_first_wehouse_message(uuid,text,text,text,text,jsonb,text,text,text[],text[]) to authenticated;
commit;
