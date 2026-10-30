begin;
create index if not exists friend_messages_page_idx on public.friend_messages(friend_id,created_at desc,id desc);
drop index if exists public.friend_messages_thread_idx;

create or replace function public.get_friend_encrypted_messages_page(
 p_friend_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 51
) returns table(id uuid,sender_id text,ciphertext text,encryption_iv text,encryption_version integer,
 encrypted_attachments jsonb,reply_to_id uuid,created_at timestamptz,reactions jsonb)
language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.current_profile_user_id(); c public.friends;
begin
 c:=private.friend_chat_access(p_friend_id,false);
 if p_limit is null or p_limit<1 or p_limit>51 then raise exception 'Choose a message page size from 1 to 51';end if;
 if (p_before_at is null)<>(p_before_id is null) then raise exception 'Both message cursor fields are required';end if;
 if p_before_at is not null and not isfinite(p_before_at) then raise exception 'Invalid message cursor';end if;
 return query select m.id,m.sender_id,m.ciphertext,m.encryption_iv,m.encryption_version,
  m.encrypted_attachments,m.reply_to_id,m.created_at,m.reactions
 from public.friend_messages m
 where m.friend_id=c.id and not (actor=any(m.hidden_for))
 and (p_before_at is null or (m.created_at,m.id)<(p_before_at,p_before_id))
 order by m.created_at desc,m.id desc limit p_limit;
end $$;
revoke all on function public.get_friend_encrypted_messages_page(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_friend_encrypted_messages_page(uuid,timestamptz,uuid,integer) to authenticated,service_role;

-- Preserve the legacy signature for old clients while bounding its response.
-- Current clients use the cursor API and can navigate all older history.
create or replace function public.get_friend_encrypted_messages(p_friend_id uuid)
returns table(id uuid,sender_id text,ciphertext text,encryption_iv text,encryption_version integer,
 encrypted_attachments jsonb,reply_to_id uuid,created_at timestamptz,reactions jsonb)
language sql stable security definer set search_path='pg_catalog','public' as $$
 select p.* from public.get_friend_encrypted_messages_page(p_friend_id,null,null,50) p order by p.created_at,p.id
$$;
revoke all on function public.get_friend_encrypted_messages(uuid) from public,anon;
grant execute on function public.get_friend_encrypted_messages(uuid) to authenticated,service_role;

create or replace function public.get_friend_message_history_cursor(p_friend_id uuid,p_message_id uuid)
returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.current_profile_user_id(); c public.friends; target public.friend_messages; boundary record;
begin
 c:=private.friend_chat_access(p_friend_id,false);
 select * into target from public.friend_messages m where m.friend_id=c.id and m.id=p_message_id and not(actor=any(m.hidden_for));
 if target.id is null then raise exception 'Message is unavailable';end if;
 select m.created_at,m.id into boundary from public.friend_messages m where m.friend_id=c.id
 and not(actor=any(m.hidden_for)) and (m.created_at,m.id)>(target.created_at,target.id)
 order by m.created_at,m.id limit 1;
 return jsonb_build_object('before',case when boundary.id is null then null else jsonb_build_object('at',boundary.created_at,'id',boundary.id) end);
end $$;
revoke all on function public.get_friend_message_history_cursor(uuid,uuid) from public,anon;
grant execute on function public.get_friend_message_history_cursor(uuid,uuid) to authenticated,service_role;
commit;
