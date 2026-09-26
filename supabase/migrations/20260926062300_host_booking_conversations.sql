-- Dedicated guest <-> responsible Host conversation for Host-managed homes.
-- WeHouse support/operations threads remain separate and hosts never gain those records.

create table if not exists public.property_host_conversations(
  conversation_id uuid primary key default gen_random_uuid(),
  reservation_id text not null unique references public.reservations(id) on delete cascade,
  guest_user_id text not null references public.profiles(user_id) on delete cascade,
  host_user_id text not null references public.profiles(user_id) on delete cascade,
  status text not null default 'open' check(status in ('open','closed')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_host_messages(
  message_id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.property_host_conversations(conversation_id) on delete cascade,
  sender_id text not null references public.profiles(user_id) on delete cascade,
  content text,
  attachments text[] not null default array[]::text[],
  attachment_types text[] not null default array[]::text[],
  reply_to_id uuid references public.property_host_messages(message_id) on delete set null,
  reactions jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint property_host_message_content_check check(
    nullif(btrim(coalesce(content,'')),'') is not null or cardinality(attachments)>0
  ),
  constraint property_host_message_attachment_count_check check(cardinality(attachments)<=8),
  constraint property_host_message_attachment_shape_check check(cardinality(attachments)=cardinality(attachment_types))
);
create index if not exists property_host_messages_conversation_created_idx
  on public.property_host_messages(conversation_id,created_at desc);

alter table public.property_host_conversations enable row level security;
alter table public.property_host_messages enable row level security;
revoke insert,update,delete on public.property_host_conversations from anon,authenticated;
revoke insert,update,delete on public.property_host_messages from anon,authenticated;
revoke select on public.property_host_conversations from anon,authenticated;
revoke select on public.property_host_messages from anon,authenticated;

create or replace function public.property_host_conversation_access(p_conversation_id uuid)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select exists(
    select 1 from public.property_host_conversations c
    join public.reservations r on r.id=c.reservation_id
    left join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
    where c.conversation_id=p_conversation_id
      and (
        c.guest_user_id=public.current_profile_user_id()
        or (
          c.host_user_id=public.current_profile_user_id()
          and r.management_mode_snapshot='host'
          and r.responsible_host_user_id=c.host_user_id
          and exists(
            select 1 from public.property_host_assignments a
            where a.listing_id=l.id and a.user_id=c.host_user_id and a.status='active'
          )
          and public.user_has_active_workspace(c.host_user_id,'property_partner')
        )
      )
  )
$$;
revoke all on function public.property_host_conversation_access(uuid) from public,anon;
grant execute on function public.property_host_conversation_access(uuid) to authenticated,service_role;

create or replace function public.ensure_property_host_conversation(p_reservation_id text)
returns uuid language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_res public.reservations;
  v_listing public.listings;
  v_actor text:=public.current_profile_user_id();
  v_conversation public.property_host_conversations;
  v_fee_paid boolean;
begin
  select * into v_res from public.reservations where id=p_reservation_id;
  if v_res.id is null or v_res.management_mode_snapshot<>'host'
     or v_res.responsible_host_user_id is null then
    raise exception 'This booking is not Host-managed';
  end if;
  select * into v_listing from public.listings
  where id::text=v_res.listing_id or listing_id=v_res.listing_id limit 1;
  if v_listing.id is null then raise exception 'Property not found'; end if;

  v_fee_paid:=coalesce(v_res.reservation_fee_status='paid',false)
    or v_res.manual_payment_status in ('paid','completed');
  if not v_fee_paid then raise exception 'The reservation fee must be confirmed first'; end if;

  if v_actor is not null
     and v_actor<>v_res.user_id
     and v_actor<>v_res.responsible_host_user_id then
    raise exception 'This booking conversation is not available to this account';
  end if;
  if not exists(
    select 1 from public.property_host_assignments a
    where a.listing_id=v_listing.id and a.user_id=v_res.responsible_host_user_id
      and a.status='active'
  ) then raise exception 'The responsible Host no longer has property authority'; end if;

  insert into public.property_host_conversations(
    reservation_id,guest_user_id,host_user_id,status,created_at,updated_at
  ) values(
    v_res.id,v_res.user_id,v_res.responsible_host_user_id,'open',now(),now()
  ) on conflict(reservation_id) do update set
    guest_user_id=excluded.guest_user_id,
    host_user_id=excluded.host_user_id,
    status=case when public.property_host_conversations.status='closed'
      and v_res.status not in ('completed','cancelled','refunded','expired')
      then 'open' else public.property_host_conversations.status end,
    updated_at=now()
  returning * into v_conversation;
  return v_conversation.conversation_id;
end
$$;
revoke all on function public.ensure_property_host_conversation(text) from public,anon;
grant execute on function public.ensure_property_host_conversation(text) to authenticated,service_role;

create or replace function public.ensure_host_conversation_after_reservation()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.management_mode_snapshot='host'
     and new.responsible_host_user_id is not null
     and (
       new.reservation_fee_status='paid'
       or new.manual_payment_status in ('paid','completed')
     )
     and (
       tg_op='INSERT'
       or old.reservation_fee_status is distinct from new.reservation_fee_status
       or old.manual_payment_status is distinct from new.manual_payment_status
       or old.responsible_host_user_id is distinct from new.responsible_host_user_id
     ) then
    perform public.ensure_property_host_conversation(new.id);
  end if;
  if new.status in ('completed','cancelled','refunded','expired') then
    update public.property_host_conversations
    set status='closed',updated_at=now()
    where reservation_id=new.id;
  end if;
  return new;
end
$$;
drop trigger if exists reservation_host_conversation_sync on public.reservations;
create trigger reservation_host_conversation_sync
after insert or update of reservation_fee_status,manual_payment_status,responsible_host_user_id,status
on public.reservations for each row execute function public.ensure_host_conversation_after_reservation();

insert into public.property_host_conversations(
  reservation_id,guest_user_id,host_user_id,status,created_at,updated_at
)
select r.id,r.user_id,r.responsible_host_user_id,
  case when r.status in ('completed','cancelled','refunded','expired') then 'closed' else 'open' end,
  now(),now()
from public.reservations r
join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
where r.management_mode_snapshot='host'
  and r.responsible_host_user_id is not null
  and (r.reservation_fee_status='paid' or r.manual_payment_status in ('paid','completed'))
  and exists(
    select 1 from public.property_host_assignments a
    where a.listing_id=l.id and a.user_id=r.responsible_host_user_id and a.status='active'
  )
on conflict(reservation_id) do nothing;

create or replace function public.get_my_property_host_conversations()
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.updated_at desc),'[]'::jsonb)
  into v_result
  from (
    select
      c.conversation_id,c.reservation_id,c.status,c.updated_at,
      r.stay_type,r.status booking_status,r.stay_check_in,r.stay_check_out,r.requested_move_in_at,
      l.title listing_title,l.address listing_address,l.city listing_city,l.state listing_state,
      case when c.guest_user_id=v_actor then c.host_user_id else c.guest_user_id end other_person_id,
      coalesce(other.full_name,other.username,'WeHouse member') other_person_name,
      other.avatar_url other_person_avatar,
      latest.content last_message,
      latest.attachment_types last_attachment_types,
      latest.created_at last_message_time,
      coalesce(unread.count,0) unread_count
    from public.property_host_conversations c
    join public.reservations r on r.id=c.reservation_id
    join public.listings l on l.id::text=r.listing_id or l.listing_id=r.listing_id
    join public.profiles other on other.user_id=case
      when c.guest_user_id=v_actor then c.host_user_id else c.guest_user_id end
    left join lateral(
      select m.content,m.attachment_types,m.created_at
      from public.property_host_messages m
      where m.conversation_id=c.conversation_id
      order by m.created_at desc,m.message_id desc limit 1
    ) latest on true
    left join lateral(
      select count(*)::bigint count
      from public.property_host_messages m
      where m.conversation_id=c.conversation_id
        and m.sender_id<>v_actor and not m.is_read
    ) unread on true
    where public.property_host_conversation_access(c.conversation_id)
  ) row_data;
  return v_result;
