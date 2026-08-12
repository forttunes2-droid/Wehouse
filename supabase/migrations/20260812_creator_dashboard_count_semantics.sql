-- Creator/Admin dashboard count semantics
-- Published apartment inventory is listings.status = 'available'.
-- Creator Team includes Admin + Staff; branch Admin Staff remains Staff-only.
-- Worker review work includes verification_paid and profile_under_review.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_my_branch_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_actor public.profiles;
BEGIN
  v_actor := public._admin_dashboard_actor();
  RETURN jsonb_build_object(
    'users',(SELECT count(*) FROM public.profiles p WHERE p.role='user' AND p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))),
    'workers',(SELECT count(*) FROM public.profiles p WHERE p.role='worker' AND p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))),
    'partners',(SELECT count(*) FROM public.profiles p WHERE p.role='property_partner' AND p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga))),
    'staff',(SELECT count(*) FROM public.profiles p WHERE p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND ((v_actor.role='creator' AND p.role IN ('admin','staff')) OR (v_actor.role<>'creator' AND p.role='staff' AND p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga))),
    'admins',(SELECT count(*) FROM public.profiles p WHERE p.role='admin' AND p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga))),
    'listings',(SELECT count(*) FROM public.listings l WHERE l.deleted_at IS NULL AND l.status='available' AND (v_actor.role='creator' OR (l.state=v_actor.assigned_state AND l.city=v_actor.assigned_lga))),
    'pending_verifications',(SELECT count(*) FROM public.profiles p WHERE p.role='worker' AND p.worker_status IN ('verification_paid','profile_under_review') AND p.deleted_at IS NULL AND COALESCE(p.deleted,false)=false AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga)))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_my_branch_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_my_branch_stats() TO authenticated;

COMMIT;
