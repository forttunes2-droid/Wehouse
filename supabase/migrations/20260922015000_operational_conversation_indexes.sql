begin;

create index if not exists partner_support_messages_conversation_created_idx
  on public.partner_support_messages(conversation_id, created_at);

create index if not exists partner_support_messages_unread_conversation_idx
  on public.partner_support_messages(conversation_id, sender_id)
  where not coalesce(is_read,false);

commit;