end
$$;
revoke all on function public.get_my_property_host_conversations() from public,anon;
grant execute on function public.get_my_property_host_conversations() to authenticated;

create or replace function public.get_property_host_messages(p_conversation_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.property_host_conversation_access(p_conversation_id) then
    raise exception 'Conversation access denied';
  end if;
  update public.property_host_messages
  set is_read=true
  where conversation_id=p_conversation_id and sender_id<>v_actor and not is_read;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.message_id),'[]'::jsonb)
  into v_result from public.property_host_messages m
  where m.conversation_id=p_conversation_id;
  return v_result;
end
$$;
revoke all on function public.get_property_host_messages(uuid) from public,anon;
grant execute on function public.get_property_host_messages(uuid) to authenticated;

create or replace function public.send_property_host_message(
  p_conversation_id uuid,
  p_content text,
  p_attachments text[] default array[]::text[],
  p_attachment_types text[] default array[]::text[],
  p_reply_to_id uuid default null
) returns uuid language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_conversation public.property_host_conversations;
  v_res public.reservations;
  v_id uuid;
  v_type text;
begin
  if v_actor is null or not public.property_host_conversation_access(p_conversation_id) then
    raise exception 'Conversation access denied';
  end if;
  select * into v_conversation from public.property_host_conversations
  where conversation_id=p_conversation_id for update;
  select * into v_res from public.reservations where id=v_conversation.reservation_id;
  if v_conversation.status<>'open'
     or v_res.status in ('cancelled','refunded','expired')
     or (v_res.status='completed' and v_res.updated_at<now()-interval '24 hours') then
    raise exception 'This booking conversation is closed';
  end if;
  if char_length(coalesce(p_content,''))>4000 then raise exception 'Message is too long'; end if;
  if cardinality(coalesce(p_attachments,array[]::text[]))<>cardinality(coalesce(p_attachment_types,array[]::text[]))
     or cardinality(coalesce(p_attachments,array[]::text[]))>8 then
    raise exception 'Message media is invalid';
  end if;
  foreach v_type in array coalesce(p_attachment_types,array[]::text[]) loop
    if v_type not in ('image','video') then
      raise exception 'Only photos and videos can be attached';
    end if;
  end loop;
  if nullif(btrim(coalesce(p_content,'')),'') is null and cardinality(coalesce(p_attachments,array[]::text[]))=0 then
    raise exception 'Add a message or media';
  end if;
  if p_reply_to_id is not null and not exists(
    select 1 from public.property_host_messages
    where message_id=p_reply_to_id and conversation_id=p_conversation_id
  ) then raise exception 'Reply target is not in this conversation'; end if;

  insert into public.property_host_messages(
    conversation_id,sender_id,content,attachments,attachment_types,reply_to_id,is_read,created_at
  ) values(
    p_conversation_id,v_actor,nullif(btrim(coalesce(p_content,'')),''),
    coalesce(p_attachments,array[]::text[]),coalesce(p_attachment_types,array[]::text[]),
    p_reply_to_id,false,now()
  ) returning message_id into v_id;
  update public.property_host_conversations
  set last_message_at=now(),updated_at=now()
  where conversation_id=p_conversation_id;
  return v_id;
