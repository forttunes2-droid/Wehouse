-- Move pre-existing property-inspection conversations out of the generic
-- Property Operations queue when the inspection already has a Field Officer.

alter table public.partner_support_conversations
  drop constraint if exists partner_support_conversations_channel_kind_check;

alter table public.partner_support_conversations
  add constraint partner_support_conversations_channel_kind_check
  check (channel_kind in (
    'reservation_operations',
    'property_operations',
    'field_operations',
    'support_case'
  ));

create or replace function public.enforce_conversation_context_ownership()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if old.context_type is distinct from new.context_type
    or old.context_id is distinct from new.context_id then
    raise exception 'Conversation ownership cannot be reassigned';
  end if;

  if old.channel_kind is distinct from new.channel_kind
    and not (
      old.context_type = 'property_inspection'
      and old.channel_kind = 'property_operations'
      and new.channel_kind = 'field_operations'
      and nullif(btrim(coalesce(new.assigned_field_officer_id, '')), '') is not null
    ) then
    raise exception 'Conversation ownership cannot be reassigned';
  end if;

  return new;
end;
$$;

with resolved_assignment as (
  select
    conversation.id as conversation_id,
    coalesce(
      property_inspection.assigned_field_officer_id,
      property_inspection.field_officer_id,
      property_inspection.assigned_to,
      customer_inspection.field_officer_id
    ) as field_officer_id
  from public.partner_support_conversations conversation
  left join public.inspection_requests property_inspection
    on property_inspection.id::text = coalesce(
      conversation.context_id,
      conversation.inspection_id::text,
      conversation.context_snapshot->>'inspection_id'
    )
  left join public.user_inspection_requests customer_inspection
    on customer_inspection.id::text = coalesce(
      conversation.context_id,
      conversation.context_snapshot->>'inspection_id'
    )
  where conversation.context_type = 'property_inspection'
)
update public.partner_support_conversations conversation
set
  channel_kind = 'field_operations',
  assigned_field_officer_id = assignment.field_officer_id,
  assigned_staff_id = null,
  updated_at = now()
from resolved_assignment assignment
where conversation.id = assignment.conversation_id
  and nullif(btrim(coalesce(assignment.field_officer_id, '')), '') is not null
  and (
    conversation.channel_kind is distinct from 'field_operations'
    or conversation.assigned_field_officer_id is distinct from assignment.field_officer_id
  );
