-- Listings workflow consolidation
-- Applied to production on 2026-08-09.
-- Canonical lifecycle: listings.status. availability_status remains synchronized for compatibility.
-- All listing mutations go through authenticated SECURITY DEFINER RPCs.

BEGIN;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sub_type TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS amenities TEXT[] DEFAULT '{}'::TEXT[];

UPDATE public.listings l
SET owner_id = p.user_id, updated_at = NOW()
FROM public.profiles p
WHERE l.owner_id = p.auth_id
  AND NOT EXISTS (SELECT 1 FROM public.profiles direct_owner WHERE direct_owner.user_id = l.owner_id);

UPDATE public.listings
SET status = CASE WHEN status IN ('available','reserved','closed','pending_approval','rejected') THEN status WHEN availability_status IN ('available','reserved','closed','pending_approval','rejected') THEN availability_status ELSE 'closed' END,
    availability_status = CASE WHEN status IN ('available','reserved','closed','pending_approval','rejected') THEN status WHEN availability_status IN ('available','reserved','closed','pending_approval','rejected') THEN availability_status ELSE 'closed' END;

ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE public.listings ADD CONSTRAINT listings_status_check CHECK (status IN ('available','reserved','closed','pending_approval','rejected'));
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_availability_status_check;
ALTER TABLE public.listings ADD CONSTRAINT listings_availability_status_check CHECK (availability_status IN ('available','reserved','closed','pending_approval','rejected'));
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_sub_type_check;
ALTER TABLE public.listings ADD CONSTRAINT listings_sub_type_check CHECK (sub_type IS NULL OR sub_type IN ('short_let','long_stay'));

CREATE OR REPLACE FUNCTION public.sync_listing_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.status:=COALESCE(NEW.status,NEW.availability_status,'pending_approval'); NEW.availability_status:=NEW.status;
 ELSIF NEW.status IS DISTINCT FROM OLD.status THEN NEW.availability_status:=NEW.status;
 ELSIF NEW.availability_status IS DISTINCT FROM OLD.availability_status THEN NEW.status:=NEW.availability_status;
 END IF;
 NEW.updated_at:=NOW(); RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS sync_listing_lifecycle_trigger ON public.listings;
CREATE TRIGGER sync_listing_lifecycle_trigger BEFORE INSERT OR UPDATE OF status,availability_status ON public.listings FOR EACH ROW EXECUTE FUNCTION public.sync_listing_lifecycle();

