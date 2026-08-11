BEGIN;

-- Harden the existing Field Officer inspection transition RPC without changing its signature.
-- Staff may update only inspections assigned to their own profile and only through
-- the operational in_progress -> completed lifecycle. Admin/Creator retain recovery access.
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

  IF v_actor.role = 'staff' AND NOT public.current_staff_has_permission('field_officer') THEN
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

  IF p_new_status = 'completed' AND NULLIF(BTRIM(COALESCE(p_report,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Inspection report is required before completion';
  END IF;

  IF p_source = 'partner' THEN
    UPDATE public.inspection_requests
    SET status = p_new_status,
        completed_at = CASE WHEN p_new_status='completed' THEN now() ELSE completed_at END,
        notes = CASE WHEN p_new_status='completed' THEN BTRIM(p_report) ELSE notes END,
        updated_at = now()
    WHERE id = p_inspection_id
      AND (
        v_actor.role IN ('admin','creator')
        OR assigned_to = v_actor.user_id
      );
    v_updated := FOUND;
  ELSE
    UPDATE public.user_inspection_requests
    SET status = p_new_status,
        completed_at = CASE WHEN p_new_status='completed' THEN now() ELSE completed_at END,
        report = CASE WHEN p_new_status='completed' THEN BTRIM(p_report) ELSE report END,
        condition = CASE WHEN p_new_status='completed' THEN NULLIF(BTRIM(COALESCE(p_condition,'')),'') ELSE condition END,
        updated_at = now()
    WHERE id = p_inspection_id
      AND (
        v_actor.role IN ('admin','creator')
        OR field_officer_id = v_actor.user_id
      );
    v_updated := FOUND;
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
