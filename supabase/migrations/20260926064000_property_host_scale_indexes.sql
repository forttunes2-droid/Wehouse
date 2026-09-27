-- Cover the new Host-managed booking relationships and Short Let balance expiry path.
-- These are additive indexes only; they do not change authority or existing records.

create index if not exists property_host_assignments_invited_by_idx
  on public.property_host_assignments(invited_by)
  where invited_by is not null;

create index if not exists property_host_conversations_guest_idx
  on public.property_host_conversations(guest_user_id,updated_at desc);

create index if not exists property_host_conversations_host_idx
  on public.property_host_conversations(host_user_id,updated_at desc);

create index if not exists property_host_messages_reply_idx
  on public.property_host_messages(reply_to_id)
  where reply_to_id is not null;

create index if not exists property_host_messages_sender_idx
  on public.property_host_messages(sender_id,created_at desc);

create index if not exists reservations_short_let_balance_due_idx
  on public.reservations(short_stay_balance_due_at)
  where stay_type='short_let'
    and status='reserved'
    and reservation_fee_status='paid'
    and rent_payment_status not in ('paid','upfront_paid')
    and short_stay_balance_due_at is not null;
