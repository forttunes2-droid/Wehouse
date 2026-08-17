-- WeHouse Phase 1 Foundation: canonical roles + critical RLS cleanup
-- Canonical roles: user, worker, property_partner, staff, admin, creator

-- 1) Canonical role constraint -------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user','worker','property_partner','staff','admin','creator'));

-- 2) Canonical role helpers ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
      AND p.role IN ('staff','admin','creator')
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_creator(uid text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.auth_id = uid
      AND p.role IN ('staff','admin','creator')
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
  );
$$;

-- 3) Property partner access -------------------------------------------------
DROP POLICY IF EXISTS partners_insert ON public.property_partners;
DROP POLICY IF EXISTS partners_select ON public.property_partners;
DROP POLICY IF EXISTS partners_update ON public.property_partners;

DROP POLICY IF EXISTS property_partners_owner_insert ON public.property_partners;
CREATE POLICY property_partners_owner_insert
ON public.property_partners
FOR INSERT
TO authenticated
WITH CHECK (
  profile_id = public.current_profile_user_id()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
      AND p.user_id = profile_id
      AND p.role = 'property_partner'
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
  )
);

DROP POLICY IF EXISTS property_partners_admin_update ON public.property_partners;
CREATE POLICY property_partners_admin_update
ON public.property_partners
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
      AND (actor.role='creator' OR public.can_current_actor_read_profile(profile_id))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
      AND (actor.role='creator' OR public.can_current_actor_read_profile(profile_id))
  )
);

-- 4) Audit and role-history access -------------------------------------------
DROP POLICY IF EXISTS al_all ON public.admin_audit_log;
DROP POLICY IF EXISTS admin_audit_log_read ON public.admin_audit_log;
CREATE POLICY admin_audit_log_read
ON public.admin_audit_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
      AND (actor.role='creator' OR admin_id=actor.user_id)
  )
);

DROP POLICY IF EXISTS admin_audit_log_insert ON public.admin_audit_log;
CREATE POLICY admin_audit_log_insert
ON public.admin_audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  admin_id = public.current_profile_user_id()
  AND EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
  )
);

DROP POLICY IF EXISTS role_change_history_policy ON public.role_change_history;
DROP POLICY IF EXISTS rolehist_insert_all ON public.role_change_history;
DROP POLICY IF EXISTS rolehist_select_admin ON public.role_change_history;
DROP POLICY IF EXISTS role_change_history_read ON public.role_change_history;
CREATE POLICY role_change_history_read
ON public.role_change_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
      AND (actor.role='creator' OR public.can_current_actor_read_profile(user_id))
  )
);

-- 5) Listing reports ----------------------------------------------------------
DROP POLICY IF EXISTS listing_reports_policy ON public.listing_reports;
DROP POLICY IF EXISTS lr_all ON public.listing_reports;
DROP POLICY IF EXISTS reports_insert ON public.listing_reports;
DROP POLICY IF EXISTS reports_select ON public.listing_reports;

CREATE POLICY listing_reports_owner_insert
ON public.listing_reports
FOR INSERT
TO authenticated
WITH CHECK (reporter_id = public.current_profile_user_id());

CREATE POLICY listing_reports_owner_read
ON public.listing_reports
FOR SELECT
TO authenticated
USING (reporter_id = public.current_profile_user_id());

CREATE POLICY listing_reports_admin_read
ON public.listing_reports
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
      AND (
        actor.role='creator'
        OR EXISTS (
          SELECT 1 FROM public.listings l
          WHERE (l.id::text = listing_reports.listing_id OR l.listing_id = listing_reports.listing_id)
            AND lower(trim(COALESCE(l.state,''))) = lower(trim(COALESCE(actor.assigned_state,'')))
            AND lower(trim(COALESCE(l.city,''))) = lower(trim(COALESCE(actor.assigned_lga,'')))
        )
      )
  )
);

CREATE POLICY listing_reports_admin_update
ON public.listing_reports
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
      AND (
        actor.role='creator'
        OR EXISTS (
          SELECT 1 FROM public.listings l
          WHERE (l.id::text = listing_reports.listing_id OR l.listing_id = listing_reports.listing_id)
            AND lower(trim(COALESCE(l.state,''))) = lower(trim(COALESCE(actor.assigned_state,'')))
            AND lower(trim(COALESCE(l.city,''))) = lower(trim(COALESCE(actor.assigned_lga,'')))
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
      AND (
        actor.role='creator'
        OR EXISTS (
          SELECT 1 FROM public.listings l
          WHERE (l.id::text = listing_reports.listing_id OR l.listing_id = listing_reports.listing_id)
            AND lower(trim(COALESCE(l.state,''))) = lower(trim(COALESCE(actor.assigned_state,'')))
            AND lower(trim(COALESCE(l.city,''))) = lower(trim(COALESCE(actor.assigned_lga,'')))
        )
      )
  )
);

