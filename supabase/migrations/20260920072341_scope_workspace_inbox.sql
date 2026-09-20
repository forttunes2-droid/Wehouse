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
      when thread.context_type in ('property_inspection','property_listing','hotel_property','hotel_operations') then 'property_partner'
      when thread.context_type in ('worker_booking','worker_job') or thread.context_snapshot->>'subject_type'='worker_job' then
        case when exists(select 1 from public.worker_bookings booking
          where booking.id::text=coalesce(thread.context_snapshot->>'source_id',thread.context_id)
            and booking.worker_id=actor) then 'worker' else 'personal' end
      when thread.context_snapshot->>'requester_workspace' in ('personal','worker','property_partner','hotel') then thread.context_snapshot->>'requester_workspace'
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
commit;
