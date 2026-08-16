-- Retired Worker government-ID settings remain server history only.
-- Neutralize their stored values and keep inactive/deleted settings out of the
-- Creator-facing operational Change History projection.

BEGIN;

UPDATE public.platform_settings
SET value=CASE key
  WHEN 'worker_id_verification_required' THEN 'false'
  WHEN 'worker_required_documents' THEN ''
  ELSE value
END,
    editable=false,
    is_active=false,
    description='Retired. WeHouse does not collect government identity documents for Worker verification.',
    updated_at=now()
WHERE key IN ('worker_id_verification_required','worker_required_documents');

CREATE OR REPLACE FUNCTION public.creator_get_change_history(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 150
)
RETURNS TABLE(
  event_id text,
  actor_name text,
  actor_role text,
  action_label text,
  area_label text,
  subject_label text,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_limit integer:=least(greatest(coalesce(p_limit,150),1),250);
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role='creator'
    AND coalesce(deleted,false)=false
    AND coalesce(suspended,false)=false
    AND coalesce(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Creator access required'; END IF;

  RETURN QUERY
  WITH projected AS (
    SELECT
      md5(coalesce(a.id,'')||':'||a.created_at::text) AS event_id,
      coalesce(actor.full_name,actor.username,CASE WHEN a.admin_id IS NULL THEN 'WeHouse System' ELSE 'WeHouse team' END) AS actor_name,
      coalesce(actor.role,'system')::text AS actor_role,
      CASE upper(coalesce(a.action,''))
        WHEN 'INSERT' THEN 'Created'
        WHEN 'UPDATE' THEN 'Updated'
        WHEN 'DELETE' THEN 'Removed'
        WHEN 'REASSIGN' THEN 'Reassigned'
        WHEN 'APPROVE' THEN 'Approved'
        WHEN 'REJECT' THEN 'Rejected'
        WHEN 'SUSPEND' THEN 'Suspended'
        WHEN 'RESTORE' THEN 'Restored'
        ELSE initcap(replace(lower(coalesce(a.action,'changed')),'_',' '))
      END::text AS action_label,
      CASE lower(coalesce(a.target_type,''))
        WHEN 'platform_settings' THEN 'Settings'
        WHEN 'profiles' THEN 'Team & accounts'
        WHEN 'worker_bookings' THEN 'Worker bookings'
        WHEN 'worker_verifications' THEN 'Workers'
        WHEN 'listings' THEN 'Properties'
        WHEN 'inspection_requests' THEN 'Properties'
        WHEN 'listing_reports' THEN 'Moderation'
        WHEN 'withdrawals' THEN 'Finance'
        WHEN 'wallets' THEN 'Finance'
        ELSE 'Platform'
      END::text AS area_label,
      CASE lower(coalesce(a.target_type,''))
        WHEN 'platform_settings' THEN ps.label
        WHEN 'profiles' THEN coalesce(target_profile.full_name,target_profile.username,'WeHouse account')
        WHEN 'worker_bookings' THEN 'Worker service booking'
        WHEN 'worker_verifications' THEN 'Worker review'
        WHEN 'listings' THEN 'Property listing'
        WHEN 'inspection_requests' THEN 'Property inspection'
        WHEN 'listing_reports' THEN 'Listing report'
        WHEN 'withdrawals' THEN 'Payout request'
        ELSE initcap(replace(coalesce(nullif(a.target_type,''),'platform'),'_',' '))
      END::text AS subject_label,
      a.created_at AS occurred_at
    FROM public.audit_logs a
    LEFT JOIN LATERAL (
      SELECT p.full_name,p.username,p.role
      FROM public.profiles p
      WHERE p.user_id=a.admin_id
         OR p.auth_id=a.admin_id
         OR (a.admin_email IS NOT NULL AND lower(p.email)=lower(a.admin_email))
      ORDER BY CASE WHEN p.user_id=a.admin_id THEN 0 WHEN p.auth_id=a.admin_id THEN 1 ELSE 2 END
      LIMIT 1
    ) actor ON true
    LEFT JOIN public.platform_settings ps
      ON a.target_type='platform_settings'
     AND ps.key=a.target_id
     AND coalesce(ps.is_active,false)=true
    LEFT JOIN public.profiles target_profile
      ON a.target_type='profiles' AND target_profile.user_id=a.target_id
    WHERE a.target_type<>'platform_settings' OR ps.key IS NOT NULL
  )
  SELECT p.event_id,p.actor_name,p.actor_role,p.action_label,p.area_label,p.subject_label,p.occurred_at
  FROM projected p
  WHERE nullif(trim(coalesce(p_search,'')),'') IS NULL
     OR lower(concat_ws(' ',p.actor_name,p.actor_role,p.action_label,p.area_label,p.subject_label)) LIKE '%'||lower(trim(p_search))||'%'
  ORDER BY p.occurred_at DESC
  LIMIT v_limit;
END;
$$;

COMMIT;
