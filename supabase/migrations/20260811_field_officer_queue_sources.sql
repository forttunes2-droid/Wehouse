DROP FUNCTION IF EXISTS public.get_my_inspections(TEXT);
CREATE FUNCTION public.get_my_inspections(p_field_officer_id TEXT)
RETURNS TABLE(id UUID,inspection_code TEXT,property_address TEXT,property_city TEXT,property_state TEXT,property_type TEXT,status TEXT,owner_id TEXT,owner_name TEXT,owner_email TEXT,owner_phone TEXT,notes TEXT,field_officer_id TEXT,partner_id TEXT,scheduled_date TIMESTAMPTZ,completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ,photo_urls TEXT[],document_urls TEXT[],_source TEXT,gps_latitude NUMERIC,gps_longitude NUMERIC,location_accuracy_m NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.profiles;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR v_actor.role<>'staff' OR v_actor.user_id<>p_field_officer_id OR NOT public.current_staff_has_permission('field_officer') THEN RAISE EXCEPTION 'Field Officer access required'; END IF;
 RETURN QUERY
 SELECT ir.id,ir.request_code,ir.property_address,ir.property_city,ir.property_state,ir.property_type,ir.status,ir.owner_id,COALESCE(p.full_name,p.username,p.email),ir.owner_email,ir.owner_phone,ir.notes,COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to),ir.partner_id,ir.scheduled_date::timestamptz,ir.completed_at,ir.created_at,ir.photo_urls,ir.document_urls,'partner'::text,ir.gps_latitude,ir.gps_longitude,ir.location_accuracy_m FROM public.inspection_requests ir LEFT JOIN public.profiles p ON p.user_id=ir.owner_id WHERE COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)=v_actor.user_id
 UNION ALL
 SELECT ur.id,COALESCE(ur.reservation_id,ur.id::text),COALESCE(l.address,l.title,'Reserved property'),l.city,l.state,l.property_type,ur.status,ur.user_id,COALESCE(u.full_name,u.username,u.email),u.email,u.phone,ur.notes,ur.field_officer_id,NULL::text,ur.scheduled_date,NULL::timestamptz,ur.created_at,ur.photo_urls,ARRAY[]::text[],'user'::text,l.gps_latitude,l.gps_longitude,NULL::numeric FROM public.user_inspection_requests ur LEFT JOIN public.listings l ON l.listing_id=ur.listing_id OR l.id::text=ur.listing_id LEFT JOIN public.profiles u ON u.user_id=ur.user_id WHERE ur.field_officer_id=v_actor.user_id
 ORDER BY created_at DESC;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_my_inspections(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_inspections(TEXT) TO authenticated;