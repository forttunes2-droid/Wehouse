-- Trigger helpers are invoked by Postgres, never through the Data API.
revoke all on function public.notify_saved_hotel_searches_from_hotel() from public,anon,authenticated;
revoke all on function public.notify_saved_hotel_searches_from_room() from public,anon,authenticated;
