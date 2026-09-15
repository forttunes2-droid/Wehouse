begin;

-- A fresh WeHouse database must contain the same policy switches as an existing
-- project. Sensitive face/liveness processing remains OFF by default until the
-- approved privacy/DPIA gate is deliberately enabled.
insert into public.platform_settings(
  key,value,category,label,description,data_type,editable,is_active,created_at,updated_at
) values
  (
    'worker_identity_checks_enabled','false','security',
    'Private identity verification',
    'Require the private face/liveness identity-continuity check for Service Provider and Property Partner workflows. Keep disabled until the approved biometric/privacy policy gate is complete.',
    'boolean',true,true,now(),now()
  ),
  (
    'account_identity_recurring_enabled','false','security',
    'Recurring identity re-checks',
    'Require an already-approved Service Provider or Property Partner to repeat the private live identity check after the configured interval. This is separate from initial identity verification.',
    'boolean',true,true,now(),now()
  )
on conflict(key) do update set
  category=excluded.category,
  label=excluded.label,
  description=excluded.description,
  data_type=excluded.data_type,
  editable=excluded.editable,
  is_active=true,
  updated_at=now();

commit;
