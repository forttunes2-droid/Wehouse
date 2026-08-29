-- A reservation, property or Worker booking must have its own help case.
-- General account help remains a separate conversation.
drop index if exists public.partner_support_one_requester_idx;

create unique index if not exists partner_support_requester_context_idx
  on public.partner_support_conversations (
    partner_id,
    context_type,
    coalesce(context_id, '')
  )
  where partner_id is not null;

create or replace function public.create_support_conversation(
  p_subject text,
  p_category text default 'general',
  p_context_type text default 'general',
  p_context_id text default null,
  p_context_snapshot jsonb default '{}'::jsonb,
  p_priority text default 'normal'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_id uuid;
  v_context_type text := coalesce(nullif(btrim(p_context_type), ''), 'general');
  v_context_id text := nullif(btrim(p_context_id), '');
  v_subject text;
begin
  select * into v_actor
  from public.profiles
  where auth_id = auth.uid()::text
  limit 1;

  if v_actor.user_id is null then raise exception 'Authentication required'; end if;
  if v_actor.role not in ('user','worker','property_partner') then
    raise exception 'WeHouse Help is available to User, Worker and Property Partner accounts';
  end if;
  if coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then
    raise exception 'Account is not active';
  end if;

  v_subject := coalesce(nullif(btrim(p_subject), ''),
    case when v_context_type in ('apartment_reservation','reservation','hotel_booking')
      then 'Reservation help' else 'WeHouse Help' end);

  select id into v_id
  from public.partner_support_conversations
  where partner_id = v_actor.user_id
    and context_type = v_context_type
    and context_id is not distinct from v_context_id
  order by created_at desc
  limit 1;

  if v_id is null then
    insert into public.partner_support_conversations(
      partner_id,requester_role,subject,status,category,context_type,context_id,
      context_snapshot,priority,property_name,property_address,property_city,
      property_state,property_type,rental_mode,created_at,updated_at
    ) values (
      v_actor.user_id,v_actor.role,v_subject,'open',
      coalesce(nullif(btrim(p_category),''),'general'),v_context_type,v_context_id,
      coalesce(p_context_snapshot,'{}'::jsonb),
      case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end,
      nullif(p_context_snapshot->>'property_name',''),
      nullif(p_context_snapshot->>'property_address',''),
      coalesce(nullif(p_context_snapshot->>'city',''),nullif(v_actor.local_government,''),v_actor.city),
      v_actor.state,nullif(p_context_snapshot->>'property_type',''),
      nullif(p_context_snapshot->>'rental_mode',''),now(),now()
    ) returning id into v_id;
  else
    update public.partner_support_conversations
    set requester_role = v_actor.role,
        status = 'open',
        subject = v_subject,
        category = coalesce(nullif(btrim(p_category),''),category,'general'),
        context_snapshot = case
          when coalesce(p_context_snapshot,'{}'::jsonb) <> '{}'::jsonb then p_context_snapshot
          else context_snapshot end,
        priority = case when p_priority in ('low','normal','high','urgent') then p_priority else priority end,
        updated_at = now(),resolved_at = null,closed_at = null
    where id = v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.create_support_conversation(text,text,text,text,jsonb,text) from public, anon;
grant execute on function public.create_support_conversation(text,text,text,text,jsonb,text) to authenticated, service_role;
