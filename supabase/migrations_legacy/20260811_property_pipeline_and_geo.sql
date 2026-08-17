-- Canonical WeHouse property pipeline + branch-safe Field Officer geo ranking

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS inspection_request_id UUID REFERENCES public.inspection_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS listings_one_per_inspection_idx
  ON public.listings(inspection_request_id)
  WHERE inspection_request_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.staff_location_presence (
  staff_id TEXT PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  latitude NUMERIC NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m NUMERIC,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.staff_location_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_location_presence FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.staff_location_presence TO authenticated;

DROP POLICY IF EXISTS staff_location_self_read ON public.staff_location_presence;
CREATE POLICY staff_location_self_read ON public.staff_location_presence
FOR SELECT TO authenticated
USING (staff_id = (SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text LIMIT 1));

DROP POLICY IF EXISTS staff_location_self_write ON public.staff_location_presence;
CREATE POLICY staff_location_self_write ON public.staff_location_presence
FOR ALL TO authenticated
USING (staff_id = (SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text LIMIT 1))
WITH CHECK (staff_id = (SELECT user_id FROM public.profiles WHERE auth_id = auth.uid()::text LIMIT 1));

DROP FUNCTION IF EXISTS public.create_my_property_inspection_request(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,NUMERIC,TEXT,TEXT,TEXT[]);
CREATE FUNCTION public.create_my_property_inspection_request(
  p_property_address TEXT,
  p_property_city TEXT,
  p_property_state TEXT,
  p_property_type TEXT,
  p_bedrooms INTEGER DEFAULT NULL,
  p_bathrooms INTEGER DEFAULT NULL,
  p_expected_rent NUMERIC DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_owner_phone TEXT DEFAULT NULL,
  p_photo_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_gps_latitude NUMERIC DEFAULT NULL,
  p_gps_longitude NUMERIC DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_profile RECORD; v_request_id UUID; v_request_code TEXT;
BEGIN
  SELECT user_id,email,phone,role,deleted,suspended,banned INTO v_profile
  FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_profile IS NULL OR v_profile.role<>'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
  IF COALESCE(v_profile.deleted,false) OR COALESCE(v_profile.suspended,false) OR COALESCE(v_profile.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;
  IF NULLIF(BTRIM(p_property_address),'') IS NULL OR NULLIF(BTRIM(p_property_city),'') IS NULL OR NULLIF(BTRIM(p_property_state),'') IS NULL THEN RAISE EXCEPTION 'Property address, state and LGA are required'; END IF;
  IF p_gps_latitude IS NOT NULL AND (p_gps_latitude < -90 OR p_gps_latitude > 90) THEN RAISE EXCEPTION 'Invalid latitude'; END IF;
  IF p_gps_longitude IS NOT NULL AND (p_gps_longitude < -180 OR p_gps_longitude > 180) THEN RAISE EXCEPTION 'Invalid longitude'; END IF;
  v_request_code := 'WHIR-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text,'-','') FROM 1 FOR 10));
  INSERT INTO public.inspection_requests(request_code,owner_id,owner_email,owner_phone,property_address,property_city,property_state,property_type,bedrooms,bathrooms,expected_rent,description,photo_urls,gps_latitude,gps_longitude,status,created_at,updated_at)
  VALUES(v_request_code,v_profile.user_id,v_profile.email,COALESCE(NULLIF(BTRIM(p_owner_phone),''),v_profile.phone),BTRIM(p_property_address),BTRIM(p_property_city),BTRIM(p_property_state),BTRIM(p_property_type),p_bedrooms,p_bathrooms,p_expected_rent,NULLIF(BTRIM(p_description),''),COALESCE(p_photo_urls,ARRAY[]::text[]),p_gps_latitude,p_gps_longitude,'pending',NOW(),NOW())
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_my_field_location(p_latitude NUMERIC,p_longitude NUMERIC,p_accuracy_m NUMERIC DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR NOT public.current_staff_has_permission('field_officer') THEN RAISE EXCEPTION 'Field Officer permission required'; END IF;
  IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid coordinates'; END IF;
  INSERT INTO public.staff_location_presence(staff_id,latitude,longitude,accuracy_m,captured_at)
  VALUES(v_actor.user_id,p_latitude,p_longitude,p_accuracy_m,NOW())
  ON CONFLICT(staff_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,accuracy_m=EXCLUDED.accuracy_m,captured_at=NOW();
END $$;

CREATE OR REPLACE FUNCTION public.get_my_property_pipeline(p_stage TEXT DEFAULT 'all')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles; v_result JSONB;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator','staff') THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  IF v_actor.role IN ('admin','staff') AND (v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL) THEN RAISE EXCEPTION 'Branch assignment required'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',ir.id,'request_code',ir.request_code,'owner_id',ir.owner_id,'owner_name',COALESCE(owner.full_name,owner.username,owner.email),
    'owner_email',ir.owner_email,'owner_phone',ir.owner_phone,'property_address',ir.property_address,'property_city',ir.property_city,'property_state',ir.property_state,
    'property_type',ir.property_type,'bedrooms',ir.bedrooms,'bathrooms',ir.bathrooms,'expected_rent',ir.expected_rent,'description',ir.description,'status',ir.status,
    'scheduled_date',ir.scheduled_date,'assigned_field_officer_id',COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to),
    'field_officer_name',COALESCE(officer.full_name,officer.username,officer.email),'notes',ir.notes,'photo_urls',ir.photo_urls,'document_urls',ir.document_urls,
    'gps_latitude',ir.gps_latitude,'gps_longitude',ir.gps_longitude,'draft_listing_id',ir.draft_listing_id,'approved_by',ir.approved_by,'approved_at',ir.approved_at,'published_at',ir.published_at,
    'listing',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('id',l.id,'listing_id',l.listing_id,'title',l.title,'price',l.price,'status',l.status,'availability_status',l.availability_status,'images',l.images,'created_at',l.created_at) END,
    'created_at',ir.created_at
  ) ORDER BY ir.created_at DESC),'[]'::jsonb) INTO v_result
  FROM public.inspection_requests ir
  LEFT JOIN public.profiles owner ON owner.user_id=ir.owner_id
  LEFT JOIN public.profiles officer ON officer.user_id=COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)
  LEFT JOIN public.listings l ON l.id=ir.draft_listing_id AND l.deleted_at IS NULL
  WHERE (v_actor.role='creator' OR (ir.property_state=v_actor.assigned_state AND ir.property_city=v_actor.assigned_lga))
    AND (
      p_stage='all'
      OR (p_stage='new' AND ir.status='pending' AND COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to) IS NULL)
      OR (p_stage='inspection' AND ir.status IN ('pending','scheduled','in_progress') AND COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to) IS NOT NULL)
      OR (p_stage='ready' AND ir.status IN ('completed','approved') AND ir.draft_listing_id IS NULL)
      OR (p_stage='preparing' AND ir.draft_listing_id IS NOT NULL AND ir.published_at IS NULL)
      OR (p_stage='published' AND ir.published_at IS NOT NULL)
      OR (p_stage='rejected' AND ir.status='rejected')
    );
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_get_field_officers_for_inspection(p_inspection_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles; v_ir public.inspection_requests; v_result JSONB;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id;
  IF v_ir IS NULL THEN RAISE EXCEPTION 'Inspection request not found'; END IF;
  IF v_actor.role='admin' AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'distance_km')::numeric NULLS LAST,(x->>'active_inspections')::int,COALESCE(x->>'name','')),'[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'user_id',p.user_id,'name',COALESCE(p.full_name,p.username,p.email),'email',p.email,'assigned_state',p.assigned_state,'assigned_lga',p.assigned_lga,
      'active_inspections',(SELECT count(*) FROM public.inspection_requests q WHERE COALESCE(q.assigned_field_officer_id,q.field_officer_id,q.assigned_to)=p.user_id AND q.status IN ('scheduled','in_progress')),
      'location_captured_at',loc.captured_at,
      'distance_km',CASE WHEN v_ir.gps_latitude IS NOT NULL AND v_ir.gps_longitude IS NOT NULL AND loc.latitude IS NOT NULL AND loc.longitude IS NOT NULL AND loc.captured_at > NOW()-INTERVAL '24 hours' THEN ROUND((6371*2*ASIN(SQRT(POWER(SIN(RADIANS((loc.latitude-v_ir.gps_latitude)/2)),2)+COS(RADIANS(v_ir.gps_latitude))*COS(RADIANS(loc.latitude))*POWER(SIN(RADIANS((loc.longitude-v_ir.gps_longitude)/2)),2))))::numeric,2) ELSE NULL END
    ) x
    FROM public.profiles p
    JOIN public.staff_permissions sp ON sp.staff_id=p.user_id AND sp.permission='field_officer' AND sp.is_active=true
    LEFT JOIN public.staff_location_presence loc ON loc.staff_id=p.user_id
    WHERE p.role='staff' AND NOT COALESCE(p.deleted,false) AND NOT COALESCE(p.suspended,false) AND NOT COALESCE(p.banned,false)
      AND p.assigned_state=v_ir.property_state AND p.assigned_lga=v_ir.property_city
  ) ranked;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_assign_field_officer(p_inspection_id UUID,p_field_officer_id TEXT,p_scheduled_date DATE DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles; v_ir public.inspection_requests; v_officer public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id FOR UPDATE;
  IF v_ir IS NULL THEN RAISE EXCEPTION 'Inspection request not found'; END IF;
  IF v_actor.role='admin' AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
  SELECT * INTO v_officer FROM public.profiles WHERE user_id=p_field_officer_id;
  IF v_officer IS NULL OR v_officer.role<>'staff' OR v_officer.assigned_state IS DISTINCT FROM v_ir.property_state OR v_officer.assigned_lga IS DISTINCT FROM v_ir.property_city OR NOT EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=v_officer.user_id AND sp.permission='field_officer' AND sp.is_active=true) THEN RAISE EXCEPTION 'Field Officer must be active and assigned to the same LGA as the property'; END IF;
  UPDATE public.inspection_requests SET assigned_to=v_officer.user_id,field_officer_id=v_officer.user_id,assigned_field_officer_id=v_officer.user_id,assigned_at=NOW(),scheduled_date=p_scheduled_date,status='scheduled',updated_at=NOW() WHERE id=p_inspection_id;
