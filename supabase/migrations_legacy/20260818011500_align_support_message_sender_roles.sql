-- Align support message roles with the current user, worker, partner and staff model.
alter table public.partner_support_messages
  drop constraint if exists partner_support_messages_sender_role_check;

alter table public.partner_support_messages
  add constraint partner_support_messages_sender_role_check
  check (sender_role = any (array[
    'user','worker','property_partner','partner','staff','support',
    'field_officer','admin','creator','system'
  ]::text[]));