CREATE OR REPLACE FUNCTION public.create_internal_listing(p_data JSONB)
RETURNS public.listings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles%ROWTYPE;v_owner_id TEXT;v_partner_id TEXT;v_initial_status TEXT;v_listing public.listings%ROWTYPE;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::TEXT AND COALESCE(deleted,FALSE)=FALSE AND COALESCE(suspended,FALSE)=FALSE AND COALESCE(banned,FALSE)=FALSE LIMIT 1;
 IF v_actor.user_id IS NULL OR v_actor.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'Only authorized WeHouse staff can create listings'; END IF;
 v_partner_id:=NULLIF(BTRIM(p_data->>'partner_id'),'');
 IF v_partner_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=v_partner_id AND role='property_partner' AND COALESCE(deleted,FALSE)=FALSE AND COALESCE(suspended,FALSE)=FALSE AND COALESCE(banned,FALSE)=FALSE) THEN RAISE EXCEPTION 'Assigned Property Partner is invalid or inactive'; END IF;
  v_owner_id:=v_partner_id;
 ELSE v_owner_id:=v_actor.user_id; END IF;
 IF NULLIF(BTRIM(p_data->>'title'),'') IS NULL THEN RAISE EXCEPTION 'Listing title is required'; END IF;
 IF COALESCE((p_data->>'price')::NUMERIC,0)<=0 THEN RAISE EXCEPTION 'Listing price must be greater than zero'; END IF;
 IF NULLIF(BTRIM(p_data->>'city'),'') IS NULL THEN RAISE EXCEPTION 'Listing city/LGA is required'; END IF;
 v_initial_status:=CASE WHEN v_actor.role='creator' THEN 'available' ELSE 'pending_approval' END;
 INSERT INTO public.listings(listing_id,title,description,price,currency,state,city,address,images,videos,property_type,sub_type,bedrooms,bathrooms,status,availability_status,owner_id,partner_id,chat_agent_id,submitted_by_role,reserved_by,reservation_expiry,reservation_fee_paid,chat_unlocked,security_deposit_amount,contact_phone,amenities)
 VALUES(gen_random_uuid()::TEXT,BTRIM(p_data->>'title'),NULLIF(BTRIM(p_data->>'description'),''),(p_data->>'price')::NUMERIC,COALESCE(NULLIF(BTRIM(p_data->>'currency'),''),'NGN'),NULLIF(BTRIM(p_data->>'state'),''),BTRIM(p_data->>'city'),NULLIF(BTRIM(p_data->>'address'),''),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_data->'images','[]'::JSONB))),ARRAY[]::TEXT[]),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_data->'videos','[]'::JSONB))),ARRAY[]::TEXT[]),NULLIF(BTRIM(p_data->>'property_type'),''),NULLIF(BTRIM(p_data->>'sub_type'),''),COALESCE((p_data->>'bedrooms')::INTEGER,1),COALESCE((p_data->>'bathrooms')::INTEGER,1),v_initial_status,v_initial_status,v_owner_id,v_partner_id,CASE WHEN v_actor.role='staff' THEN v_actor.user_id ELSE NULLIF(BTRIM(p_data->>'chat_agent_id'),'') END,v_actor.role,NULL,NULL,FALSE,FALSE,NULLIF(p_data->>'security_deposit_amount','')::NUMERIC,NULLIF(BTRIM(p_data->>'contact_phone'),''),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_data->'amenities','[]'::JSONB))),ARRAY[]::TEXT[])) RETURNING * INTO v_listing;
 RETURN v_listing;
END;$$;

CREATE OR REPLACE FUNCTION public.approve_listing_internal(p_listing_id UUID)
RETURNS public.listings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles%ROWTYPE;v_listing public.listings%ROWTYPE;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
 IF v_actor.user_id IS NULL OR v_actor.role NOT IN ('admin','creator') OR COALESCE(v_actor.deleted,FALSE) OR COALESCE(v_actor.suspended,FALSE) OR COALESCE(v_actor.banned,FALSE) THEN RAISE EXCEPTION 'Not authorized to approve listings'; END IF;
 SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
 IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
 IF v_listing.status<>'pending_approval' THEN RAISE EXCEPTION 'Only pending listings can be approved'; END IF;
 IF v_actor.role='admin' AND COALESCE(v_listing.submitted_by_role,'staff')<>'staff' THEN RAISE EXCEPTION 'Admin can approve Staff submissions only'; END IF;
 UPDATE public.listings SET status='available',approved_by=v_actor.user_id,approved_at=NOW(),rejection_reason=NULL WHERE id=p_listing_id RETURNING * INTO v_listing;
 RETURN v_listing;
END;$$;

CREATE OR REPLACE FUNCTION public.reject_listing_internal(p_listing_id UUID,p_reason TEXT)
RETURNS public.listings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles%ROWTYPE;v_listing public.listings%ROWTYPE;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
 IF v_actor.user_id IS NULL OR v_actor.role NOT IN ('admin','creator') OR COALESCE(v_actor.deleted,FALSE) OR COALESCE(v_actor.suspended,FALSE) OR COALESCE(v_actor.banned,FALSE) THEN RAISE EXCEPTION 'Not authorized to reject listings'; END IF;
 IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
 SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
 IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
 IF v_listing.status<>'pending_approval' THEN RAISE EXCEPTION 'Only pending listings can be rejected'; END IF;
 IF v_actor.role='admin' AND COALESCE(v_listing.submitted_by_role,'staff')<>'staff' THEN RAISE EXCEPTION 'Admin can reject Staff submissions only'; END IF;
 UPDATE public.listings SET status='rejected',approved_by=v_actor.user_id,approved_at=NOW(),rejection_reason=BTRIM(p_reason) WHERE id=p_listing_id RETURNING * INTO v_listing;
 RETURN v_listing;
