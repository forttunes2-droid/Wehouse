revoke all on function public.expire_overdue_reservations() from public, anon, authenticated;
grant execute on function public.expire_overdue_reservations() to service_role;
