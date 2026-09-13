-- These workflows require an authenticated WeHouse identity. PostgreSQL grants
-- new functions to PUBLIC by default, and older explicit anon grants can survive
-- CREATE OR REPLACE, so remove both paths before granting the intended roles.

revoke all on function public.get_worker_showcase_post_comments(uuid) from public, anon;
revoke all on function public.add_my_worker_showcase_comment(uuid, text) from public, anon;
revoke all on function public.get_reservation_handover_assignment(text) from public, anon;
revoke all on function public.assign_reservation_field_officer(text, text) from public, anon;

grant execute on function public.get_worker_showcase_post_comments(uuid) to authenticated, service_role;
grant execute on function public.add_my_worker_showcase_comment(uuid, text) to authenticated, service_role;
grant execute on function public.get_reservation_handover_assignment(text) to authenticated, service_role;
grant execute on function public.assign_reservation_field_officer(text, text) to authenticated, service_role;
