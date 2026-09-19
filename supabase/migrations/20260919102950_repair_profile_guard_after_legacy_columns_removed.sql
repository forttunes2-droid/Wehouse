-- Retired Creator password columns are absent from the canonical schema.
-- Keep the existing invoker security guard and all live privileged-field checks.
-- Referencing the removed fields made every owner update fail at runtime.
CREATE OR REPLACE FUNCTION public.protect_privileged_profile_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('anon','authenticated') AND OLD.auth_id = auth.uid()::text THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.auth_id IS DISTINCT FROM OLD.auth_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.email_verified IS DISTINCT FROM OLD.email_verified
      OR NEW.phone_verified IS DISTINCT FROM OLD.phone_verified
      OR NEW.id_verified IS DISTINCT FROM OLD.id_verified
      OR NEW.assigned_state IS DISTINCT FROM OLD.assigned_state
      OR NEW.assigned_lga IS DISTINCT FROM OLD.assigned_lga
      OR NEW.scope IS DISTINCT FROM OLD.scope
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.updated_by IS DISTINCT FROM OLD.updated_by
      OR NEW.maintenance_exempt IS DISTINCT FROM OLD.maintenance_exempt
      OR NEW.is_premium IS DISTINCT FROM OLD.is_premium
      OR NEW.premium_expires_at IS DISTINCT FROM OLD.premium_expires_at
      OR NEW.worker_verified IS DISTINCT FROM OLD.worker_verified
      OR NEW.worker_status IS DISTINCT FROM OLD.worker_status
      OR NEW.deleted IS DISTINCT FROM OLD.deleted
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.suspended IS DISTINCT FROM OLD.suspended
      OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
      OR NEW.suspended_by IS DISTINCT FROM OLD.suspended_by
      OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason
      OR NEW.banned IS DISTINCT FROM OLD.banned
      OR NEW.banned_at IS DISTINCT FROM OLD.banned_at
      OR NEW.banned_by IS DISTINCT FROM OLD.banned_by
      OR NEW.banned_reason IS DISTINCT FROM OLD.banned_reason
      OR NEW.rating IS DISTINCT FROM OLD.rating
      OR NEW.review_count IS DISTINCT FROM OLD.review_count
      OR NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at
      OR NEW.privacy_accepted_at IS DISTINCT FROM OLD.privacy_accepted_at
      OR NEW.legal_accepted_version IS DISTINCT FROM OLD.legal_accepted_version
    THEN
      RAISE EXCEPTION 'This field cannot be changed from Profile.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
