-- Requester/team is a relationship to this case, not the account's legacy role.
drop policy support_message_read on public.partner_support_messages;
create policy support_message_read on public.partner_support_messages
for select to authenticated using (
 public.current_actor_can_access_operational_conversation(conversation_id,false)
 and (
  visibility='customer'
  or exists (
   select 1 from public.partner_support_conversations conversation
   where conversation.id=conversation_id
    and conversation.partner_id<>public.current_profile_user_id()
  )
 )
);
-- Public clients read authorized messages; writes remain in controlled RPCs.
revoke all on public.partner_support_messages from anon,authenticated;
grant select on public.partner_support_messages to authenticated;
