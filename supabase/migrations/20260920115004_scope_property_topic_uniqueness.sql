begin;
-- Customer enquiries and property work can share a property but not a thread.
-- Keep the existing uniqueness rule for every other support context.
create unique index partner_support_requester_workspace_context_idx
on public.partner_support_conversations (
  partner_id,context_type,coalesce(context_id,''),
  (case when context_type in ('property_listing','hotel_property','hotel_operations')
    then coalesce(nullif(context_snapshot->>'requester_workspace',''),'legacy')
    else '' end)
) where partner_id is not null;
drop index public.partner_support_requester_context_idx;
alter index public.partner_support_requester_workspace_context_idx
rename to partner_support_requester_context_idx;
commit;
