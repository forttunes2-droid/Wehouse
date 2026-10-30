-- Keep the Creator Worker publication control available on clean and upgraded projects.
-- Discovery stays closed unless a Creator deliberately opens it.
begin;

insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active
) values(
  'worker_marketplace_launch_enabled',
  'false',
  'worker_legal',
  'Worker marketplace launch approved',
  'Enable only after the required Nigerian labour/recruiter classification and launch approvals are recorded.',
  'boolean',
  false,
  true
)
on conflict(key) do nothing;

commit;
