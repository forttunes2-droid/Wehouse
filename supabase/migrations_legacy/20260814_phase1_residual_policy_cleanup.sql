BEGIN;

-- Remove superseded Property Partner browser writes. Registration is through
-- get_or_create_my_property_partner(); metadata changes are not broad table writes.
DROP POLICY IF EXISTS property_partners_owner_insert ON public.property_partners;
DROP POLICY IF EXISTS property_partners_admin_update ON public.property_partners;

-- Keep one canonical audit/activity policy set.
DROP POLICY IF EXISTS role_change_history_read ON public.role_change_history;
DROP POLICY IF EXISTS user_activity_owner_insert ON public.user_activity;
DROP POLICY IF EXISTS user_activity_owner_read ON public.user_activity;
DROP POLICY IF EXISTS admin_audit_log_insert ON public.admin_audit_log;
DROP POLICY IF EXISTS admin_audit_log_read ON public.admin_audit_log;
DROP POLICY IF EXISTS notifications_recipient_read ON public.notifications;
DROP POLICY IF EXISTS notifications_recipient_update ON public.notifications;
DROP POLICY IF EXISTS hotel_reviews_owner_insert ON public.hotel_reviews;
DROP POLICY IF EXISTS hotel_reviews_public_read ON public.hotel_reviews;
DROP POLICY IF EXISTS worker_services_owner_select ON public.worker_services;

-- Listing reports are scoped by the listing being reported, not merely the
-- reporter's home branch.
DROP POLICY IF EXISTS listing_reports_admin_read ON public.listing_reports;
DROP POLICY IF EXISTS listing_reports_admin_update ON public.listing_reports;
DROP POLICY IF EXISTS listing_reports_owner_insert ON public.listing_reports;
DROP POLICY IF EXISTS listing_reports_owner_read ON public.listing_reports;
DROP POLICY IF EXISTS listing_reports_read_canonical ON public.listing_reports;
DROP POLICY IF EXISTS listing_reports_operational_update_canonical ON public.listing_reports;

CREATE POLICY listing_reports_read_canonical
ON public.listing_reports FOR SELECT TO authenticated
USING (
  reporter_id=public.current_profile_user_id()
  OR public.current_profile_role()='creator'
  OR (
    public.current_profile_role() IN ('admin','staff')
    AND EXISTS(
      SELECT 1 FROM public.listings l
      WHERE ((l.id::text=listing_reports.listing_id) OR (l.listing_id=listing_reports.listing_id))
        AND public.current_actor_in_scope(l.state,l.city)
    )
  )
);

CREATE POLICY listing_reports_operational_update_canonical
ON public.listing_reports FOR UPDATE TO authenticated
USING (
  public.current_profile_role()='creator'
  OR (
    public.current_profile_role() IN ('admin','staff')
    AND EXISTS(
      SELECT 1 FROM public.listings l
      WHERE ((l.id::text=listing_reports.listing_id) OR (l.listing_id=listing_reports.listing_id))
        AND public.current_actor_in_scope(l.state,l.city)
    )
  )
)
WITH CHECK (
  public.current_profile_role()='creator'
  OR (
    public.current_profile_role() IN ('admin','staff')
    AND EXISTS(
      SELECT 1 FROM public.listings l
      WHERE ((l.id::text=listing_reports.listing_id) OR (l.listing_id=listing_reports.listing_id))
        AND public.current_actor_in_scope(l.state,l.city)
    )
  )
);

COMMIT;
