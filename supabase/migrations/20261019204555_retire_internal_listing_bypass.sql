-- Retire the unused direct-publication path. New property/Hotel supply uses
-- create_my_property_inspection_batch_v4 and the review/publication pipeline.
-- RESTRICT (the default) deliberately rejects unclassified dependencies.
-- Existing listings, bookings, audit records and idempotency receipts stay intact.
drop function if exists public.create_internal_listing_idem(uuid, jsonb);
drop function if exists public.create_internal_listing(jsonb);
