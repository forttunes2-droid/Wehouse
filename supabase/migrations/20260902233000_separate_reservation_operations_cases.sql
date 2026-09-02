-- Reservation Desk is an Operations queue. General help remains a Support queue.
drop function if exists public.support_inbox();
create or replace function public.support_inbox(p_queue text default 'support')
returns table(conversation_id uuid,requester_id text,requester_role text,requester_name text,requester_email text,requester_state text,requester_lga text,subject text,status text,category text,context_type text,context_id text,context_snapshot jsonb,priority text,assigned_staff_id text,assigned_staff_name text,last_message text,last_message_time timestamptz,unread_count bigint,created_at timestamptz)
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare actor public.profiles; allowed boolean:=false;
begin
 if p_queue not in ('support','reservation_operations') then raise exception 'Invalid communication queue'; end if;
 select * into actor from public.profiles where auth_id=auth.uid()::text limit 1;
 if actor.user_id is null then raise exception 'Authentication required'; end if;
 allowed:=actor.role in ('admin','creator') or (actor.role='staff' and public.current_staff_has_permission(case when p_queue='reservation_operations' then 'operations' else 'support' end));
 if not allowed then raise exception 'This communication queue is outside your Staff responsibility'; end if;
 return query
 select c.id,c.partner_id,coalesce(c.requester_role,p.role),coalesce(p.full_name,p.username,p.email),p.email,p.state,coalesce(nullif(p.local_government,''),p.city),
   c.subject,c.status,c.category,c.context_type,c.context_id,c.context_snapshot,c.priority,c.assigned_staff_id,coalesce(s.full_name,s.username),
   (select case when nullif(btrim(m.content),'') is not null then m.content when cardinality(m.attachments)>0 then 'Attachment' else '' end from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
   (select m.created_at from public.partner_support_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),
   (select count(*) from public.partner_support_messages m where m.conversation_id=c.id and not coalesce(m.is_read,false) and m.sender_id<>actor.user_id),c.created_at
 from public.partner_support_conversations c join public.profiles p on p.user_id=c.partner_id left join public.profiles s on s.user_id=c.assigned_staff_id
 where exists(select 1 from public.partner_support_messages m where m.conversation_id=c.id)
   and (case when p_queue='reservation_operations' then c.channel_kind='reservation_operations' else coalesce(c.channel_kind,'support') not in ('reservation_operations','property_operations') end)
   and (actor.role='creator' or (p.state=actor.assigned_state and coalesce(nullif(p.local_government,''),p.city)=actor.assigned_lga))
   and (actor.role<>'staff' or c.assigned_staff_id is null or c.assigned_staff_id=actor.user_id)
 order by case when c.assigned_staff_id=actor.user_id then 0 when c.assigned_staff_id is null then 1 else 2 end,c.updated_at desc;
end $$;

revoke all on function public.support_inbox(text) from public,anon;
grant execute on function public.support_inbox(text) to authenticated,service_role;

create or replace function public.can_access_operational_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path='pg_catalog','public' as $$
 select exists(
  select 1 from public.partner_support_conversations c join public.profiles p on p.auth_id=auth.uid()::text
  where c.id=p_conversation_id and (
   p.user_id in (c.partner_id,c.assigned_staff_id,c.assigned_field_officer_id) or p.role in ('admin','creator') or
   (p.role='staff' and c.assigned_staff_id is null and public.current_staff_has_permission(case when c.channel_kind='reservation_operations' then 'operations' else 'support' end))
  )
 )
$$;
revoke all on function public.can_access_operational_conversation(uuid) from public,anon;
grant execute on function public.can_access_operational_conversation(uuid) to authenticated,service_role;

create or replace function public.claim_my_communication_case(p_conversation_id uuid)
returns boolean language plpgsql security definer set search_path='pg_catalog','public' as $$
declare actor public.profiles; channel text; owner_id text; owner_state text; owner_lga text;
begin
 select * into actor from public.profiles where auth_id=auth.uid()::text limit 1;
 if actor.user_id is null or actor.role<>'staff' then raise exception 'Active Staff account required'; end if;
 select c.channel_kind,p.user_id,p.state,coalesce(nullif(p.local_government,''),p.city) into channel,owner_id,owner_state,owner_lga
 from public.partner_support_conversations c join public.profiles p on p.user_id=c.partner_id
 where c.id=p_conversation_id for update of c;
 if owner_id is null then raise exception 'Conversation not found'; end if;
 if actor.assigned_state is distinct from owner_state or actor.assigned_lga is distinct from owner_lga then raise exception 'Conversation is outside your branch'; end if;
 if not public.current_staff_has_permission(case when channel='reservation_operations' then 'operations' else 'support' end) then raise exception 'Conversation is outside your Staff responsibility'; end if;
 update public.partner_support_conversations set assigned_staff_id=actor.user_id,updated_at=now()
 where id=p_conversation_id and (assigned_staff_id is null or assigned_staff_id=actor.user_id);
 if not found then raise exception 'This conversation is already assigned to another Staff member'; end if;
 return true;
end $$;
revoke all on function public.claim_my_communication_case(uuid) from public,anon;
grant execute on function public.claim_my_communication_case(uuid) to authenticated,service_role;
