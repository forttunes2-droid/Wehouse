-- Keep Property Partner dashboard inventory aligned with the canonical listing lifecycle.
-- Partners follow pending/rejected property work through inspection requests; My Properties is published inventory.

DROP POLICY IF EXISTS listings_canonical_select ON public.listings;

CREATE POLICY listings_canonical_select
ON public.listings
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    (
      status = 'available'
      AND inspection_request_id IS NOT NULL
      AND approved_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.profiles owner
        WHERE owner.user_id = listings.owner_id
          AND NOT COALESCE(owner.deleted,false)
          AND NOT COALESCE(owner.suspended,false)
          AND NOT COALESCE(owner.banned,false)
      )
    )
    OR reserved_by = (
      SELECT p.user_id
      FROM public.profiles p
      WHERE p.auth_id = auth.uid()::text
      LIMIT 1
    )
    OR (
      owner_id = (
        SELECT p.user_id
        FROM public.profiles p
        WHERE p.auth_id = auth.uid()::text
        LIMIT 1
      )
      AND status IN ('available','reserved','closed')
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles actor
      WHERE actor.auth_id = auth.uid()::text
        AND actor.role IN ('staff','admin','creator')
        AND NOT COALESCE(actor.deleted,false)
        AND NOT COALESCE(actor.suspended,false)
        AND NOT COALESCE(actor.banned,false)
    )
  )
);