end
$$;
revoke all on function public.send_property_host_message(uuid,text,text[],text[],uuid) from public,anon;
grant execute on function public.send_property_host_message(uuid,text,text[],text[],uuid) to authenticated;

-- Owner can choose any accepted manager as the responsible Host for future bookings.
create or replace function public.set_property_responsible_host(
  p_listing_id uuid,p_user_id text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_listing public.listings;
begin
  if not exists(
    select 1 from public.property_host_assignments
    where listing_id=p_listing_id and user_id=v_actor
      and assignment_role='owner' and status='active'
  ) then raise exception 'Only the property owner can choose the responsible Host'; end if;
  if not exists(
    select 1 from public.property_host_assignments
    where listing_id=p_listing_id and user_id=p_user_id and status='active'
  ) then raise exception 'Choose an accepted property manager'; end if;
  perform set_config('wehouse.management_rpc','allowed',true);
  update public.listings
  set management_mode='host',management_host_user_id=p_user_id,
      wehouse_management_status='not_required',management_updated_at=now(),updated_at=now()
  where id=p_listing_id returning * into v_listing;
  if v_listing.id is null then raise exception 'Property not found'; end if;
  return public.get_my_property_management(p_listing_id);
end
$$;
revoke all on function public.set_property_responsible_host(uuid,text) from public,anon;
grant execute on function public.set_property_responsible_host(uuid,text) to authenticated;

-- Partner projection is scoped by explicit property assignments. Booking codes are not
-- exposed; the guest supplies the code physically at arrival.
create or replace function public.get_my_property_partner_stays(p_listing_id text default null)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_result jsonb;
begin
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  select coalesce(jsonb_agg(to_jsonb(stay) order by stay.created_at desc),'[]'::jsonb)
  into v_result from (
    select
      r.id reservation_id,
      coalesce(r.stay_type,'long_stay') stay_type,r.status,
      r.rent_payment_status payment_status,r.manual_payment_status,
      r.reservation_fee_status,r.reservation_fee_snapshot,r.reservation_fee_paid_at,
      r.rent_paid_at,r.stay_check_in check_in,r.stay_check_out check_out,r.stay_nights nights,
      coalesce(r.guest_count,1) guest_count,r.requested_move_in_at,r.move_in_requested_at,
      r.tenancy_start_date,r.tenancy_end_date,r.created_at,
      r.management_mode_snapshot,r.responsible_host_user_id,
      l.id::text listing_id,l.listing_id public_listing_code,l.title listing_title
    from public.reservations r
    join public.listings l on l.id::text=r.listing_id
    join public.property_host_assignments a
      on a.listing_id=l.id and a.user_id=v_actor and a.status='active'
    where (p_listing_id is null or l.id::text=p_listing_id or l.listing_id=p_listing_id)
      and (
        (
          r.management_mode_snapshot='host'
          and r.responsible_host_user_id=v_actor
          and (r.reservation_fee_status='paid' or r.manual_payment_status in ('paid','completed'))
        )
        or (
          r.management_mode_snapshot='wehouse'
          and (
            (coalesce(r.stay_type,'long_stay')='short_let'
              and ((r.rent_payment_status='paid' and r.rent_paid_at is not null) or r.status in('occupied','completed')))
            or
            (coalesce(r.stay_type,'long_stay')<>'short_let'
              and ((r.rent_payment_status in('paid','upfront_paid') and r.rent_paid_at is not null) or r.status in('occupied','completed')))
          )
        )
      )
    order by r.created_at desc limit 50
  ) stay;
  return v_result;
end
$$;
revoke all on function public.get_my_property_partner_stays(text) from public,anon;
grant execute on function public.get_my_property_partner_stays(text) to authenticated;
