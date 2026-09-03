-- Retire legacy SECURITY DEFINER endpoints that bypass the current scoped APIs.
-- These functions remain available to service_role for migration/incident recovery,
-- but browser clients must use the newer caller-checked replacements.

revoke all on function public.admin_get_partner_inspections() from public, anon, authenticated;
revoke all on function public.admin_get_user_inspections() from public, anon, authenticated;
revoke all on function public.admin_get_user_inspections(text) from public, anon, authenticated;
revoke all on function public.admin_get_worker_review_identity_status(text) from public, anon, authenticated;
revoke all on function public.admin_promote_to_staff(text) from public, anon, authenticated;

revoke all on function public.disable_creator_auth(text) from public, anon, authenticated;
revoke all on function public.get_booking_details(uuid) from public, anon, authenticated;
revoke all on function public.get_worker_verification_chats() from public, anon, authenticated;

revoke all on function public.get_platform_setting(text) from public, anon, authenticated;
revoke all on function public.get_platform_settings(text) from public, anon, authenticated;

grant execute on function public.admin_get_partner_inspections() to service_role;
grant execute on function public.admin_get_user_inspections() to service_role;
grant execute on function public.admin_get_user_inspections(text) to service_role;
grant execute on function public.admin_get_worker_review_identity_status(text) to service_role;
grant execute on function public.admin_promote_to_staff(text) to service_role;
grant execute on function public.disable_creator_auth(text) to service_role;
grant execute on function public.get_booking_details(uuid) to service_role;
grant execute on function public.get_worker_verification_chats() to service_role;
grant execute on function public.get_platform_setting(text) to service_role;
grant execute on function public.get_platform_settings(text) to service_role;
