-- Hotel prices are available only inside an authenticated WeHouse session.
revoke all on function public.quote_hotel_room(integer,integer,date,date)
  from public,anon;
grant execute on function public.quote_hotel_room(integer,integer,date,date)
  to authenticated,service_role;

-- Index the ownership and lookup paths used by the repaired production flows.
create index if not exists partner_support_field_inbox_idx
  on public.partner_support_conversations(
    assigned_field_officer_id,
    status,
    updated_at desc
  )
  where channel_kind='field_operations';

create index if not exists roommate_user_blocks_blocked_idx
  on public.roommate_user_blocks(blocked_user_id,blocker_user_id);

create index if not exists shared_housing_groups_conversation_status_idx
  on public.shared_housing_groups(conversation_id,status);

create index if not exists property_access_challenges_request_idx
  on public.property_access_challenges(request_id)
  where request_id is not null;
