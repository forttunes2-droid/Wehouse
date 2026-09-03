-- Trigger-only integrity function; it must not be exposed as a client RPC.
revoke all on function public.enforce_hotel_team_consumer_account() from public, anon, authenticated;
grant execute on function public.enforce_hotel_team_consumer_account() to service_role;
