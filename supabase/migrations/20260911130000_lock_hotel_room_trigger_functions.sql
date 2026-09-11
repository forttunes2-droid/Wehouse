-- Trigger functions are internal and must not be callable through the API.

revoke all on function public.sync_hotel_room_units()
  from public,anon,authenticated;
revoke all on function public.notify_hotel_booking_lifecycle()
  from public,anon,authenticated;
revoke all on function public.set_saved_search_criteria_key()
  from public,anon,authenticated;

grant execute on function public.sync_hotel_room_units() to service_role;
grant execute on function public.notify_hotel_booking_lifecycle() to service_role;
grant execute on function public.set_saved_search_criteria_key() to service_role;