END;$$;

CREATE OR REPLACE FUNCTION public.set_listing_status_internal(p_listing_id TEXT,p_status TEXT)
RETURNS public.listings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles%ROWTYPE;v_listing public.listings%ROWTYPE;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
 IF v_actor.user_id IS NULL OR v_actor.role NOT IN ('staff','admin','creator') OR COALESCE(v_actor.deleted,FALSE) OR COALESCE(v_actor.suspended,FALSE) OR COALESCE(v_actor.banned,FALSE) THEN RAISE EXCEPTION 'Not authorized to manage listing status'; END IF;
 IF p_status NOT IN ('available','reserved','closed') THEN RAISE EXCEPTION 'Invalid operational listing status'; END IF;
 SELECT * INTO v_listing FROM public.listings WHERE (listing_id=p_listing_id OR id::TEXT=p_listing_id) AND deleted_at IS NULL FOR UPDATE;
 IF v_listing.id IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
 IF v_listing.status IN ('pending_approval','rejected') THEN RAISE EXCEPTION 'Approval state must be resolved first'; END IF;
 UPDATE public.listings SET status=p_status WHERE id=v_listing.id RETURNING * INTO v_listing;
 RETURN v_listing;
END;$$;

CREATE OR REPLACE FUNCTION public.soft_delete_listing_internal(p_listing_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles%ROWTYPE;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::TEXT LIMIT 1;
 IF v_actor.user_id IS NULL OR v_actor.role NOT IN ('admin','creator') OR COALESCE(v_actor.deleted,FALSE) OR COALESCE(v_actor.suspended,FALSE) OR COALESCE(v_actor.banned,FALSE) THEN RAISE EXCEPTION 'Only Admin or Creator can remove listings'; END IF;
 UPDATE public.listings SET status='closed',deleted_at=NOW() WHERE id=p_listing_id AND deleted_at IS NULL;
 RETURN FOUND;
END;$$;

REVOKE ALL ON FUNCTION public.create_internal_listing(JSONB) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.approve_listing_internal(UUID) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.reject_listing_internal(UUID,TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.set_listing_status_internal(TEXT,TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.soft_delete_listing_internal(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_internal_listing(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_listing_internal(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_listing_internal(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_listing_status_internal(TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_listing_internal(UUID) TO authenticated;

DROP POLICY IF EXISTS listings_delete ON public.listings;
DROP POLICY IF EXISTS listings_insert ON public.listings;
DROP POLICY IF EXISTS listings_public_read ON public.listings;
DROP POLICY IF EXISTS listings_select ON public.listings;
DROP POLICY IF EXISTS listings_staff_all ON public.listings;
DROP POLICY IF EXISTS listings_update ON public.listings;
CREATE POLICY listings_canonical_select ON public.listings FOR SELECT TO anon,authenticated USING(deleted_at IS NULL AND ((status='available' AND EXISTS(SELECT 1 FROM public.profiles owner WHERE owner.user_id=listings.owner_id AND COALESCE(owner.deleted,FALSE)=FALSE AND COALESCE(owner.suspended,FALSE)=FALSE AND COALESCE(owner.banned,FALSE)=FALSE)) OR reserved_by=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::TEXT LIMIT 1) OR owner_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::TEXT LIMIT 1) OR EXISTS(SELECT 1 FROM public.profiles actor WHERE actor.auth_id=auth.uid()::TEXT AND actor.role IN ('staff','admin','creator') AND COALESCE(actor.deleted,FALSE)=FALSE AND COALESCE(actor.suspended,FALSE)=FALSE AND COALESCE(actor.banned,FALSE)=FALSE)));

CREATE INDEX IF NOT EXISTS idx_listings_public_status ON public.listings(status,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_listings_owner_active ON public.listings(owner_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_listings_partner_active ON public.listings(partner_id,created_at DESC) WHERE deleted_at IS NULL;

COMMIT;
