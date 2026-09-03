-- Staff access is now controlled by role, branch and operational module.
-- Keep historical trust records for audit retention, but retire the unapproved client API.
revoke all on table public.staff_trust_profiles from anon, authenticated;
revoke execute on function public.get_my_staff_trust_status() from public, anon, authenticated;
revoke execute on function public.set_staff_trust_status(text,text,text) from public, anon, authenticated;
revoke execute on function public.update_staff_trust_checklist(text,boolean,boolean,boolean,boolean,boolean,text) from public, anon, authenticated;
revoke execute on function public.sync_staff_trust_on_role_change() from public, anon, authenticated;
