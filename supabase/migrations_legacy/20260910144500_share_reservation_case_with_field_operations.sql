-- Field Operations joins an existing Property Operations reservation case.
-- The conversation keeps its owner/channel, but is visible in the assigned
-- officer's queue as well. This avoids splitting one handover into two chats.

create or replace function public.support_inbox(p_queue text default 'support')
returns table(
  conversation_id uuid,requester_id text,requester_role text,requester_name text,
  requester_email text,requester_state text,requester_lga text,subject text,status text,
  category text,context_type text,context_id text,context_snapshot jsonb,priority text,
  assigned_staff_id text,assigned_staff_name text,last_message text,
  last_message_time timestamptz,unread_count bigint,created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  actor public.profiles;
  required_permission text;
begin
  if p_queue not in ('all','operations','property_operations','reservation_operations','field_operations','support') then
    raise exception 'Invalid communication context';
  end if;
  select * into actor from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false)
  limit 1;
  if actor.user_id is null then raise exception 'Authentication required'; end if;
  required_permission:=case
    when p_queue in ('operations','property_operations','reservation_operations') then 'operations'
    when p_queue='field_operations' then 'field_officer'
    when p_queue='support' then 'support'
    else null
  end;
  if p_queue='all' and actor.role not in ('creator','admin') then raise exception 'Creator or Admin access required'; end if;
  if p_queue<>'all' and actor.role not in ('creator','admin')
     and not(actor.role='staff' and public.current_staff_has_permission(required_permission)) then
    raise exception 'This communication context is outside your work area';
  end if;

  return query
  select c.id,c.partner_id,coalesce(c.requester_role,p.role),coalesce(p.full_name,p.username,p.email),p.email,p.state,
    coalesce(nullif(p.local_government,''),p.city),c.subject,c.status,c.category,c.context_type,c.context_id,c.context_snapshot,c.priority,
    case when p_queue='field_operations' or c.channel_kind='field_operations' then c.assigned_field_officer_id else c.assigned_staff_id end,
    coalesce(s.full_name,s.username),
    (select case when nullif(btrim(m.content),'') is not null then m.content when cardinality(m.attachments)>0 then 'Attachment' else '' end
      from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select m.created_at from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
    (select count(*) from public.partner_support_messages m where m.conversation_id=c.id and not coalesce(m.is_read,false) and m.sender_id<>actor.user_id),
    c.created_at
  from public.partner_support_conversations c
  join public.profiles p on p.user_id=c.partner_id
  left join public.profiles s on s.user_id=case
    when p_queue='field_operations' or c.channel_kind='field_operations' then c.assigned_field_officer_id
    else c.assigned_staff_id
  end
  where exists(select 1 from public.partner_support_messages m where m.conversation_id=c.id)
    and case p_queue
      when 'all' then true
      when 'operations' then c.channel_kind in ('property_operations','reservation_operations')
      when 'property_operations' then c.channel_kind='property_operations'
      when 'reservation_operations' then c.channel_kind='reservation_operations'
      when 'field_operations' then c.channel_kind='field_operations' or c.assigned_field_officer_id is not null
      else coalesce(c.channel_kind,'support_case')='support_case'
    end
    and (
      actor.role='creator'
      or (p_queue='field_operations' and c.assigned_field_officer_id=actor.user_id)
      or (
        lower(btrim(coalesce(p.state,'')))=lower(btrim(coalesce(actor.assigned_state,'')))
        and lower(btrim(coalesce(nullif(p.local_government,''),p.city,'')))=lower(btrim(coalesce(actor.assigned_lga,'')))
      )
    )
    and (
      actor.role<>'staff'
      or (p_queue='field_operations' and c.assigned_field_officer_id=actor.user_id)
      or (p_queue<>'field_operations' and (c.assigned_staff_id is null or c.assigned_staff_id=actor.user_id))
    )
  order by
    case when c.assigned_field_officer_id=actor.user_id or c.assigned_staff_id=actor.user_id then 0
         when c.assigned_staff_id is null then 1 else 2 end,
    c.updated_at desc;
end;
$$;

revoke all on function public.support_inbox(text) from public;
grant execute on function public.support_inbox(text) to authenticated,service_role;
