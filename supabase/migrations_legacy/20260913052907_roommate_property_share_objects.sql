-- Property sharing is a typed, live Inbox object. It is deliberately separate
-- from an invitation to share housing costs. Roommate text remains E2EE; this
-- server-authored object contains only the same public listing projection that
-- a signed-in customer can already view.

alter table public.messages
  add column if not exists item_type text not null default 'message',
  add column if not exists item_payload jsonb not null default '{}'::jsonb;

alter table public.messages
  drop constraint if exists messages_item_type_check;
alter table public.messages
  add constraint messages_item_type_check
  check(item_type in('message','property_share'));

create index if not exists messages_property_share_listing_idx
  on public.messages((item_payload->>'listing_id'))
  where item_type='property_share';

create or replace function public.share_property_to_roommate(
  p_conversation_id uuid,
  p_listing_id text,
  p_client_event_id text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_conversation public.conversations;
  v_peer text;
  v_listing public.listings;
  v_thread_id uuid;
  v_item_id uuid;
  v_message_id uuid;
  v_event_key text;
  v_payload jsonb;
begin
  select * into v_actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null or not public.current_actor_has_personal_workspace() then
    raise exception 'An active Personal account is required';
  end if;

  select * into v_conversation from public.conversations
  where id=p_conversation_id
    and conversation_type='roommate'
    and coalesce(status,'active') in('active','accepted')
    and v_actor.user_id in(participant_a,participant_b)
  for update;
  if v_conversation.id is null then
    raise exception 'Choose an accepted roommate conversation';
  end if;
  v_peer:=case when v_conversation.participant_a=v_actor.user_id
    then v_conversation.participant_b else v_conversation.participant_a end;
  if exists(
    select 1 from public.roommate_user_blocks block_row
    where (block_row.blocker_user_id=v_actor.user_id and block_row.blocked_user_id=v_peer)
       or (block_row.blocker_user_id=v_peer and block_row.blocked_user_id=v_actor.user_id)
  ) then raise exception 'This roommate connection is blocked'; end if;

  select * into v_listing from public.listings
  where (id::text=p_listing_id or listing_id=p_listing_id)
    and deleted_at is null
    and status='available' and availability_status='available'
    and property_type='apartment'
  limit 1;
  if v_listing.id is null then raise exception 'This property is unavailable'; end if;

  if nullif(btrim(coalesce(p_client_event_id,'')),'') is null
    or length(p_client_event_id)>100 then
    raise exception 'A valid client event ID is required';
  end if;
  v_event_key:='roommate-property-share:'||v_actor.user_id||':'||p_client_event_id;
  v_payload:=jsonb_strip_nulls(jsonb_build_object(
    'listing_id',v_listing.id::text,
    'listing_public_id',v_listing.listing_id,
    'title',v_listing.title,
    'image',v_listing.images[1],
    'city',v_listing.city,
    'state',v_listing.state,
    'price',v_listing.price,
    'currency','NGN',
    'product_type',case when v_listing.sub_type='short_let'
      then 'short_let' else 'long_let' end
  ));

  insert into public.canonical_threads(
    thread_type,subject_type,subject_id,state,created_at,updated_at
  ) values(
    'direct','roommate_conversation',v_conversation.id::text,'open',now(),now()
  ) on conflict(thread_type,subject_type,subject_id) do update
    set state=case when canonical_threads.state='closed' then 'read_only'
      else canonical_threads.state end,
      updated_at=now()
  returning thread_id into v_thread_id;

  insert into public.canonical_thread_participants(
    thread_id,user_id,participant_role,can_message,can_view_obligation
  ) values
    (v_thread_id,v_actor.user_id,'roommate',true,true),
    (v_thread_id,v_peer,'roommate',true,true)
  on conflict(thread_id,user_id) do update set
    left_at=null,can_message=true,can_view_obligation=true;

  insert into public.canonical_thread_items(
    thread_id,item_type,sender_user_id,body,payload,event_key
  ) values(
    v_thread_id,'property_share',v_actor.user_id,null,v_payload,v_event_key
  ) on conflict(event_key) do update set event_key=excluded.event_key
  returning thread_item_id into v_item_id;

  select id into v_message_id from public.messages
  where conversation_id=v_conversation.id and item_type='property_share'
    and item_payload->>'canonical_thread_item_id'=v_item_id::text
  limit 1;
  if v_message_id is not null then return v_message_id; end if;

  insert into public.messages(
    conversation_id,sender_id,content,seen,item_type,item_payload,created_at
  ) values(
    v_conversation.id,v_actor.user_id,'Shared a property',false,
    'property_share',v_payload||jsonb_build_object(
      'canonical_thread_id',v_thread_id,
      'canonical_thread_item_id',v_item_id
    ),now()
  ) returning id into v_message_id;

  update public.conversations set
    last_message='Shared a property',last_message_at=now(),
    unread_a=case when participant_a=v_actor.user_id
      then coalesce(unread_a,0) else coalesce(unread_a,0)+1 end,
    unread_b=case when participant_b=v_actor.user_id
      then coalesce(unread_b,0) else coalesce(unread_b,0)+1 end
  where id=v_conversation.id;
  return v_message_id;
end
$$;

-- The return shape adds the typed object and its current public listing state.
-- Dropping is required because PostgreSQL cannot CREATE OR REPLACE a changed
-- RETURNS TABLE signature.
drop function if exists public.get_private_encrypted_messages(text,uuid);
create function public.get_private_encrypted_messages(
  p_conversation_kind text,p_conversation_id uuid
)
returns table(
  id uuid,sender_id text,ciphertext text,encryption_iv text,
  encryption_version integer,encrypted_attachments jsonb,created_at timestamptz,
  legacy_content text,is_read boolean,reply_to_id uuid,reactions jsonb,
  legacy_attachments text[],legacy_attachment_types text[],item_type text,
  item_payload jsonb
)
language plpgsql
security definer
set search_path to ''
as $$
declare actor text:=public.current_profile_user_id();
begin
  if actor is null then raise exception 'Active WeHouse profile required'; end if;
  if p_conversation_kind='roommate' then
    if not exists(
      select 1 from public.conversations c
      where c.id=p_conversation_id
        and actor in(c.participant_a,c.participant_b)
        and c.conversation_type='roommate'
        and coalesce(c.status,'active') in('active','accepted')
    ) then raise exception 'Conversation access denied'; end if;
    return query
    select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,
      coalesce(m.encrypted_attachments,'[]'::jsonb),m.created_at,
      case when m.ciphertext is null then m.content else null end,
      coalesce(m.seen,false),m.reply_to_id,coalesce(m.reactions,'{}'::jsonb),
      coalesce(m.attachments,'{}'::text[]),coalesce(m.attachment_types,'{}'::text[]),
      coalesce(m.item_type,'message'),
      case when m.item_type='property_share' then
        coalesce(m.item_payload,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
          'title',l.title,'image',l.images[1],'city',l.city,'state',l.state,
          'price',l.price,'currency','NGN',
          'product_type',case when l.sub_type='short_let' then 'short_let'
            when l.sub_type='long_stay' then 'long_let' else null end,
          'is_available',coalesce(l.deleted_at is null and l.status='available'
            and l.availability_status='available',false)
        )) else coalesce(m.item_payload,'{}'::jsonb) end
    from public.messages m
    left join public.listings l on m.item_type='property_share'
      and l.id::text=m.item_payload->>'listing_id'
    where m.conversation_id=p_conversation_id
      and not(actor=any(coalesce(m.hidden_for,'{}'::text[])))
    order by m.created_at,m.id;
  elsif p_conversation_kind='worker' then
    if not exists(
      select 1 from public.booking_conversations c
      where c.id=p_conversation_id and actor in(c.user_id,c.worker_id)
    ) then raise exception 'Conversation access denied'; end if;
    return query
    select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,
      coalesce(m.encrypted_attachments,'[]'::jsonb),m.created_at,
      case when m.ciphertext is null then m.content else null end,
      coalesce(m.is_read,false),m.reply_to_id,coalesce(m.reactions,'{}'::jsonb),
      coalesce(m.attachments,'{}'::text[]),'{}'::text[],'message'::text,'{}'::jsonb
    from public.booking_messages m
    where m.conversation_id=p_conversation_id
      and not(actor=any(coalesce(m.hidden_for,'{}'::text[])))
    order by m.created_at,m.id;
  else
    raise exception 'Unsupported private conversation kind';
  end if;
end
$$;

revoke all on function public.share_property_to_roommate(uuid,text,text)
from public,anon;
grant execute on function public.share_property_to_roommate(uuid,text,text)
to authenticated,service_role;
revoke all on function public.get_private_encrypted_messages(text,uuid)
from public,anon;
grant execute on function public.get_private_encrypted_messages(text,uuid)
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
  'approved_client_rpc','Participant-bound roommate chat projection or typed property share',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'share_property_to_roommate','get_private_encrypted_messages'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

comment on function public.share_property_to_roommate(uuid,text,text) is
  'Shares a live public property object in roommate chat; never starts or changes a shared payment.';
