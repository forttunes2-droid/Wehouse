-- Short Let publication and dated occupancy are separate concerns. This public
-- projection lets the product check a requested date range without exposing a
-- guest, reservation identifier, payment state, or any other private record.

create or replace function public.get_short_let_date_availability(
  p_listing_id text,
  p_check_in date,
  p_check_out date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_listing public.listings;
  v_min_nights integer:=1;
  v_max_nights integer:=90;
  v_advance_days integer:=365;
  v_nights integer;
  v_available boolean:=false;
  v_reason text;
begin
  select * into v_listing
  from public.listings l
  where (l.id::text=p_listing_id or l.listing_id=p_listing_id)
    and l.sub_type='short_let'
    and l.deleted_at is null
    and l.inspection_request_id is not null
    and l.approved_at is not null
  limit 1;

  if v_listing.id is null then
    return jsonb_build_object('available',false,'reason','not_found');
  end if;
  if v_listing.status<>'available' or v_listing.availability_status<>'available' then
    return jsonb_build_object('available',false,'reason','not_published');
  end if;

  select coalesce(nullif(value,'')::integer,1) into v_min_nights
  from public.platform_settings
  where key='short_stay_min_nights' and coalesce(is_active,true)
  limit 1;
  select coalesce(nullif(value,'')::integer,90) into v_max_nights
  from public.platform_settings
  where key='short_stay_max_nights' and coalesce(is_active,true)
  limit 1;
  select coalesce(nullif(value,'')::integer,365) into v_advance_days
  from public.platform_settings
  where key='short_stay_booking_advance_days' and coalesce(is_active,true)
  limit 1;

  v_min_nights:=greatest(coalesce(v_min_nights,1),1);
  v_max_nights:=greatest(coalesce(v_max_nights,90),v_min_nights);
  v_advance_days:=greatest(coalesce(v_advance_days,365),v_max_nights);

  if p_check_in is null or p_check_out is null or p_check_in<current_date
      or p_check_out<=p_check_in then
    v_reason:='invalid_dates';
  elsif p_check_in>current_date+v_advance_days
      or p_check_out>current_date+v_advance_days then
    v_reason:='outside_booking_window';
  else
    v_nights:=p_check_out-p_check_in;
    if v_nights<v_min_nights or v_nights>v_max_nights then
      v_reason:='invalid_length';
    elsif exists(
      select 1
      from public.reservations r
      where r.listing_id=v_listing.id::text
        and r.stay_type='short_let'
        and r.status=any(array['reserved','ready_for_move_in','occupied']::text[])
        and daterange(r.stay_check_in,r.stay_check_out,'[)')
          && daterange(p_check_in,p_check_out,'[)')
    ) then
      v_reason:='dates_unavailable';
    else
      v_available:=true;
      v_reason:='available';
    end if;
  end if;

  return jsonb_build_object(
    'available',v_available,
    'reason',v_reason,
    'nights',case when p_check_in is not null and p_check_out is not null
      then p_check_out-p_check_in else null end,
    'min_nights',v_min_nights,
    'max_nights',v_max_nights
  );
end
$$;

revoke all on function public.get_short_let_date_availability(text,date,date)
from public;
grant execute on function public.get_short_let_date_availability(text,date,date)
to anon,authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  'approved_public_projection',
  'Public Short Let date availability without reservation or guest disclosure',now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='get_short_let_date_availability'
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

comment on function public.get_short_let_date_availability(text,date,date) is
  'Returns only whether public Short Let dates can be requested; no booking or guest details are exposed.';
