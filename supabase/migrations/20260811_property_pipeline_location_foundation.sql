-- Canonical property pipeline + location foundation
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS inspection_request_id UUID REFERENCES public.inspection_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gps_latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_longitude NUMERIC,
  ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC;
ALTER TABLE public.inspection_requests ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC;
CREATE UNIQUE INDEX IF NOT EXISTS listings_inspection_request_unique ON public.listings(inspection_request_id) WHERE inspection_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inspection_requests_branch_idx ON public.inspection_requests(lower(property_state),lower(property_city),status);
CREATE INDEX IF NOT EXISTS profiles_field_officer_branch_idx ON public.profiles(lower(assigned_state),lower(assigned_lga)) WHERE role='staff' AND deleted IS NOT TRUE AND suspended IS NOT TRUE AND banned IS NOT TRUE;

REVOKE EXECUTE ON FUNCTION public.admin_get_partner_inspections() FROM anon;
REVOKE EXECUTE ON FUNCTION public.transition_inspection_status(uuid,text,text,text,text) FROM anon;

CREATE OR REPLACE FUNCTION public.get_inspection_field_officer_candidates(p_inspection_id uuid)
RETURNS TABLE(user_id text,full_name text,username text,assigned_state text,assigned_lga text,active_inspections bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor record; v_req record;
BEGIN
 SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') OR coalesce(v_actor.deleted,false) OR coalesce(v_actor.suspended,false) OR coalesce(v_actor.banned,false) THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
 SELECT id,property_state,property_city INTO v_req FROM public.inspection_requests WHERE id=p_inspection_id;
 IF v_req IS NULL THEN RAISE EXCEPTION 'Inspection request not found'; END IF;
 IF v_actor.role='admin' AND (lower(coalesce(v_actor.assigned_state,''))<>lower(coalesce(v_req.property_state,'')) OR lower(coalesce(v_actor.assigned_lga,''))<>lower(coalesce(v_req.property_city,''))) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
 RETURN QUERY SELECT p.user_id,p.full_name,p.username,p.assigned_state,p.assigned_lga,
   (SELECT count(*) FROM public.inspection_requests ir WHERE coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)=p.user_id AND ir.status IN ('scheduled','in_progress'))
 FROM public.profiles p
 WHERE p.role='staff' AND coalesce(p.deleted,false)=false AND coalesce(p.suspended,false)=false AND coalesce(p.banned,false)=false
 AND lower(coalesce(p.assigned_state,''))=lower(coalesce(v_req.property_state,'')) AND lower(coalesce(p.assigned_lga,''))=lower(coalesce(v_req.property_city,''))
 AND EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.permission='field_officer')
 ORDER BY active_inspections ASC,coalesce(p.full_name,p.username,p.user_id);
END $$;
REVOKE ALL ON FUNCTION public.get_inspection_field_officer_candidates(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_inspection_field_officer_candidates(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_partner_inspection(p_inspection_id uuid,p_field_officer_id text,p_scheduled_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor record; v_req record; v_officer record;
BEGIN
 SELECT user_id,role,assigned_state,assigned_lga,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
 IF v_actor IS NULL OR v_actor.role NOT IN ('admin','creator') OR coalesce(v_actor.deleted,false) OR coalesce(v_actor.suspended,false) OR coalesce(v_actor.banned,false) THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;
 SELECT * INTO v_req FROM public.inspection_requests WHERE id=p_inspection_id FOR UPDATE;
 IF v_req IS NULL THEN RAISE EXCEPTION 'Inspection request not found'; END IF;
 IF v_req.status NOT IN ('pending','scheduled') THEN RAISE EXCEPTION 'Inspection cannot be assigned at this stage'; END IF;
 IF v_actor.role='admin' AND (lower(coalesce(v_actor.assigned_state,''))<>lower(coalesce(v_req.property_state,'')) OR lower(coalesce(v_actor.assigned_lga,''))<>lower(coalesce(v_req.property_city,''))) THEN RAISE EXCEPTION 'Inspection is outside your assigned branch'; END IF;
 SELECT user_id,assigned_state,assigned_lga INTO v_officer FROM public.profiles p WHERE p.user_id=p_field_officer_id AND p.role='staff' AND coalesce(p.deleted,false)=false AND coalesce(p.suspended,false)=false AND coalesce(p.banned,false)=false AND EXISTS(SELECT 1 FROM public.staff_permissions sp WHERE sp.staff_id=p.user_id AND sp.permission='field_officer');
 IF v_officer IS NULL THEN RAISE EXCEPTION 'Eligible Field Officer not found'; END IF;
 IF lower(coalesce(v_officer.assigned_state,''))<>lower(coalesce(v_req.property_state,'')) OR lower(coalesce(v_officer.assigned_lga,''))<>lower(coalesce(v_req.property_city,'')) THEN RAISE EXCEPTION 'Field Officer must belong to the property branch'; END IF;
 UPDATE public.inspection_requests SET assigned_to=p_field_officer_id,field_officer_id=p_field_officer_id,assigned_field_officer_id=p_field_officer_id,assigned_at=now(),scheduled_date=p_scheduled_date,status='scheduled',updated_at=now() WHERE id=p_inspection_id;
END $$;
REVOKE ALL ON FUNCTION public.assign_partner_inspection(uuid,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_partner_inspection(uuid,text,date) TO authenticated;