-- 6) User activity ------------------------------------------------------------
DROP POLICY IF EXISTS ua_all ON public.user_activity;
DROP POLICY IF EXISTS user_activity_owner ON public.user_activity;

CREATE POLICY user_activity_owner_insert
ON public.user_activity
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = public.current_profile_user_id()
  AND auth_id = auth.uid()::text
);

CREATE POLICY user_activity_owner_read
ON public.user_activity
FOR SELECT
TO authenticated
USING (
  user_id = public.current_profile_user_id()
  OR auth_id = auth.uid()::text
  OR EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id = auth.uid()::text
      AND actor.role IN ('admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
      AND (actor.role='creator' OR public.can_current_actor_read_profile(user_activity.user_id))
  )
);

-- 7) Worker services ----------------------------------------------------------
DROP POLICY IF EXISTS ws_insert ON public.worker_services;
DROP POLICY IF EXISTS ws_update ON public.worker_services;
DROP POLICY IF EXISTS ws_delete ON public.worker_services;
DROP POLICY IF EXISTS ws_select ON public.worker_services;

DROP POLICY IF EXISTS worker_services_owner_select ON public.worker_services;
CREATE POLICY worker_services_owner_select
ON public.worker_services
FOR SELECT
TO authenticated
USING (worker_id = public.current_profile_user_id());

CREATE POLICY worker_services_verified_public_select
ON public.worker_services
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles w
    WHERE w.user_id = worker_services.worker_id
      AND w.role='worker'
      AND w.worker_status='verified'
      AND COALESCE(w.worker_verified,false)=true
      AND COALESCE(w.available,false)=true
      AND COALESCE(w.deleted,false)=false
      AND COALESCE(w.suspended,false)=false
      AND COALESCE(w.banned,false)=false
  )
);

-- 8) Roommate matches: generated/updated through RPCs ------------------------
DROP POLICY IF EXISTS rm_insert ON public.roommate_matches;
DROP POLICY IF EXISTS rm_select ON public.roommate_matches;
DROP POLICY IF EXISTS rm_update ON public.roommate_matches;
DROP POLICY IF EXISTS roommate_matches_participants ON public.roommate_matches;

CREATE POLICY roommate_matches_participant_read
ON public.roommate_matches
FOR SELECT
TO authenticated
USING (
  user_a_id = public.current_profile_user_id()
  OR user_b_id = public.current_profile_user_id()
);

CREATE POLICY roommate_matches_participant_update
ON public.roommate_matches
FOR UPDATE
TO authenticated
USING (
  user_a_id = public.current_profile_user_id()
  OR user_b_id = public.current_profile_user_id()
)
WITH CHECK (
  user_a_id = public.current_profile_user_id()
  OR user_b_id = public.current_profile_user_id()
);

-- 9) Reviews: remove public write access -------------------------------------
DROP POLICY IF EXISTS hotel_reviews_all ON public.hotel_reviews;
DROP POLICY IF EXISTS hotel_reviews_insert ON public.hotel_reviews;
DROP POLICY IF EXISTS hotel_reviews_select ON public.hotel_reviews;

CREATE POLICY hotel_reviews_public_read
ON public.hotel_reviews
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY hotel_reviews_owner_insert
ON public.hotel_reviews
FOR INSERT
TO authenticated
WITH CHECK (user_id = public.current_profile_user_id());

DROP POLICY IF EXISTS staff_reviews_policy ON public.staff_reviews;
DROP POLICY IF EXISTS staff_reviews_insert_own ON public.staff_reviews;
DROP POLICY IF EXISTS staff_reviews_select ON public.staff_reviews;

CREATE POLICY staff_reviews_public_read
ON public.staff_reviews
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY staff_reviews_owner_insert
ON public.staff_reviews
FOR INSERT
TO authenticated
WITH CHECK (reviewer_id = public.current_profile_user_id());

-- 10) Notifications: recipients can read/update their own rows; no public spam
DROP POLICY IF EXISTS notif_insert ON public.notifications;
DROP POLICY IF EXISTS notif_select ON public.notifications;
DROP POLICY IF EXISTS notif_update ON public.notifications;
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
DROP POLICY IF EXISTS notifications_owner ON public.notifications;
DROP POLICY IF EXISTS notifications_select ON public.notifications;

