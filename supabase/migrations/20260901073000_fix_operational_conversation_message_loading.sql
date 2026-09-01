create or replace function public.get_support_messages(p_conversation_id uuid)
returns table(
  id uuid, sender_id text, sender_name text, sender_role text, content text,
  attachments text[], attachment_types text[], action_type text,
  action_metadata jsonb, is_read boolean, created_at timestamptz
) language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare
  v_actor public.profiles;
  v_conv public.partner_support_conversations;
  v_staff_ok boolean := false;
begin
  select p.* into v_actor from public.profiles p where p.auth_id=auth.uid()::text limit 1;
  if v_actor.user_id is null then raise exception 'Authentication required'; end if;
  select c.* into v_conv from public.partner_support_conversations c where c.id=p_conversation_id;
  if v_conv.id is null then raise exception 'Conversation not found'; end if;
  if v_actor.role='staff' then
    select exists(select 1 from public.staff_permissions sp where sp.staff_id=v_actor.user_id and sp.permission='support' and coalesce(sp.is_active,true) and sp.revoked_at is null) into v_staff_ok;
  end if;
  if not (
    v_actor.user_id=v_conv.partner_id or v_actor.user_id=v_conv.assigned_staff_id
    or v_actor.user_id=v_conv.assigned_field_officer_id or v_actor.role in ('admin','creator')
    or (v_staff_ok and v_conv.assigned_staff_id is null)
  ) then raise exception 'Not authorised'; end if;
  return query
  select m.id,m.sender_id,coalesce(p.full_name,p.username,'WeHouse'),m.sender_role,
    m.content,m.attachments,m.attachment_types,m.action_type,m.action_metadata,m.is_read,m.created_at
  from public.partner_support_messages m
  left join public.profiles p on p.user_id=m.sender_id
  where m.conversation_id=p_conversation_id
  order by m.created_at;
end $$;

create or replace function public.mark_support_messages_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare
  v_actor public.profiles;
  v_conv public.partner_support_conversations;
  v_staff_ok boolean := false;
begin
  select p.* into v_actor from public.profiles p where p.auth_id=auth.uid()::text limit 1;
  select c.* into v_conv from public.partner_support_conversations c where c.id=p_conversation_id;
  if v_actor.user_id is null or v_conv.id is null then raise exception 'Conversation not found'; end if;
  if v_actor.role='staff' then
    select exists(select 1 from public.staff_permissions sp where sp.staff_id=v_actor.user_id and sp.permission='support' and coalesce(sp.is_active,true) and sp.revoked_at is null) into v_staff_ok;
  end if;
  if not (
    v_actor.user_id=v_conv.partner_id or v_actor.user_id=v_conv.assigned_staff_id
    or v_actor.user_id=v_conv.assigned_field_officer_id or v_actor.role in ('admin','creator')
    or (v_staff_ok and v_conv.assigned_staff_id is null)
  ) then raise exception 'Not authorised'; end if;
  update public.partner_support_messages m set is_read=true
  where m.conversation_id=p_conversation_id and m.sender_id<>v_actor.user_id and not coalesce(m.is_read,false);
end $$;

revoke all on function public.get_support_messages(uuid),public.mark_support_messages_read(uuid) from public,anon;
grant execute on function public.get_support_messages(uuid),public.mark_support_messages_read(uuid) to authenticated;
