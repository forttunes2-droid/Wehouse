-- Short Let apartments carry a required guest capacity from submission to booking.
ALTER TABLE public.inspection_requests ADD COLUMN IF NOT EXISTS max_guests integer;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS max_guests integer;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS guest_count integer NOT NULL DEFAULT 1;

UPDATE public.inspection_requests
SET max_guests = GREATEST(COALESCE(bedrooms, 1) * 2, 1)
WHERE sub_type = 'short_let' AND max_guests IS NULL;

UPDATE public.listings
SET max_guests = GREATEST(COALESCE(bedrooms, 1) * 2, 1)
WHERE sub_type = 'short_let' AND max_guests IS NULL;

ALTER TABLE public.inspection_requests DROP CONSTRAINT IF EXISTS inspection_requests_max_guests_check;
ALTER TABLE public.inspection_requests ADD CONSTRAINT inspection_requests_max_guests_check
  CHECK (max_guests IS NULL OR max_guests >= 1);
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_max_guests_check;
ALTER TABLE public.listings ADD CONSTRAINT listings_max_guests_check
  CHECK (max_guests IS NULL OR max_guests >= 1);
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_guest_count_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_guest_count_check CHECK (guest_count >= 1);

CREATE OR REPLACE FUNCTION public.create_my_property_inspection_batch_v4(p_batch_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id text := (SELECT auth.uid())::text;
  result jsonb;
  created jsonb;
  item jsonb;
  v_position integer;
  request_id uuid;
  v_max_guests integer;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.property_submission_batches b
    WHERE b.id=p_batch_id AND b.partner_user_id=actor_id AND b.status IN ('draft','submitting')
    FOR UPDATE
  ) THEN RAISE EXCEPTION 'Property submission batch not found'; END IF;
  UPDATE public.property_submission_batches SET status='submitting',updated_at=now() WHERE id=p_batch_id;
  result := public.create_my_property_inspection_batch_v3(p_items);
  FOR created IN SELECT value FROM jsonb_array_elements(result->'requests') LOOP
    v_position := (created->>'position')::integer;
    request_id := (created->>'id')::uuid;
    item := p_items->(v_position-1);
    v_max_guests := NULLIF(item->>'max_guests','')::integer;
    IF item->>'property_type'='apartment' AND item->>'sub_type'='short_let' AND COALESCE(v_max_guests,0)<1 THEN
      RAISE EXCEPTION 'Property %: Short Let guest capacity must be at least 1',v_position;
    END IF;
    UPDATE public.inspection_requests SET
      submission_schema_version=2,
      hotel_program=CASE WHEN item->>'property_type'='hotel' THEN item->'hotel_program' ELSE NULL END,
      max_guests=CASE WHEN item->>'property_type'='apartment' AND item->>'sub_type'='short_let' THEN v_max_guests ELSE NULL END,
      submission_batch_id=p_batch_id,
      updated_at=now()
    WHERE id=request_id;
    UPDATE public.property_submission_items SET
      inspection_request_id=request_id,status='submitted',updated_at=now()
    WHERE batch_id=p_batch_id AND position=v_position-1;
  END LOOP;
  UPDATE public.property_submission_batches SET status='submitted',submitted_at=now(),updated_at=now() WHERE id=p_batch_id;
  RETURN result || jsonb_build_object('batch_id',p_batch_id);
EXCEPTION WHEN OTHERS THEN
  UPDATE public.property_submission_batches SET status='draft',updated_at=now() WHERE id=p_batch_id AND partner_user_id=actor_id;
  RAISE;
END $$;

CREATE OR REPLACE FUNCTION public.inherit_short_let_guest_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF NEW.sub_type='short_let' THEN
    IF NEW.inspection_request_id IS NOT NULL THEN
      SELECT COALESCE(ir.max_guests, GREATEST(COALESCE(ir.bedrooms,NEW.bedrooms,1)*2,1))
      INTO NEW.max_guests
      FROM public.inspection_requests ir WHERE ir.id=NEW.inspection_request_id;
    END IF;
    NEW.max_guests := COALESCE(NEW.max_guests,GREATEST(COALESCE(NEW.bedrooms,1)*2,1));
  ELSE
    NEW.max_guests := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS listings_inherit_short_let_guest_capacity ON public.listings;
CREATE TRIGGER listings_inherit_short_let_guest_capacity
BEFORE INSERT OR UPDATE OF inspection_request_id,sub_type,max_guests ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.inherit_short_let_guest_capacity();

CREATE OR REPLACE FUNCTION public.create_short_stay_reservation(
  p_listing_id text,
  p_check_in date,
  p_check_out date,
  p_guest_count integer
) RETURNS public.reservations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_listing public.listings;
  v_created public.reservations;
BEGIN
  SELECT * INTO v_listing FROM public.listings
  WHERE (id::text=p_listing_id OR listing_id=p_listing_id)
    AND deleted_at IS NULL AND sub_type='short_let'
  LIMIT 1 FOR SHARE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Short Stay listing not found'; END IF;
  IF COALESCE(p_guest_count,0)<1 OR p_guest_count>COALESCE(v_listing.max_guests,1) THEN
    RAISE EXCEPTION 'Choose between 1 and % guests',COALESCE(v_listing.max_guests,1);
  END IF;
  v_created := public.create_short_stay_reservation(p_listing_id,p_check_in,p_check_out);
  UPDATE public.reservations SET
    guest_count=p_guest_count,
    listing_location=concat_ws(', ',NULLIF(v_listing.address,''),NULLIF(v_listing.city,''),NULLIF(v_listing.state,'')),
    updated_at=now()
  WHERE id=v_created.id RETURNING * INTO v_created;
  RETURN v_created;
END $$;

REVOKE ALL ON FUNCTION public.create_short_stay_reservation(text,date,date,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_short_stay_reservation(text,date,date,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_short_stay_reservation(text,date,date,integer) TO authenticated,service_role;