END $$;

CREATE OR REPLACE FUNCTION public.post_property_from_inspection(p_data JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_caller public.profiles; v_ir public.inspection_requests; v_partner public.profiles; v_listing_id UUID; v_code TEXT; v_images TEXT[]; v_videos TEXT[];
BEGIN
  SELECT * INTO v_caller FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_caller IS NULL OR v_caller.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
  IF v_caller.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=(p_data->>'inspection_id')::uuid FOR UPDATE;
  IF v_ir IS NULL OR v_ir.status NOT IN ('completed','approved') THEN RAISE EXCEPTION 'Inspection must be completed before listing preparation'; END IF;
  IF v_caller.role IN ('admin','staff') AND (v_ir.property_state IS DISTINCT FROM v_caller.assigned_state OR v_ir.property_city IS DISTINCT FROM v_caller.assigned_lga) THEN RAISE EXCEPTION 'Property is outside your assigned branch'; END IF;
  IF v_ir.draft_listing_id IS NOT NULL THEN RAISE EXCEPTION 'A listing has already been prepared from this inspection'; END IF;
  SELECT * INTO v_partner FROM public.profiles WHERE user_id=v_ir.owner_id AND role='property_partner';
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Valid Property Partner owner required'; END IF;
  IF NULLIF(BTRIM(p_data->>'title'),'') IS NULL OR COALESCE((p_data->>'price')::numeric,0)<=0 THEN RAISE EXCEPTION 'Listing title and valid price are required'; END IF;
  SELECT COALESCE(array_agg(value),ARRAY[]::text[]) INTO v_images FROM jsonb_array_elements_text(COALESCE(p_data->'images','[]'::jsonb));
  SELECT COALESCE(array_agg(value),ARRAY[]::text[]) INTO v_videos FROM jsonb_array_elements_text(COALESCE(p_data->'videos','[]'::jsonb));
  v_code := 'WHL-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text,'-','') FROM 1 FOR 12));
  INSERT INTO public.listings(listing_id,title,description,price,currency,state,city,address,images,videos,bedrooms,bathrooms,property_type,availability_status,owner_id,partner_id,chat_agent_id,status,submitted_by_role,reservation_fee_paid,chat_unlocked,gps_latitude,gps_longitude,inspection_request_id,created_at,updated_at)
  VALUES(v_code,BTRIM(p_data->>'title'),NULLIF(BTRIM(p_data->>'description'),''),(p_data->>'price')::numeric,'NGN',v_ir.property_state,v_ir.property_city,v_ir.property_address,v_images,v_videos,COALESCE((p_data->>'bedrooms')::int,v_ir.bedrooms,1),COALESCE((p_data->>'bathrooms')::int,v_ir.bathrooms,1),COALESCE(NULLIF(BTRIM(p_data->>'property_type'),''),v_ir.property_type,'apartment'),'pending_approval',v_partner.user_id,v_partner.user_id,v_caller.user_id,'pending_approval','property_partner',false,false,v_ir.gps_latitude,v_ir.gps_longitude,v_ir.id,NOW(),NOW()) RETURNING id INTO v_listing_id;
  UPDATE public.inspection_requests SET draft_listing_id=v_listing_id,updated_at=NOW() WHERE id=v_ir.id;
  RETURN v_listing_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_publish_inspected_listing(p_listing_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles; v_listing public.listings; v_ir public.inspection_requests;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL OR v_listing.inspection_request_id IS NULL THEN RAISE EXCEPTION 'Inspection-linked listing required'; END IF;
  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=v_listing.inspection_request_id FOR UPDATE;
  IF v_ir.status NOT IN ('completed','approved') THEN RAISE EXCEPTION 'Inspection is not complete'; END IF;
  IF v_actor.role='admin' AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Property is outside your assigned branch'; END IF;
  IF NULLIF(BTRIM(v_listing.title),'') IS NULL OR COALESCE(v_listing.price,0)<=0 OR COALESCE(array_length(v_listing.images,1),0)<1 THEN RAISE EXCEPTION 'Title, valid price and at least one image are required before publication'; END IF;
  UPDATE public.listings SET status='available',availability_status='available',approved_by=v_actor.user_id,approved_at=NOW(),rejection_reason=NULL,updated_at=NOW() WHERE id=p_listing_id;
  UPDATE public.inspection_requests SET status='approved',approved_by=v_actor.user_id,approved_at=NOW(),published_at=NOW(),updated_at=NOW() WHERE id=v_ir.id;
END $$;

CREATE OR REPLACE FUNCTION public.guard_inspected_public_listing()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_status TEXT;
BEGIN
  IF NEW.status='available' OR NEW.availability_status='available' THEN
    IF NEW.inspection_request_id IS NULL OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN RAISE EXCEPTION 'Public listings must come through the completed inspection publication workflow'; END IF;
    SELECT status INTO v_status FROM public.inspection_requests WHERE id=NEW.inspection_request_id;
    IF v_status NOT IN ('completed','approved') THEN RAISE EXCEPTION 'Linked inspection must be complete before publication'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_inspected_public_listing_trigger ON public.listings;
CREATE TRIGGER guard_inspected_public_listing_trigger BEFORE INSERT OR UPDATE OF status,availability_status ON public.listings FOR EACH ROW EXECUTE FUNCTION public.guard_inspected_public_listing();

REVOKE EXECUTE ON FUNCTION public.create_my_property_inspection_request(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,NUMERIC,TEXT,TEXT,TEXT[],NUMERIC,NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_my_field_location(NUMERIC,NUMERIC,NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_property_pipeline(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_field_officers_for_inspection(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_assign_field_officer(UUID,TEXT,DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.post_property_from_inspection(JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_publish_inspected_listing(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_my_property_inspection_request(TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,NUMERIC,TEXT,TEXT,TEXT[],NUMERIC,NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_field_location(NUMERIC,NUMERIC,NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_property_pipeline(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_field_officers_for_inspection(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_field_officer(UUID,TEXT,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_property_from_inspection(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_inspected_listing(UUID) TO authenticated;