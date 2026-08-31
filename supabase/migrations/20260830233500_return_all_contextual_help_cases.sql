create or replace function public.get_my_support_conversations()
returns table(
  conversation_id uuid,
  subject text,
  status text,
  category text,
  context_type text,
  context_id text,
  context_snapshot jsonb,
  priority text,
  assigned_staff_name text,
  last_message text,
  last_message_time timestamptz,
  unread_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  select * into v_actor
  from public.profiles
  where auth_id=auth.uid()::text
    and not coalesce(deleted,false)
    and not coalesce(banned,false)
  limit 1;

  if v_actor.user_id is null then raise exception 'Authentication required'; end if;

  return query
  select
    c.id,
    coalesce(nullif(btrim(c.subject),''),'WeHouse Help')::text,
    c.status,
    c.category,
    c.context_type,
    c.context_id,
    c.context_snapshot,
    c.priority,
    coalesce(s.full_name,s.username),
    (select case
       when nullif(btrim(m.content),'') is not null then m.content
       when coalesce(cardinality(m.attachments),0)>0 then 'Attachment'
       else ''
     end
     from public.partner_support_messages m
     where m.conversation_id=c.id
     order by m.created_at desc
     limit 1),
    (select m.created_at
     from public.partner_support_messages m
     where m.conversation_id=c.id
     order by m.created_at desc
     limit 1),
    (select count(*)
     from public.partner_support_messages m
     where m.conversation_id=c.id
       and coalesce(m.is_read,false)=false
       and m.sender_id<>v_actor.user_id),
    c.created_at
  from public.partner_support_conversations c
  left join public.profiles s on s.user_id=c.assigned_staff_id
  where c.partner_id=v_actor.user_id
    and exists (
      select 1 from public.partner_support_messages first_message
      where first_message.conversation_id=c.id
    )
  order by coalesce(
    (select max(latest.created_at) from public.partner_support_messages latest where latest.conversation_id=c.id),
    c.created_at
  ) desc;
end $$;

revoke all on function public.get_my_support_conversations() from public,anon;
grant execute on function public.get_my_support_conversations() to authenticated;
