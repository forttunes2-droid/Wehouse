-- A reservation has one WeHouse Operations case even if an older client uses
-- a legacy `reservation` or `apartment_payment` context name.
create unique index if not exists partner_support_canonical_reservation_context_idx
on public.partner_support_conversations (
  partner_id,
  (
    case
      when context_type in ('reservation', 'apartment_payment')
        then 'apartment_reservation'
      else context_type
    end
  ),
  coalesce(context_id, '')
)
where partner_id is not null
  and context_type in (
    'apartment_reservation',
    'reservation',
    'apartment_payment',
    'hotel_booking'
  );

create or replace function public.open_my_reservation_conversation(
  p_context_type text,
  p_context_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.profiles;
  result_id uuid;
  snapshot jsonb;
  display_subject text;
  canonical_context_type text;
begin
  canonical_context_type := case
    when p_context_type in ('apartment_reservation', 'reservation', 'apartment_payment')
      then 'apartment_reservation'
    when p_context_type = 'hotel_booking' then 'hotel_booking'
    else null
  end;

  if canonical_context_type is null or nullif(btrim(coalesce(p_context_id, '')), '') is null then
    raise exception 'Reservation context is invalid';
  end if;

  select * into actor
  from public.profiles
  where auth_id = (select auth.uid())::text
    and not coalesce(deleted, false)
    and not coalesce(suspended, false)
    and not coalesce(banned, false)
  limit 1;
  if actor.user_id is null then
    raise exception 'Active WeHouse account required';
  end if;

  if canonical_context_type = 'apartment_reservation' then
    select
      to_jsonb(r) || jsonb_build_object(
        'reservation_id', r.id,
        'listing_title', coalesce(l.title, 'Property reservation'),
        'listing_city', l.city,
        'listing_state', l.state
      ),
      coalesce(l.title, case when r.stay_type = 'short_let' then 'Short Let' else 'Long Stay' end)
    into snapshot, display_subject
    from public.reservations r
    left join public.listings l
      on l.listing_id = r.listing_id or l.id::text = r.listing_id
    where r.id = p_context_id
      and r.user_id = actor.user_id
    limit 1;
  else
    select
      to_jsonb(b) || jsonb_build_object('hotel_name', h.name),
      coalesce(h.name, 'Hotel stay')
    into snapshot, display_subject
    from public.hotel_bookings b
    join public.hotels h on h.hotel_id = b.hotel_id
    where b.booking_id::text = p_context_id
      and b.user_id = actor.user_id
    limit 1;
  end if;

  if snapshot is null then
    raise exception 'Reservation was not found';
  end if;

  select c.id into result_id
  from public.partner_support_conversations c
  where c.partner_id = actor.user_id
    and c.channel_kind = 'reservation_operations'
    and c.context_id = p_context_id
    and case
      when c.context_type in ('reservation', 'apartment_payment')
        then 'apartment_reservation'
      else c.context_type
    end = canonical_context_type
  order by c.created_at
  limit 1;

  if result_id is null then
    begin
      insert into public.partner_support_conversations(
        partner_id,
        requester_role,
        subject,
        status,
        category,
        context_type,
        context_id,
        context_snapshot,
        priority,
        channel_kind,
        created_at,
        updated_at
      ) values (
        actor.user_id,
        actor.role,
        display_subject,
        'open',
        'reservation_operations',
        canonical_context_type,
        p_context_id,
        snapshot,
        'normal',
        'reservation_operations',
        now(),
        now()
      )
      returning id into result_id;
    exception when unique_violation then
      select c.id into result_id
      from public.partner_support_conversations c
      where c.partner_id = actor.user_id
        and c.context_id = p_context_id
        and case
          when c.context_type in ('reservation', 'apartment_payment')
            then 'apartment_reservation'
          else c.context_type
        end = canonical_context_type
      order by c.created_at
      limit 1;
    end;
  else
    update public.partner_support_conversations
    set subject = display_subject,
        context_snapshot = snapshot,
        updated_at = now()
    where id = result_id;
  end if;

  return result_id;
end;
$$;

revoke all on function public.open_my_reservation_conversation(text, text)
  from public, anon;
grant execute on function public.open_my_reservation_conversation(text, text)
  to authenticated, service_role;