CREATE POLICY notifications_recipient_read
ON public.notifications
FOR SELECT
TO authenticated
USING (recipient_id = public.current_profile_user_id());

CREATE POLICY notifications_recipient_update
ON public.notifications
FOR UPDATE
TO authenticated
USING (recipient_id = public.current_profile_user_id())
WITH CHECK (recipient_id = public.current_profile_user_id());

-- 11) Storage: remove legacy public mutation policies -------------------------
DROP POLICY IF EXISTS avatars_insert_own ON storage.objects;
DROP POLICY IF EXISTS avatars_update_own ON storage.objects;
DROP POLICY IF EXISTS avatars_delete_own ON storage.objects;
-- avatars_select_public and avatar_owner_* remain intentionally.

DROP POLICY IF EXISTS listing_images_insert_auth ON storage.objects;
DROP POLICY IF EXISTS listing_images_update_auth ON storage.objects;
DROP POLICY IF EXISTS listing_images_delete_auth ON storage.objects;
DROP POLICY IF EXISTS listing-videos-public ON storage.objects;
DROP POLICY IF EXISTS videos_insert_auth ON storage.objects;
DROP POLICY IF EXISTS videos_update_auth ON storage.objects;
DROP POLICY IF EXISTS videos_delete_auth ON storage.objects;
DROP POLICY IF EXISTS listings_storage_insert ON storage.objects;

CREATE POLICY listing_images_ops_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id='listing-images'
  AND (storage.foldername(name))[1]='listings'
  AND (storage.foldername(name))[2] LIKE ('draft-' || public.current_profile_user_id() || '-%')
  AND EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role IN ('staff','admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
  )
);

CREATE POLICY listing_images_ops_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id='listing-images'
  AND (storage.foldername(name))[1]='listings'
  AND (storage.foldername(name))[2] LIKE ('draft-' || public.current_profile_user_id() || '-%')
)
WITH CHECK (
  bucket_id='listing-images'
  AND (storage.foldername(name))[1]='listings'
  AND (storage.foldername(name))[2] LIKE ('draft-' || public.current_profile_user_id() || '-%')
);

CREATE POLICY listing_images_ops_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id='listing-images'
  AND (storage.foldername(name))[1]='listings'
  AND (storage.foldername(name))[2] LIKE ('draft-' || public.current_profile_user_id() || '-%')
);

CREATE POLICY listing_videos_ops_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id='listing-videos'
  AND (storage.foldername(name))[1]='listings'
  AND (storage.foldername(name))[2] LIKE ('draft-' || public.current_profile_user_id() || '-%')
  AND EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role IN ('staff','admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
  )
);

CREATE POLICY listing_videos_ops_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id='listing-videos'
  AND (storage.foldername(name))[1]='listings'
  AND (storage.foldername(name))[2] LIKE ('draft-' || public.current_profile_user_id() || '-%')
)
WITH CHECK (
  bucket_id='listing-videos'
  AND (storage.foldername(name))[1]='listings'
  AND (storage.foldername(name))[2] LIKE ('draft-' || public.current_profile_user_id() || '-%')
);

CREATE POLICY listing_videos_ops_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id='listing-videos'
  AND (storage.foldername(name))[1]='listings'
  AND (storage.foldername(name))[2] LIKE ('draft-' || public.current_profile_user_id() || '-%')
);

CREATE POLICY listings_storage_ops_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id='listings'
  AND EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role IN ('staff','admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
  )
);

CREATE POLICY listings_storage_ops_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id='listings'
  AND EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role IN ('staff','admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
  )
)
WITH CHECK (
  bucket_id='listings'
  AND EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role IN ('staff','admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
  )
);

CREATE POLICY listings_storage_ops_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id='listings'
  AND EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.auth_id=auth.uid()::text
      AND actor.role IN ('staff','admin','creator')
      AND COALESCE(actor.deleted,false)=false
      AND COALESCE(actor.suspended,false)=false
      AND COALESCE(actor.banned,false)=false
  )
);

-- Worker government ID is owner-only until external KYC integration is wired.
DROP POLICY IF EXISTS worker_gov_owner_insert ON storage.objects;
DROP POLICY IF EXISTS worker_gov_read_own ON storage.objects;
CREATE POLICY worker_gov_read_own
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id='worker-government-ids'
  AND (storage.foldername(name))[1]=public.current_profile_user_id()
);

-- Remove legacy policies pointing at obsolete bucket names.
DROP POLICY IF EXISTS worker_video_owner_insert ON storage.objects;
DROP POLICY IF EXISTS worker_cert_owner_insert ON storage.objects;

-- Keep public media reads; only writes are restricted.
