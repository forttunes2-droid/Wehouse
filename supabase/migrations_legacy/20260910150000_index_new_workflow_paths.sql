-- Cover the foreign-key paths introduced for showcase comments and reservation
-- handover assignment so deletes and operational queue lookups do not scan.

create index if not exists worker_showcase_comments_user_idx
  on public.worker_showcase_comments(user_id);

create index if not exists reservations_handover_field_officer_idx
  on public.reservations(handover_field_officer_id)
  where handover_field_officer_id is not null;

create index if not exists reservations_handover_conversation_idx
  on public.reservations(handover_conversation_id)
  where handover_conversation_id is not null;
