create or replace function public.confirm_apartment_handover(
  p_booking_code text,
  p_start_date date default current_date
)
returns public.reservations
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_verified jsonb;
  v_result public.reservations;
begin
  v_verified := public.verify_branch_booking_code(p_booking_code);

  if v_verified is null or v_verified ->> 'kind' <> 'housing' then
    raise exception 'Enter a valid housing booking code';
  end if;

  select public.activate_apartment_tenancy(
    v_verified ->> 'reservation_id',
    p_start_date
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.confirm_apartment_handover(text, date)
  from public, anon, authenticated;
grant execute on function public.confirm_apartment_handover(text, date)
  to authenticated, service_role;

revoke execute on function public.activate_apartment_tenancy(text, date)
  from public, anon, authenticated;
grant execute on function public.activate_apartment_tenancy(text, date)
  to service_role;

revoke execute on function public.confirm_my_move_in(text)
  from public, anon, authenticated;
grant execute on function public.confirm_my_move_in(text)
  to service_role;
