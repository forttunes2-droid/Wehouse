BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $function$
DECLARE
  v_actor public.profiles;
BEGIN
  v_actor:=public._admin_dashboard_actor();

  RETURN QUERY
  SELECT (jsonb_populate_record(
    NULL::public.profiles,
    to_jsonb(p)-ARRAY[
      'auth_id',
      'creator_auth_password',
      'creator_auth_enabled',
      'worker_gov_id_url',
      'maintenance_exempt',
      'created_by',
      'updated_by'
    ]::text[]
  )).*
  FROM public.profiles p
  WHERE p.deleted_at IS NULL
    AND p.role<>'creator'
    AND (
      v_actor.role='creator'
      OR CASE WHEN p.role IN ('admin','staff')
        THEN p.assigned_state=v_actor.assigned_state AND p.assigned_lga=v_actor.assigned_lga
        ELSE p.state=v_actor.assigned_state
          AND COALESCE(NULLIF(p.local_government,''),NULLIF(p.city,''))=v_actor.assigned_lga
      END
    )
  ORDER BY p.created_at DESC;
END;
$function$;

COMMIT;
