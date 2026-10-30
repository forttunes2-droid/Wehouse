-- Canonical operational cases already have one conversation per case ID.
-- Generic subject uniqueness must not merge different reasons about one account.
-- Keep the existing workspace distinction for property enquiries.
drop index public.partner_support_requester_context_idx;
create unique index partner_support_requester_context_idx
on public.partner_support_conversations
 (partner_id,context_type,coalesce(context_id,''),
  (case when context_type in ('property_listing','hotel_property','hotel_operations')
   then coalesce(nullif(context_snapshot->>'requester_workspace',''),'legacy')
   else '' end))
where partner_id is not null and operational_case_id is null;
-- partner_support_operational_case_unique remains the authority for routed cases.
