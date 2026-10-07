begin;

-- The hotel cancellation RPC creates a controlled Finance command. Keep the
-- canonical outbox allow-list aligned with that RPC on every environment.
alter table public.financial_action_outbox
  drop constraint if exists financial_action_outbox_action_type_check;

alter table public.financial_action_outbox
  add constraint financial_action_outbox_action_type_check check(action_type in(
    'refund_caution_undisputed',
    'refund_caution_balance',
    'release_caution_award',
    'refund_unclaimed_caution',
    'refund_shared_checkout',
    'refund_hotel_cancellation',
    'release_worker_payment',
    'release_long_let_payment',
    'release_short_let_stay',
    'release_hotel_stay'
  ));

commit;
