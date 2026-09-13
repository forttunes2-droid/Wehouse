-- Transient device-confirmation progress belongs to the security flow, not Activity.
-- Removing historical rows prevents stale duplicates from continuing to affect users.
delete from public.notifications
where type = 'device_confirmation_pending';
