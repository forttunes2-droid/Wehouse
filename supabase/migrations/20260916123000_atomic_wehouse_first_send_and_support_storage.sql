-- Canonical Message WeHouse first-send contract.
-- Opening a composer creates no conversation. Evidence may be staged against a
-- short-lived draft. The first successful Send creates/reuses the canonical
-- conversation and inserts the first customer message in one database transaction.

create table if not exists public.support_message_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  requester_id text not null references public.profiles(user_id) on delete cascade,
  conversation_id uuid null references public.partner_support_conversations(id) on delete set null,
  message_id uuid null references public.partner_support_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  consumed_at timestamptz null,
  constraint support_message_drafts_expiry_check check (expires_at > created_at),
  constraint support_message_drafts_consumed_pair_check check (
    (consumed_at is null and conversation_id is null and message_id is null)
    or
    (consumed_at is not null and conversation_id is not null and message_id is not null)
  )
);

create index if not exists support_message_drafts_requester_active_idx
  on public.support_message_drafts(requester_id, expires_at desc)
  where consumed_at is null;

alter table public.support_message_drafts enable row level security;
revoke all on table public.support_message_drafts from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'support-files',
  'support-files',
  false,
  26214400,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime',
    'application/pdf','text/plain','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function private.can_access_support_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path='pg_catalog','public','private','storage'
as $$
declare
  v_parts text[]:=storage.foldername(p_name);
  v_conversation uuid;
  v_draft uuid;
  v_actor text:=public.current_profile_user_id();
begin
  if coalesce(array_length(v_parts,1),0)>=3 and v_parts[1]='drafts' then
    if v_actor is null or v_parts[2]<>v_actor then return false; end if;
    begin v_draft:=v_parts[3]::uuid; exception when others then return false; end;
    return exists(
      select 1 from public.support_message_drafts d
      where d.draft_id=v_draft
        and d.requester_id=v_actor
        and d.consumed_at is null
        and d.expires_at>now()
    );
  end if;

  if coalesce(array_length(v_parts,1),0)<1 then return false; end if;
  begin v_conversation:=v_parts[1]::uuid; exception when others then return false; end;
  return private.can_access_support_conversation(v_conversation);
end;
$$;

create or replace function private.can_read_support_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path='pg_catalog','public','private','storage'
as $$
declare
  v_parts text[]:=storage.foldername(p_name);
  v_actor text:=public.current_profile_user_id();
  v_actor_role text:=public.current_profile_role();
  v_draft uuid;
begin
  if coalesce(array_length(v_parts,1),0)>=3 and v_parts[1]='drafts' then
    begin v_draft:=v_parts[3]::uuid; exception when others then v_draft:=null; end;
    if v_draft is not null and v_actor is not null and v_parts[2]=v_actor and exists(
      select 1 from public.support_message_drafts d
      where d.draft_id=v_draft
        and d.requester_id=v_actor
        and d.consumed_at is null
        and d.expires_at>now()
    ) then
      return true;
    end if;
  end if;

  return exists(
    select 1
    from public.partner_support_messages m
    where p_name=any(coalesce(m.attachments,'{}'::text[]))
      and private.can_access_support_conversation(m.conversation_id)
      and (
        coalesce(m.visibility,'customer')<>'internal'
        or v_actor_role in('staff','admin','creator')
        or public.current_actor_has_workspace('staff',null)
        or public.current_actor_has_workspace('admin',null)
        or public.current_actor_has_workspace('creator',null)
      )
  );
end;
$$;

revoke all on function private.can_access_support_object(text) from public, anon, authenticated;
revoke all on function private.can_read_support_object(text) from public, anon, authenticated;

-- Storage access is capability-based. Draft paths are temporary and writable only
-- by their owner; sent evidence becomes readable only through the message record.
drop policy if exists support_files_insert on storage.objects;
create policy support_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='support-files'
  and private.can_access_support_object(name)
);

drop policy if exists support_files_read on storage.objects;
create policy support_files_read on storage.objects
for select to authenticated
using (
  bucket_id='support-files'
  and private.can_read_support_object(name)
);

drop policy if exists support_files_delete on storage.objects;
create policy support_files_delete on storage.objects
for delete to authenticated
using (
  bucket_id='support-files'
  and private.can_access_support_object(name)
);

create or replace function public.create_my_support_message_draft()
returns uuid
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_draft uuid;
begin
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Active WeHouse account required'; end if;

  insert into public.support_message_drafts(requester_id)
  values(v_actor.user_id)
  returning draft_id into v_draft;
  return v_draft;
end;
$$;

create or replace function public.get_my_support_message_draft_status(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_draft public.support_message_drafts;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_draft
  from public.support_message_drafts
  where draft_id=p_draft_id and requester_id=v_actor;
  if v_draft.draft_id is null then return null; end if;
  return jsonb_build_object(
    'draft_id',v_draft.draft_id,
    'state',case
      when v_draft.consumed_at is not null then 'sent'
      when v_draft.expires_at<=now() then 'expired'
      else 'draft'
    end,
    'conversation_id',v_draft.conversation_id,
    'message_id',v_draft.message_id,
    'expires_at',v_draft.expires_at,
    'consumed_at',v_draft.consumed_at
  );
end;
$$;

create or replace function public.discard_my_support_message_draft(p_draft_id uuid)
returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  delete from public.support_message_drafts
  where draft_id=p_draft_id
    and requester_id=v_actor
    and consumed_at is null;
  return found;
end;
$$;

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
  elsif v_context='property_listing' then
    v_conversation_id:=public.open_property_operations_conversation(
      'apartment',p_context_id,v_snapshot
    );
  elsif v_context in('hotel_property','hotel_operations') then
    v_conversation_id:=public.open_property_operations_conversation(
      'hotel',p_context_id,v_snapshot
    );
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

revoke all on function public.create_my_support_message_draft() from public, anon;
revoke all on function public.get_my_support_message_draft_status(uuid) from public, anon;
revoke all on function public.discard_my_support_message_draft(uuid) from public, anon;
revoke all on function public.send_my_first_wehouse_message(uuid,text,text,text,text,jsonb,text,text,text[],text[]) from public, anon;

grant execute on function public.create_my_support_message_draft() to authenticated;
grant execute on function public.get_my_support_message_draft_status(uuid) to authenticated;
grant execute on function public.discard_my_support_message_draft(uuid) to authenticated;
grant execute on function public.send_my_first_wehouse_message(uuid,text,text,text,text,jsonb,text,text,text[],text[]) to authenticated;

comment on function public.send_my_first_wehouse_message(uuid,text,text,text,text,jsonb,text,text,text[],text[])
is 'Idempotent first-Send boundary: conversation/request creation and the first customer message commit together or roll back together.';
