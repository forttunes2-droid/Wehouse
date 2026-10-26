begin;
-- Service discovery is ordinary marketplace access, not a separate licence or
-- paid feature. Correct the untouched legacy seed; preserve any deliberate pause.
insert into public.platform_settings(key,value,category,label,description,data_type,is_active,editable)
values('worker_marketplace_launch_enabled','true','operations','Service discovery availability',
'Approved, available Service Providers appear automatically. Pause discovery only for an operational incident; provider review and payment controls remain separate.',
'boolean',true,false)
on conflict(key) do nothing;
update public.platform_settings s
set value='true',is_active=true,updated_at=now()
where s.key='worker_marketplace_launch_enabled' and lower(btrim(s.value)) in('false','0','no','off')
 and s.created_at=s.updated_at
 and not exists(select 1 from public.admin_audit_log a
   where a.target_id='worker_marketplace_launch_enabled' and a.action='creator_worker_marketplace');
update public.platform_settings set category='operations',label='Service discovery availability',
 description='Approved, available Service Providers appear automatically. Pause discovery only for an operational incident; provider review and payment controls remain separate.'
where key='worker_marketplace_launch_enabled';
commit;
