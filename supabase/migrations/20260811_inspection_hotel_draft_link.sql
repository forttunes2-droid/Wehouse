ALTER TABLE public.inspection_requests ADD COLUMN IF NOT EXISTS draft_hotel_id INTEGER REFERENCES public.hotels(hotel_id) ON DELETE SET NULL;

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
 IF v_ir.draft_hotel_id IS NOT NULL THEN RAISE EXCEPTION 'A hotel has already been prepared from this inspection'; END IF;
 IF NULLIF(BTRIM(p_name),'') IS NULL THEN RAISE EXCEPTION 'Hotel name is required'; END IF;
 INSERT INTO public.hotels(name,description,state,city,address,images,amenities,owner_id,status,featured,gps_latitude,gps_longitude,inspection_request_id,created_at,updated_at)
 VALUES(BTRIM(p_name),NULLIF(BTRIM(p_description),''),v_ir.property_state,v_ir.property_city,v_ir.property_address,COALESCE(p_images,ARRAY[]::TEXT[]),ARRAY[]::TEXT[],v_ir.owner_id,'draft',false,v_ir.gps_latitude,v_ir.gps_longitude,v_ir.id,NOW(),NOW()) RETURNING hotel_id INTO v_id;
 UPDATE public.inspection_requests SET draft_hotel_id=v_id,updated_at=NOW() WHERE id=v_ir.id;
 RETURN v_id;
END $$;