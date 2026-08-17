ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS inspection_request_id UUID REFERENCES public.inspection_requests(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS gps_latitude NUMERIC, ADD COLUMN IF NOT EXISTS gps_longitude NUMERIC, ADD COLUMN IF NOT EXISTS approved_by TEXT, ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS hotels_one_per_inspection_idx ON public.hotels(inspection_request_id) WHERE inspection_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_create_hotel_from_inspection(p_inspection_id UUID,p_name TEXT,p_description TEXT DEFAULT NULL,p_images TEXT[] DEFAULT ARRAY[]::TEXT[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles; v_ir public.inspection_requests; v_id INTEGER;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator','staff') THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
 SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id FOR UPDATE;
 IF v_ir IS NULL OR v_ir.property_type<>'hotel' OR v_ir.status NOT IN ('completed','approved') THEN RAISE EXCEPTION 'Completed hotel inspection required'; END IF;
 IF v_actor.role IN ('admin','staff') AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Hotel is outside your assigned branch'; END IF;
 IF NULLIF(BTRIM(p_name),'') IS NULL THEN RAISE EXCEPTION 'Hotel name is required'; END IF;
 INSERT INTO public.hotels(name,description,state,city,address,images,amenities,owner_id,status,featured,gps_latitude,gps_longitude,inspection_request_id,created_at,updated_at)
 VALUES(BTRIM(p_name),NULLIF(BTRIM(p_description),''),v_ir.property_state,v_ir.property_city,v_ir.property_address,COALESCE(p_images,ARRAY[]::TEXT[]),ARRAY[]::TEXT[],v_ir.owner_id,'draft',false,v_ir.gps_latitude,v_ir.gps_longitude,v_ir.id,NOW(),NOW()) RETURNING hotel_id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_publish_inspected_hotel(p_hotel_id INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles; v_h public.hotels; v_ir public.inspection_requests; v_rooms INTEGER;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
 SELECT * INTO v_h FROM public.hotels WHERE hotel_id=p_hotel_id FOR UPDATE;
 IF v_h IS NULL OR v_h.inspection_request_id IS NULL THEN RAISE EXCEPTION 'Inspection-linked hotel required'; END IF;
 SELECT * INTO v_ir FROM public.inspection_requests WHERE id=v_h.inspection_request_id FOR UPDATE;
 IF v_actor.role='admin' AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Hotel is outside your assigned branch'; END IF;
 SELECT count(*) INTO v_rooms FROM public.hotel_rooms WHERE hotel_id=p_hotel_id;
 IF COALESCE(array_length(v_h.images,1),0)<1 OR v_rooms<1 THEN RAISE EXCEPTION 'At least one hotel image and one room type are required before publication'; END IF;
 UPDATE public.hotels SET status='active',approved_by=v_actor.user_id,approved_at=NOW(),published_at=NOW(),updated_at=NOW() WHERE hotel_id=p_hotel_id;
 UPDATE public.inspection_requests SET status='approved',approved_by=v_actor.user_id,approved_at=NOW(),published_at=NOW(),updated_at=NOW() WHERE id=v_ir.id;
END $$;

CREATE OR REPLACE FUNCTION public.guard_inspected_public_hotel() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status='active' AND (NEW.inspection_request_id IS NULL OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL) THEN RAISE EXCEPTION 'Public hotels must come through the inspection publication workflow'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_inspected_public_hotel_trigger ON public.hotels;
CREATE TRIGGER guard_inspected_public_hotel_trigger BEFORE INSERT OR UPDATE OF status ON public.hotels FOR EACH ROW EXECUTE FUNCTION public.guard_inspected_public_hotel();
REVOKE EXECUTE ON FUNCTION public.admin_create_hotel_from_inspection(UUID,TEXT,TEXT,TEXT[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_publish_inspected_hotel(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_create_hotel_from_inspection(UUID,TEXT,TEXT,TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_inspected_hotel(INTEGER) TO authenticated;