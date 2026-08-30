-- Every Worker booking owns exactly one durable participant conversation.
-- Repair older bookings that were created without the conversation row.
insert into public.booking_conversations(
  booking_id,user_id,worker_id,status,created_at,updated_at
)
select wb.id,wb.user_id,wb.worker_id,'active',coalesce(wb.created_at,now()),coalesce(wb.updated_at,wb.created_at,now())
from public.worker_bookings wb
where wb.user_id is not null
  and wb.worker_id is not null
  and not exists (
    select 1 from public.booking_conversations bc where bc.booking_id=wb.id
  )
on conflict (booking_id) do nothing;

update public.worker_bookings wb
set booking_conversation_id=bc.id,
    updated_at=greatest(coalesce(wb.updated_at,wb.created_at,now()),bc.updated_at)
from public.booking_conversations bc
where bc.booking_id=wb.id
  and wb.booking_conversation_id is distinct from bc.id;

-- Preserve the customer's original request note in repaired empty chats.
insert into public.booking_messages(conversation_id,sender_id,content,created_at)
select bc.id,wb.user_id,btrim(wb.customer_message),coalesce(wb.created_at,now())
from public.worker_bookings wb
join public.booking_conversations bc on bc.booking_id=wb.id
where nullif(btrim(coalesce(wb.customer_message,'')),'') is not null
  and not exists (
    select 1 from public.booking_messages bm where bm.conversation_id=bc.id
  );

create index if not exists booking_conversations_participant_activity_idx
  on public.booking_conversations(user_id,worker_id,updated_at desc);

create index if not exists booking_messages_unread_participant_idx
  on public.booking_messages(conversation_id,is_read,sender_id,created_at desc);
