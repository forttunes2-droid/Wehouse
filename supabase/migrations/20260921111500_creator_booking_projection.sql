create or replace function public.creator_get_booking_records(
  p_kind text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),250);
  v_result jsonb;
begin
  if not public.current_actor_has_workspace('creator',null) then
    raise exception 'Active Creator workspace required';
  end if;
  if p_kind not in ('apartments','hotels') then
    raise exception 'Booking kind must be apartments or hotels';
  end if;

  if p_kind='apartments' then
    select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
    into v_result
    from (
      select
        r.created_at,
        jsonb_build_object(
          'kind','apartment',
          'id',r.id,
          'booking_id',r.id,
          'booking_code',r.booking_code,
          'status',r.status,
          'created_at',r.created_at,
          'amount',r.amount,
          'payment_status',r.rent_payment_status,
          'stay_type',r.stay_type,
          'check_in',r.stay_check_in,
          'check_out',r.stay_check_out,
          'guest_count',r.guest_count,
          'property',jsonb_build_object(
            'id',l.id,
            'title',coalesce(l.title,r.listing_title),
            'city',l.city,
            'state',l.state,
            'images',coalesce(to_jsonb(l.images),'[]'::jsonb)
          ),
          'customer',jsonb_build_object(
            'user_id',r.user_id,
            'full_name',p.full_name,
            'username',p.username,
            'email',coalesce(p.email,r.user_email),
            'phone',p.phone
          )
        ) row_data
      from public.reservations r
      left join lateral (
        select listing.id,listing.title,listing.city,listing.state,listing.images
        from public.listings listing
        where listing.id::text=r.listing_id or listing.listing_id=r.listing_id
        order by listing.created_at desc
        limit 1
      ) l on true
      left join public.profiles p on p.user_id=r.user_id
      order by r.created_at desc
      limit v_limit
    ) rows;
  else
    select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
    into v_result
    from (
      select
        hb.created_at,
        jsonb_build_object(
          'kind','hotel',
          'id',hb.booking_id,
          'booking_id',hb.booking_id,
          'booking_code',hb.booking_code,
          'status',hb.status,
          'created_at',hb.created_at,
          'amount',hb.total_price,
          'payment_status',hb.payment_status,
          'check_in',hb.check_in,
          'check_out',hb.check_out,
          'guest_count',hb.guest_count,
          'room_type',hr.room_type,
          'property',jsonb_build_object(
            'id',h.hotel_id,
            'title',h.name,
            'city',h.city,
            'state',h.state,
            'images',coalesce(to_jsonb(h.images),'[]'::jsonb)
          ),
          'customer',jsonb_build_object(
            'user_id',hb.user_id,
            'full_name',coalesce(nullif(hb.guest_name,''),p.full_name),
            'username',p.username,
            'email',p.email,
            'phone',p.phone
          )
        ) row_data
      from public.hotel_bookings hb
      left join public.hotels h on h.hotel_id=hb.hotel_id
      left join public.hotel_rooms hr on hr.room_id=hb.room_id
      left join public.profiles p on p.user_id=hb.user_id
      order by hb.created_at desc
      limit v_limit
    ) rows;
  end if;
  return v_result;
end
$$;

revoke all on function public.creator_get_booking_records(text,integer)
from public,anon;
grant execute on function public.creator_get_booking_records(text,integer)
to authenticated,service_role;
