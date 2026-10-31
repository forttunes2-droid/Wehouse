-- Approved Service Providers appear through the existing review/publication
-- rules. A seeded startup switch must not require another Creator launch action.
-- The same existing switch remains an audited operational pause; do not overwrite
-- any availability decision that a Creator has actually recorded.
insert into public.platform_settings(key,value,category,label,description,data_type,editable,is_active)
values('worker_marketplace_launch_enabled','true','worker_operations','Services availability',
 'Availability of new Service discovery and requests. Individual Provider reviews and restrictions still apply; existing bookings remain accessible.',
 'boolean',false,true)
on conflict(key) do update set
 value=case when coalesce(platform_settings.is_active,true)
  and lower(btrim(platform_settings.value))='false'
  and not exists(select 1 from public.admin_audit_log a
   where a.action='creator_worker_marketplace' and a.target_id='worker_marketplace_launch_enabled')
  then 'true' else platform_settings.value end,
 category='worker_operations',label='Services availability',
 description=excluded.description,data_type='boolean',editable=false;

