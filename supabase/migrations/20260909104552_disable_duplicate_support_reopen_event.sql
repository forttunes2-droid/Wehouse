-- Reopening now has a requester-owned RPC that records the reason and one audit event.
drop trigger if exists partner_support_log_reopen
on public.partner_support_conversations;

revoke all on function public.log_automatic_support_reopen()
from public,anon,authenticated;
