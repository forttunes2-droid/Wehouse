-- Management access is independent of public discovery and offering approval.
create function public.get_my_provider_workspace_capabilities() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_host_actor(); reviewed boolean; existing_jobs boolean;
begin
 select coalesce(p.worker_status='verified' and p.worker_verified,false) into reviewed
 from public.profiles p where p.user_id=actor;
 select exists(select 1 from public.worker_bookings b where b.worker_id=actor) into existing_jobs;
 return jsonb_build_object('person_id',actor,'service_reviewed',coalesce(reviewed,false),
  'has_existing_jobs',existing_jobs,'can_manage_jobs',coalesce(reviewed,false) or existing_jobs,
  'can_manage_showcase',coalesce(reviewed,false),'can_apply_experiences',true,
  'can_access_inbox',true,'can_access_earnings',true);
end $$;
revoke all on function public.get_my_provider_workspace_capabilities() from public,anon;
grant execute on function public.get_my_provider_workspace_capabilities() to authenticated;
