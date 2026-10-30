-- Signed-out visitors have no reason to read the commission-based discount limit.
revoke all on function public.wehouse_discount_ceiling() from public, anon;
grant execute on function public.wehouse_discount_ceiling() to authenticated, service_role;
