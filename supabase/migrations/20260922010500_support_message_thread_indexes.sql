begin;

-- Operational conversations can grow for months. Keep opening a thread and
-- marking unread messages proportional to that one conversation instead of
-- requiring a sort/scan of the wider support message table.
create index if not exists partner_support_messages_conversation_created_idx
  on public.partner_support_messages(conversation_id, created_at);

create index if not exists partner_support_messages_unread_conversation_idx
  on public.partner_support_messages(conversation_id, sender_id)
  where not coalesce(is_read,false);

commit;
