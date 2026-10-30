-- The existing Provider read projects the next work from accepted bookings.
-- No second account, activity booking, calendar or earnings authority is created.
create index experience_bookings_host_confirmed on public.experience_bookings(host_user_id,session_id,id) where status='confirmed';
create or replace function public.get_my_provider_workspace_capabilities() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_host_actor();reviewed boolean;existing_jobs boolean;next_bookings jsonb;
begin
 select coalesce(p.worker_status='verified' and p.worker_verified,false) into reviewed from public.profiles p where p.user_id=actor;
 select exists(select 1 from public.worker_bookings b where b.worker_id=actor) into existing_jobs;
 select coalesce(jsonb_agg(jsonb_build_object('booking_id',page.id,'title',page.contract->>'title',
  'starts_at',page.contract->>'starts_at','ends_at',page.contract->>'ends_at','timezone',page.contract->>'timezone',
  'participants',page.participants,'host_finished',page.host_finished_at is not null) order by page.priority,page.starts_at,page.id),'[]'::jsonb)
 into next_bookings from (
  select b.id,b.contract,b.participants,b.host_finished_at,(b.contract->>'starts_at')::timestamptz starts_at,
   case when (b.contract->>'ends_at')::timestamptz<=now() and b.host_finished_at is null then 0
    when (b.contract->>'starts_at')::timestamptz>now() then 1 else 2 end priority
  from public.experience_bookings b where b.host_user_id=actor and b.status='confirmed'
  order by priority,starts_at,b.id limit 3
 ) page;
 return jsonb_build_object('person_id',actor,'service_reviewed',coalesce(reviewed,false),
  'has_existing_jobs',existing_jobs,'can_manage_jobs',coalesce(reviewed,false) or existing_jobs,
  'can_manage_showcase',coalesce(reviewed,false),'can_apply_experiences',true,
  'can_access_inbox',true,'can_access_earnings',true,'experience_next',next_bookings);
end $$;
revoke all on function public.get_my_provider_workspace_capabilities() from public,anon;
grant execute on function public.get_my_provider_workspace_capabilities() to authenticated;
