-- Live migration applied to WeHouse on 2026-08-11.
-- Purpose: preserve LGA authority while adding property GPS and distance-ranked Field Officer assignment.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS operational_latitude NUMERIC;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS operational_longitude NUMERIC;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS operational_location_accuracy_m NUMERIC;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS operational_location_updated_at TIMESTAMPTZ;

-- The live database now contains these hardened RPCs:
-- public.update_my_field_officer_location(numeric,numeric,numeric)
-- public.create_my_property_inspection_request_v2(...,numeric,numeric,numeric)
-- public.get_inspection_field_officer_candidates(uuid)
-- public.assign_partner_inspection(uuid,text,date)
-- public.get_property_pipeline_requests()
-- public.get_my_assigned_inspection_location(uuid)
--
-- Security/behaviour contract:
-- 1. Admin can only access property requests whose property_state/property_city match assigned_state/assigned_lga.
-- 2. Field Officer candidates must be active Staff with active field_officer permission in the SAME State/LGA as the property.
-- 3. Coordinates never widen branch authority; they only rank eligible officers by distance.
-- 4. Candidate ordering is distance (when available), then active inspection workload.
-- 5. Property requests accept GPS latitude/longitude plus accuracy and retain the partner owner_id.
-- 6. Field Officer operational coordinates are self-updated only by an active Staff account with field_officer permission.
-- 7. All RPCs are revoked from anon/PUBLIC and executable only by authenticated where appropriate.
--
-- The complete function bodies are tracked in the Supabase migration history entry:
-- property_geolocation_and_field_officer_ranking_v2
-- plus property_pipeline_workspace_rpc.
