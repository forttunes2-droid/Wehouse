-- Search & Discovery: saved-listing ownership hardening
-- Canonical identity in application tables is profiles.user_id; auth.uid() maps through profiles.auth_id.

BEGIN;

ALTER TABLE public.saved_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_listings_owner" ON public.saved_listings;
DROP POLICY IF EXISTS saved_listings_owner ON public.saved_listings;
DROP POLICY IF EXISTS saved_listings_select ON public.saved_listings;
DROP POLICY IF EXISTS saved_listings_insert ON public.saved_listings;
DROP POLICY IF EXISTS saved_listings_delete ON public.saved_listings;

CREATE POLICY saved_listings_select
ON public.saved_listings
FOR SELECT
TO authenticated
USING (
  user_id = (
    SELECT p.user_id
    FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
      AND COALESCE(p.deleted, false) = false
      AND COALESCE(p.suspended, false) = false
      AND COALESCE(p.banned, false) = false
    LIMIT 1
  )
);

CREATE POLICY saved_listings_insert
ON public.saved_listings
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (
    SELECT p.user_id
    FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
      AND COALESCE(p.deleted, false) = false
      AND COALESCE(p.suspended, false) = false
      AND COALESCE(p.banned, false) = false
    LIMIT 1
  )
  AND EXISTS (
    SELECT 1
    FROM public.listings l
    WHERE l.id = saved_listings.listing_id
      AND l.deleted_at IS NULL
      AND l.status = 'available'
  )
);

CREATE POLICY saved_listings_delete
ON public.saved_listings
FOR DELETE
TO authenticated
USING (
  user_id = (
    SELECT p.user_id
    FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
      AND COALESCE(p.deleted, false) = false
      AND COALESCE(p.suspended, false) = false
      AND COALESCE(p.banned, false) = false
    LIMIT 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_listings_user_listing
  ON public.saved_listings(user_id, listing_id);

COMMIT;
