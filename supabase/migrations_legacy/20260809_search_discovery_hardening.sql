-- Search & Discovery hardening
-- Canonical public discovery:
--   apartments -> public.listings where status='available' (existing listings_canonical_select)
--   hotels     -> public.hotels where status='active'
-- Browser discovery must never gain write access through permissive public policies.

BEGIN;

ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hotels_all ON public.hotels;
DROP POLICY IF EXISTS hotels_insert ON public.hotels;
DROP POLICY IF EXISTS hotels_select ON public.hotels;
DROP POLICY IF EXISTS hotels_update ON public.hotels;
DROP POLICY IF EXISTS hotels_delete ON public.hotels;

CREATE POLICY hotels_canonical_select
ON public.hotels
FOR SELECT
TO anon, authenticated
USING (
  status = 'active'
  OR owner_id = (
    SELECT p.user_id FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
    LIMIT 1
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('staff', 'admin', 'creator')
      AND COALESCE(actor.deleted, false) = false
      AND COALESCE(actor.suspended, false) = false
      AND COALESCE(actor.banned, false) = false
  )
);

CREATE POLICY hotels_internal_insert
ON public.hotels
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('staff', 'admin', 'creator')
      AND COALESCE(actor.deleted, false) = false
      AND COALESCE(actor.suspended, false) = false
      AND COALESCE(actor.banned, false) = false
  )
);

CREATE POLICY hotels_internal_update
ON public.hotels
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('staff', 'admin', 'creator')
      AND COALESCE(actor.deleted, false) = false
      AND COALESCE(actor.suspended, false) = false
      AND COALESCE(actor.banned, false) = false
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('staff', 'admin', 'creator')
      AND COALESCE(actor.deleted, false) = false
      AND COALESCE(actor.suspended, false) = false
      AND COALESCE(actor.banned, false) = false
  )
);

CREATE POLICY hotels_internal_delete
ON public.hotels
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin', 'creator')
      AND COALESCE(actor.deleted, false) = false
      AND COALESCE(actor.suspended, false) = false
      AND COALESCE(actor.banned, false) = false
  )
);

DROP POLICY IF EXISTS hotel_rooms_all ON public.hotel_rooms;
DROP POLICY IF EXISTS hotel_rooms_insert ON public.hotel_rooms;
DROP POLICY IF EXISTS hotel_rooms_select ON public.hotel_rooms;
DROP POLICY IF EXISTS hotel_rooms_update ON public.hotel_rooms;
DROP POLICY IF EXISTS hotel_rooms_delete ON public.hotel_rooms;

CREATE POLICY hotel_rooms_canonical_select
ON public.hotel_rooms
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE h.hotel_id = hotel_rooms.hotel_id
      AND (
        h.status = 'active'
        OR h.owner_id = (
          SELECT p.user_id FROM public.profiles p
          WHERE p.auth_id = auth.uid()::text
          LIMIT 1
        )
        OR EXISTS (
          SELECT 1 FROM public.profiles actor
          WHERE actor.auth_id = auth.uid()::text
            AND actor.role IN ('staff', 'admin', 'creator')
            AND COALESCE(actor.deleted, false) = false
            AND COALESCE(actor.suspended, false) = false
            AND COALESCE(actor.banned, false) = false
        )
      )
  )
);

CREATE POLICY hotel_rooms_internal_insert
ON public.hotel_rooms
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('staff', 'admin', 'creator')
      AND COALESCE(actor.deleted, false) = false
      AND COALESCE(actor.suspended, false) = false
      AND COALESCE(actor.banned, false) = false
  )
);

CREATE POLICY hotel_rooms_internal_update
ON public.hotel_rooms
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('staff', 'admin', 'creator')
      AND COALESCE(actor.deleted, false) = false
      AND COALESCE(actor.suspended, false) = false
      AND COALESCE(actor.banned, false) = false
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('staff', 'admin', 'creator')
      AND COALESCE(actor.deleted, false) = false
      AND COALESCE(actor.suspended, false) = false
      AND COALESCE(actor.banned, false) = false
  )
);

CREATE POLICY hotel_rooms_internal_delete
ON public.hotel_rooms
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin', 'creator')
      AND COALESCE(actor.deleted, false) = false
      AND COALESCE(actor.suspended, false) = false
      AND COALESCE(actor.banned, false) = false
  )
);

COMMIT;
