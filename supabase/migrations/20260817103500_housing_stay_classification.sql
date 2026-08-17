-- Structural apartment classification: preserve Short Stay / Long Stay from
-- Property Partner submission through inspection, preparation and publication.

ALTER TABLE public.inspection_requests
  ADD COLUMN IF NOT EXISTS sub_type text,
  ADD COLUMN IF NOT EXISTS security_deposit_amount numeric,
  ADD COLUMN IF NOT EXISTS amenities text[] DEFAULT ARRAY[]::text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='inspection_requests_sub_type_check'
  ) THEN
    ALTER TABLE public.inspection_requests
      ADD CONSTRAINT inspection_requests_sub_type_check
      CHECK (sub_type IS NULL OR sub_type IN ('short_let','long_stay'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='inspection_requests_security_deposit_check'
  ) THEN
    ALTER TABLE public.inspection_requests
      ADD CONSTRAINT inspection_requests_security_deposit_check
      CHECK (security_deposit_amount IS NULL OR security_deposit_amount >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_my_property_inspection_batch(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile record;
  v_batch_id uuid := gen_random_uuid();
  v_item jsonb;
  v_position integer;
  v_request_id uuid;
  v_request_code text;
  v_results jsonb := '[]'::jsonb;
  v_photo_urls text[];
  v_amenities text[];
  v_lat numeric;
  v_lng numeric;
  v_accuracy numeric;
  v_address text;
  v_city text;
  v_state text;
  v_type text;
  v_sub_type text;
  v_deposit numeric;
BEGIN
  SELECT user_id,email,phone,role,deleted,suspended,banned
  INTO v_profile
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
  LIMIT 1;

  IF v_profile IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF v_profile.role <> 'property_partner' THEN RAISE EXCEPTION 'Property Partner account required'; END IF;
  IF COALESCE(v_profile.deleted,false) OR COALESCE(v_profile.suspended,false) OR COALESCE(v_profile.banned,false) THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Property batch must be an array'; END IF;
  IF jsonb_array_length(p_items) < 1 THEN RAISE EXCEPTION 'Add at least one property'; END IF;
  IF jsonb_array_length(p_items) > 25 THEN RAISE EXCEPTION 'A batch can contain at most 25 properties'; END IF;

  FOR v_item, v_position IN
    SELECT value, ordinality::integer
    FROM jsonb_array_elements(p_items) WITH ORDINALITY
  LOOP
    v_address := NULLIF(BTRIM(v_item->>'property_address'),'');
    v_city := NULLIF(BTRIM(v_item->>'property_city'),'');
    v_state := NULLIF(BTRIM(v_item->>'property_state'),'');
    v_type := NULLIF(BTRIM(v_item->>'property_type'),'');
    v_sub_type := NULLIF(BTRIM(v_item->>'sub_type'),'');
    v_deposit := NULLIF(v_item->>'security_deposit_amount','')::numeric;

    IF v_address IS NULL THEN RAISE EXCEPTION 'Property %: address is required', v_position; END IF;
    IF v_city IS NULL THEN RAISE EXCEPTION 'Property %: city/LGA is required', v_position; END IF;
    IF v_state IS NULL THEN RAISE EXCEPTION 'Property %: state is required', v_position; END IF;
    IF v_type NOT IN ('apartment','hotel') THEN RAISE EXCEPTION 'Property %: choose Apartment or Hotel', v_position; END IF;

    -- Backward-compatible while the new frontend is rolling out: a legacy
    -- apartment request may enter the inspection queue without a subtype, but
    -- it cannot be prepared or published until Operations classifies it.
    IF v_type='apartment' AND v_sub_type IS NOT NULL AND v_sub_type NOT IN ('short_let','long_stay') THEN
      RAISE EXCEPTION 'Property %: invalid apartment stay type', v_position;
    END IF;
    IF v_type='hotel' THEN
      v_sub_type := NULL;
      v_deposit := NULL;
    ELSIF v_sub_type='short_let' AND COALESCE(v_deposit,0)<=0 THEN
      RAISE EXCEPTION 'Property %: Short Stay requires a refundable security deposit', v_position;
    ELSIF v_sub_type='long_stay' THEN
      v_deposit := NULL;
    END IF;

    v_lat := NULLIF(v_item->>'gps_latitude','')::numeric;
    v_lng := NULLIF(v_item->>'gps_longitude','')::numeric;
    v_accuracy := NULLIF(v_item->>'location_accuracy_m','')::numeric;
    IF (v_lat IS NULL) <> (v_lng IS NULL) THEN RAISE EXCEPTION 'Property %: latitude and longitude must be supplied together', v_position; END IF;
    IF v_lat IS NOT NULL AND (v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180) THEN
      RAISE EXCEPTION 'Property %: invalid coordinates', v_position;
    END IF;

    SELECT COALESCE(array_agg(value), ARRAY[]::text[])
    INTO v_photo_urls
    FROM jsonb_array_elements_text(COALESCE(v_item->'photo_urls','[]'::jsonb));

    SELECT COALESCE(array_agg(DISTINCT value), ARRAY[]::text[])
    INTO v_amenities
    FROM jsonb_array_elements_text(COALESCE(v_item->'amenities','[]'::jsonb));

    IF v_sub_type='short_let' AND NOT ('Furnished'=ANY(COALESCE(v_amenities,ARRAY[]::text[]))) THEN
      v_amenities := array_append(COALESCE(v_amenities,ARRAY[]::text[]),'Furnished');
    END IF;

    v_request_code := 'WHIR-' || upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10));

    INSERT INTO public.inspection_requests(
      request_code, owner_id, owner_email, owner_phone,
      property_address, property_city, property_state, property_type, sub_type,
      bedrooms, bathrooms, expected_rent, security_deposit_amount, amenities,
      description, photo_urls,
      gps_latitude, gps_longitude, location_accuracy_m,
      submission_batch_id, submission_batch_position,
      status, created_at, updated_at
    ) VALUES (
      v_request_code, v_profile.user_id, v_profile.email,
      COALESCE(NULLIF(BTRIM(v_item->>'owner_phone'),''),v_profile.phone),
      v_address, v_city, v_state, v_type, v_sub_type,
      NULLIF(v_item->>'bedrooms','')::integer,
      NULLIF(v_item->>'bathrooms','')::integer,
      NULLIF(v_item->>'expected_rent','')::numeric,
      v_deposit, v_amenities,
      NULLIF(BTRIM(v_item->>'description'),''),
      v_photo_urls,
      v_lat, v_lng,
      CASE WHEN v_accuracy IS NULL OR v_accuracy < 0 THEN NULL ELSE v_accuracy END,
      v_batch_id, v_position,
      'pending', now(), now()
    ) RETURNING id INTO v_request_id;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', v_request_id,
      'request_code', v_request_code,
      'position', v_position
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'count', jsonb_array_length(v_results),
    'requests', v_results
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_property_inspection_stay_type(
  p_inspection_id uuid,
  p_sub_type text,
  p_security_deposit_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_ir public.inspection_requests;
  v_amenities text[];
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN
    RAISE EXCEPTION 'Operations permission required';
  END IF;
  IF p_sub_type NOT IN ('short_let','long_stay') THEN RAISE EXCEPTION 'Choose Short Stay or Long Stay'; END IF;

  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=p_inspection_id FOR UPDATE;
  IF v_ir IS NULL THEN RAISE EXCEPTION 'Property request not found'; END IF;
  IF v_ir.property_type<>'apartment' THEN RAISE EXCEPTION 'Stay type applies to apartments only'; END IF;
  IF v_ir.published_at IS NOT NULL THEN RAISE EXCEPTION 'Published property classification cannot be changed here'; END IF;
  IF v_actor.role<>'creator' AND NOT public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) THEN
    RAISE EXCEPTION 'Property is outside your assigned State/LGA';
  END IF;
  IF p_sub_type='short_let' AND COALESCE(p_security_deposit_amount,0)<=0 THEN
    RAISE EXCEPTION 'Short Stay requires a refundable security deposit';
  END IF;

  v_amenities := COALESCE(v_ir.amenities,ARRAY[]::text[]);
  IF p_sub_type='short_let' AND NOT ('Furnished'=ANY(v_amenities)) THEN
    v_amenities := array_append(v_amenities,'Furnished');
  END IF;

  UPDATE public.inspection_requests
  SET sub_type=p_sub_type,
      security_deposit_amount=CASE WHEN p_sub_type='short_let' THEN p_security_deposit_amount ELSE NULL END,
      amenities=v_amenities,
      updated_at=now()
  WHERE id=p_inspection_id;

  RETURN jsonb_build_object(
    'success',true,
    'sub_type',p_sub_type,
    'security_deposit_amount',CASE WHEN p_sub_type='short_let' THEN p_security_deposit_amount ELSE NULL END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_property_pipeline(p_stage text DEFAULT 'all'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_actor public.profiles; v_result JSONB;
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator','staff') THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
 IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;
 IF v_actor.role IN ('admin','staff') AND (v_actor.assigned_state IS NULL OR v_actor.assigned_lga IS NULL) THEN RAISE EXCEPTION 'Branch assignment required'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',ir.id,'request_code',ir.request_code,'owner_id',ir.owner_id,
   'owner_name',COALESCE(owner.full_name,owner.username,owner.email),'owner_email',ir.owner_email,'owner_phone',ir.owner_phone,
   'property_address',ir.property_address,'property_city',ir.property_city,'property_state',ir.property_state,
   'property_type',ir.property_type,'sub_type',ir.sub_type,'bedrooms',ir.bedrooms,'bathrooms',ir.bathrooms,
   'expected_rent',ir.expected_rent,'security_deposit_amount',ir.security_deposit_amount,'amenities',ir.amenities,
   'description',ir.description,'status',ir.status,'scheduled_date',ir.scheduled_date,
   'assigned_field_officer_id',COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to),
   'field_officer_name',COALESCE(officer.full_name,officer.username,officer.email),'notes',ir.notes,
   'photo_urls',ir.photo_urls,'document_urls',ir.document_urls,'gps_latitude',ir.gps_latitude,'gps_longitude',ir.gps_longitude,
   'draft_listing_id',ir.draft_listing_id,'draft_hotel_id',ir.draft_hotel_id,'approved_by',ir.approved_by,'approved_at',ir.approved_at,'published_at',ir.published_at,
   'listing',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object(
     'id',l.id,'listing_id',l.listing_id,'title',l.title,'price',l.price,'status',l.status,'availability_status',l.availability_status,
     'sub_type',l.sub_type,'security_deposit_amount',l.security_deposit_amount,'amenities',l.amenities,'images',l.images,'created_at',l.created_at
   ) END,
   'hotel',CASE WHEN h.hotel_id IS NULL THEN NULL ELSE jsonb_build_object('hotel_id',h.hotel_id,'name',h.name,'status',h.status,'images',h.images,'created_at',h.created_at) END,
   'created_at',ir.created_at
 ) ORDER BY ir.created_at DESC),'[]'::jsonb) INTO v_result
 FROM public.inspection_requests ir
 LEFT JOIN public.profiles owner ON owner.user_id=ir.owner_id
 LEFT JOIN public.profiles officer ON officer.user_id=COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)
 LEFT JOIN public.listings l ON l.id=ir.draft_listing_id AND l.deleted_at IS NULL
 LEFT JOIN public.hotels h ON h.hotel_id=ir.draft_hotel_id
 WHERE (v_actor.role='creator' OR (ir.property_state=v_actor.assigned_state AND ir.property_city=v_actor.assigned_lga))
   AND (p_stage='all'
     OR (p_stage='new' AND ir.status='pending' AND COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to) IS NULL)
     OR (p_stage='inspection' AND ir.status IN ('pending','scheduled','in_progress') AND COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to) IS NOT NULL)
     OR (p_stage='ready' AND ir.status IN ('completed','approved') AND ir.draft_listing_id IS NULL AND ir.draft_hotel_id IS NULL)
     OR (p_stage='preparing' AND (ir.draft_listing_id IS NOT NULL OR ir.draft_hotel_id IS NOT NULL) AND ir.published_at IS NULL)
     OR (p_stage='published' AND ir.published_at IS NOT NULL)
     OR (p_stage='rejected' AND ir.status='rejected'));
 RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.post_property_from_inspection(p_data jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller public.profiles;
  v_ir public.inspection_requests;
  v_partner public.profiles;
  v_listing_id uuid;
  v_code text;
  v_images text[];
  v_videos text[];
  v_amenities text[];
  v_sub_type text;
  v_deposit numeric;
BEGIN
  SELECT * INTO v_caller FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_caller IS NULL OR v_caller.role NOT IN ('staff','admin','creator') THEN RAISE EXCEPTION 'WeHouse operations access required'; END IF;
  IF v_caller.role='staff' AND NOT public.current_staff_has_permission('operations') THEN RAISE EXCEPTION 'Operations permission required'; END IF;

  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=(p_data->>'inspection_id')::uuid FOR UPDATE;
  IF v_ir IS NULL OR v_ir.status NOT IN ('completed','approved') THEN RAISE EXCEPTION 'Inspection must be completed before listing preparation'; END IF;
  IF v_caller.role IN ('admin','staff') AND (v_ir.property_state IS DISTINCT FROM v_caller.assigned_state OR v_ir.property_city IS DISTINCT FROM v_caller.assigned_lga) THEN RAISE EXCEPTION 'Property is outside your assigned branch'; END IF;
  IF v_ir.draft_listing_id IS NOT NULL THEN RAISE EXCEPTION 'A listing has already been prepared from this inspection'; END IF;
  IF v_ir.property_type='hotel' THEN RAISE EXCEPTION 'Hotels use the hotel preparation workflow'; END IF;

  SELECT * INTO v_partner FROM public.profiles WHERE user_id=v_ir.owner_id AND role='property_partner';
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Valid Property Partner owner required'; END IF;
  IF NULLIF(BTRIM(p_data->>'title'),'') IS NULL OR COALESCE((p_data->>'price')::numeric,0)<=0 THEN RAISE EXCEPTION 'Listing title and valid price are required'; END IF;

  v_sub_type := COALESCE(NULLIF(BTRIM(p_data->>'sub_type'),''),v_ir.sub_type);
  IF v_sub_type NOT IN ('short_let','long_stay') THEN RAISE EXCEPTION 'Choose Short Stay or Long Stay before preparing this apartment'; END IF;
  v_deposit := COALESCE(NULLIF(p_data->>'security_deposit_amount','')::numeric,v_ir.security_deposit_amount);
  IF v_sub_type='short_let' AND COALESCE(v_deposit,0)<=0 THEN RAISE EXCEPTION 'Short Stay requires a refundable security deposit'; END IF;
  IF v_sub_type='long_stay' THEN v_deposit:=NULL; END IF;

  SELECT COALESCE(array_agg(value),ARRAY[]::text[]) INTO v_images
  FROM jsonb_array_elements_text(COALESCE(p_data->'images','[]'::jsonb));
  SELECT COALESCE(array_agg(value),ARRAY[]::text[]) INTO v_videos
  FROM jsonb_array_elements_text(COALESCE(p_data->'videos','[]'::jsonb));
  SELECT COALESCE(array_agg(DISTINCT value),ARRAY[]::text[]) INTO v_amenities
  FROM jsonb_array_elements_text(COALESCE(p_data->'amenities',to_jsonb(COALESCE(v_ir.amenities,ARRAY[]::text[]))));
  IF v_sub_type='short_let' AND NOT ('Furnished'=ANY(COALESCE(v_amenities,ARRAY[]::text[]))) THEN
    v_amenities:=array_append(COALESCE(v_amenities,ARRAY[]::text[]),'Furnished');
  END IF;

  v_code := 'WHL-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text,'-','') FROM 1 FOR 12));
  INSERT INTO public.listings(
    listing_id,title,description,price,currency,state,city,address,images,videos,bedrooms,bathrooms,
    property_type,sub_type,security_deposit_amount,amenities,
    availability_status,owner_id,partner_id,chat_agent_id,status,submitted_by_role,reservation_fee_paid,chat_unlocked,
    gps_latitude,gps_longitude,inspection_request_id,created_at,updated_at
  ) VALUES(
    v_code,BTRIM(p_data->>'title'),NULLIF(BTRIM(p_data->>'description'),''),(p_data->>'price')::numeric,'NGN',
    v_ir.property_state,v_ir.property_city,v_ir.property_address,v_images,v_videos,
    COALESCE((p_data->>'bedrooms')::int,v_ir.bedrooms,1),COALESCE((p_data->>'bathrooms')::int,v_ir.bathrooms,1),
    COALESCE(NULLIF(BTRIM(p_data->>'property_type'),''),v_ir.property_type,'apartment'),v_sub_type,v_deposit,v_amenities,
    'pending_approval',v_partner.user_id,v_partner.user_id,v_caller.user_id,'pending_approval','property_partner',false,false,
    v_ir.gps_latitude,v_ir.gps_longitude,v_ir.id,NOW(),NOW()
  ) RETURNING id INTO v_listing_id;

  UPDATE public.inspection_requests
  SET draft_listing_id=v_listing_id,sub_type=v_sub_type,security_deposit_amount=v_deposit,amenities=v_amenities,updated_at=NOW()
  WHERE id=v_ir.id;
  RETURN v_listing_id;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_publish_inspected_listing(p_listing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_actor public.profiles; v_listing public.listings; v_ir public.inspection_requests;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL OR v_listing.inspection_request_id IS NULL THEN RAISE EXCEPTION 'Inspection-linked listing required'; END IF;
  SELECT * INTO v_ir FROM public.inspection_requests WHERE id=v_listing.inspection_request_id FOR UPDATE;
  IF v_ir.status NOT IN ('completed','approved') THEN RAISE EXCEPTION 'Inspection is not complete'; END IF;
  IF v_actor.role='admin' AND (v_ir.property_state IS DISTINCT FROM v_actor.assigned_state OR v_ir.property_city IS DISTINCT FROM v_actor.assigned_lga) THEN RAISE EXCEPTION 'Property is outside your assigned branch'; END IF;
  IF NULLIF(BTRIM(v_listing.title),'') IS NULL OR COALESCE(v_listing.price,0)<=0 OR COALESCE(array_length(v_listing.images,1),0)<1 THEN
    RAISE EXCEPTION 'Title, valid price and at least one image are required before publication';
  END IF;
  IF COALESCE(v_listing.property_type,'apartment')='apartment' THEN
    IF v_listing.sub_type NOT IN ('short_let','long_stay') THEN RAISE EXCEPTION 'Apartment must be classified as Short Stay or Long Stay before publication'; END IF;
    IF v_listing.sub_type='short_let' AND COALESCE(v_listing.security_deposit_amount,0)<=0 THEN RAISE EXCEPTION 'Short Stay requires a refundable security deposit'; END IF;
    IF v_listing.sub_type='short_let' AND NOT ('Furnished'=ANY(COALESCE(v_listing.amenities,ARRAY[]::text[]))) THEN RAISE EXCEPTION 'Short Stay apartment must be furnished'; END IF;
  END IF;

  UPDATE public.listings
  SET status='available',availability_status='available',approved_by=v_actor.user_id,approved_at=NOW(),rejection_reason=NULL,updated_at=NOW()
  WHERE id=p_listing_id;
  UPDATE public.inspection_requests
  SET status='approved',approved_by=v_actor.user_id,approved_at=NOW(),published_at=NOW(),updated_at=NOW()
  WHERE id=v_ir.id;
END $function$;

GRANT EXECUTE ON FUNCTION public.create_my_property_inspection_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_property_inspection_stay_type(uuid,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_property_pipeline(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_property_from_inspection(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_inspected_listing(uuid) TO authenticated;
