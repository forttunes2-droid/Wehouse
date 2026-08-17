BEGIN;

-- Secure the Field Officer queue while preserving the existing RPC signature used by the app.
CREATE OR REPLACE FUNCTION public.get_my_inspections(p_field_officer_id text)
RETURNS TABLE(
  id uuid,
  inspection_code text,
  property_address text,
  property_city text,
  property_state text,
  property_type text,
  status text,
  owner_id text,
  owner_name text,
  owner_email text,
  owner_phone text,
  notes text,
  field_officer_id text,
  partner_id text,
  scheduled_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  photo_urls text[],
  document_urls text[],
  _source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_actor record;
  v_target_officer text;
BEGIN
  SELECT user_id, role, deleted, suspended, banned
  INTO v_actor
  FROM public.profiles
  WHERE auth_id = auth.uid()::text
  LIMIT 1;

  IF v_actor IS NULL
     OR COALESCE(v_actor.deleted,false)
     OR COALESCE(v_actor.suspended,false)
     OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Active WeHouse account required';
  END IF;

  IF v_actor.role = 'staff' THEN
    IF NOT public.current_staff_has_permission('field_officer') THEN
      RAISE EXCEPTION 'Field Officer permission required';
    END IF;
    IF p_field_officer_id IS DISTINCT FROM v_actor.user_id THEN
      RAISE EXCEPTION 'Field Officers can only view their own assignments';
    END IF;
    v_target_officer := v_actor.user_id;
  ELSIF v_actor.role IN ('admin','creator') THEN
    v_target_officer := COALESCE(NULLIF(BTRIM(p_field_officer_id),''), v_actor.user_id);
  ELSE
    RAISE EXCEPTION 'Field Officer access required';
  END IF;

  RETURN QUERY
  SELECT
    ir.id,
    ir.request_code,
    ir.property_address,
    ir.property_city,
    ir.property_state,
    ir.property_type,
    ir.status,
    ir.owner_id,
    COALESCE(p.full_name,p.username,p.email),
    ir.owner_email,
    ir.owner_phone,
    ir.notes,
    COALESCE(ir.field_officer_id,ir.assigned_to,ir.assigned_field_officer_id),
    ir.partner_id::text,
    ir.scheduled_date::timestamptz,
    COALESCE(ir.inspection_completed_at,ir.completed_at),
    ir.created_at,
    ir.photo_urls,
    ir.document_urls,
    'partner'::text
  FROM public.inspection_requests ir
  LEFT JOIN public.profiles p ON p.user_id=ir.owner_id
  WHERE v_target_officer IN (ir.field_officer_id,ir.assigned_to,ir.assigned_field_officer_id)

  UNION ALL

  SELECT
    uir.id,
    uir.reservation_id,
    COALESCE(l.address,l.title,'Property inspection'),
    l.city,
    l.state,
    l.property_type,
    uir.status,
    uir.user_id,
    COALESCE(up.full_name,up.username,up.email),
    up.email,
    up.phone,
    uir.notes,
    uir.field_officer_id,
    NULL::text,
    uir.scheduled_date,
    uir.completed_at,
    uir.created_at,
    uir.photo_urls,
    NULL::text[],
    'user'::text
  FROM public.user_inspection_requests uir
  LEFT JOIN public.listings l
    ON l.id::text=uir.listing_id OR l.listing_id=uir.listing_id
  LEFT JOIN public.profiles up ON up.user_id=uir.user_id
  WHERE uir.field_officer_id=v_target_officer

  ORDER BY created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_inspections(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_inspections(text) TO authenticated;

-- Align the update RPC with all historical partner-assignment columns used by the live schema.
CREATE OR REPLACE FUNCTION public.update_inspection_status(
  p_inspection_id uuid,
  p_new_status text,
  p_source text DEFAULT 'user',
  p_report text DEFAULT NULL,
  p_condition text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_actor record;
  v_updated boolean := false;
BEGIN
  SELECT user_id,role,deleted,suspended,banned
  INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
  LIMIT 1;

  IF v_actor IS NULL OR COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Active WeHouse account required';
  END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('field_officer') THEN
    RAISE EXCEPTION 'Field Officer permission required';
  END IF;
  IF v_actor.role NOT IN ('staff','admin','creator') THEN
    RAISE EXCEPTION 'Field Officer access required';
  END IF;
  IF p_source NOT IN ('user','partner') THEN
    RAISE EXCEPTION 'Invalid inspection source';
  END IF;
  IF p_new_status NOT IN ('in_progress','completed') THEN
    RAISE EXCEPTION 'Field Officer can only start or complete an inspection';
  END IF;
  IF p_new_status='completed' AND NULLIF(BTRIM(COALESCE(p_report,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Inspection report is required before completion';
  END IF;

  IF p_source='partner' THEN
    UPDATE public.inspection_requests
    SET status=p_new_status,
        inspection_started_at=CASE WHEN p_new_status='in_progress' THEN COALESCE(inspection_started_at,now()) ELSE inspection_started_at END,
        inspection_completed_at=CASE WHEN p_new_status='completed' THEN now() ELSE inspection_completed_at END,
        completed_at=CASE WHEN p_new_status='completed' THEN now() ELSE completed_at END,
        notes=CASE WHEN p_new_status='completed' THEN BTRIM(p_report) ELSE notes END,
        updated_at=now()
    WHERE id=p_inspection_id
      AND (
        v_actor.role IN ('admin','creator')
        OR v_actor.user_id IN (field_officer_id,assigned_to,assigned_field_officer_id)
      );
    v_updated:=FOUND;
  ELSE
    UPDATE public.user_inspection_requests
    SET status=p_new_status,
        completed_at=CASE WHEN p_new_status='completed' THEN now() ELSE completed_at END,
        report=CASE WHEN p_new_status='completed' THEN BTRIM(p_report) ELSE report END,
        condition=CASE WHEN p_new_status='completed' THEN NULLIF(BTRIM(COALESCE(p_condition,'')),'') ELSE condition END,
        updated_at=now()
    WHERE id=p_inspection_id
      AND (v_actor.role IN ('admin','creator') OR field_officer_id=v_actor.user_id);
    v_updated:=FOUND;
  END IF;

  IF NOT v_updated THEN
    RAISE EXCEPTION 'Inspection not found or not assigned to this account';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_inspection_status(uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_inspection_status(uuid,text,text,text,text) TO authenticated;

COMMIT;
