-- Public reads and Hotel operator changes use scoped SECURITY DEFINER RPCs.
-- RLS without policies is not a reason to keep direct browser table grants,
-- especially TRUNCATE/MAINTAIN privileges that do not enforce row predicates.
revoke all on table public.hotel_rooms,public.hotel_commercial_change_audit
 from public,anon,authenticated;
grant all on table public.hotel_rooms,public.hotel_commercial_change_audit to service_role;
