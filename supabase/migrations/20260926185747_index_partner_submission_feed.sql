-- Supports the bounded Property Partner submission list across property type
-- and lifecycle filters, ordered newest first with a stable ID tie-breaker.
create index if not exists inspection_requests_partner_feed_idx
on public.inspection_requests(owner_id,property_type,created_at desc,id desc);
