-- Expand the composite tenancy result into the declared reservations row.
-- Selecting the function as one scalar left the returned lifecycle record
-- unusable even though the inner transition succeeded.
create or replace function public.confirm_apartment_handover(
  p_booking_code text,
  p_start_date date default current_date
)
returns public.reservations
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_verified jsonb;
  v_result public.reservations;
begin
  v_verified := public.verify_branch_booking_code(p_booking_code);
  if v_verified is null or v_verified ->> 'kind' <> 'housing' then
    raise exception 'Enter a valid housing move-in code';
  end if;
  if coalesce((v_verified ->> 'can_handover')::boolean, false) is not true then
    raise exception 'Verified rent and a customer move-in time are required before handover';
  end if;
  if p_start_date <> ((v_verified ->> 'requested_move_in_at')::timestamptz)::date then
    raise exception 'The tenancy start date must match the customer move-in request';
  end if;

  select * into v_result
  from public.activate_apartment_tenancy(
    v_verified ->> 'reservation_id',
    p_start_date
  );
  return v_result;
end;
$$;

revoke all on function public.confirm_apartment_handover(text, date) from public, anon;
grant execute on function public.confirm_apartment_handover(text, date) to authenticated, service_role;
