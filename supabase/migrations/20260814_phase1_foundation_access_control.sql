BEGIN;

-- ============================================================
-- WeHouse Phase 1 Foundation
-- Canonical roles: user, worker, property_partner, staff, admin, creator
-- Creator = global. Admin/Staff = assigned State + LGA. Public roles = self/feature scoped.
-- ============================================================

-- 1) Canonical role and scope invariants.
UPDATE public.profiles
SET scope = CASE
  WHEN role = 'creator' THEN 'global'
  WHEN role IN ('admin','staff') THEN 'local'
  ELSE NULL
END;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user','worker','property_partner','staff','admin','creator')) NOT VALID;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_role_check;

-- Normalize Worker status vocabulary without changing the Worker product flow.
UPDATE public.profiles
SET worker_status = CASE
  WHEN worker_status = 'approved_for_verification' THEN 'verification_paid'
  ELSE worker_status
END
WHERE role = 'worker';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_worker_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_worker_status_check
  CHECK (worker_status IS NULL OR worker_status IN ('pending','verification_paid','profile_under_review','verified','suspended','rejected'));

ALTER TABLE public.worker_verifications DROP CONSTRAINT IF EXISTS worker_verifications_status_check;
ALTER TABLE public.worker_verifications
  ADD CONSTRAINT worker_verifications_status_check
  CHECK (status IS NULL OR status IN ('draft','pending','profile_under_review','verified','rejected'));

-- 2) Canonical identity and branch helpers.
CREATE OR REPLACE FUNCTION public.current_profile_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.user_id
  FROM public.profiles p
  WHERE p.auth_id = auth.uid()::text
    AND COALESCE(p.deleted,false)=false
    AND COALESCE(p.suspended,false)=false
    AND COALESCE(p.banned,false)=false
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.role
  FROM public.profiles p
  WHERE p.auth_id = auth.uid()::text
    AND COALESCE(p.deleted,false)=false
    AND COALESCE(p.suspended,false)=false
    AND COALESCE(p.banned,false)=false
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_actor_in_scope(p_state text, p_lga text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RETURN false; END IF;
  IF v_actor.role='creator' THEN RETURN true; END IF;
  IF v_actor.role NOT IN ('admin','staff') THEN RETURN false; END IF;
  IF NULLIF(BTRIM(COALESCE(v_actor.assigned_state,'')),'') IS NULL
     OR NULLIF(BTRIM(COALESCE(v_actor.assigned_lga,'')),'') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_state,'')),'') IS NULL
     OR NULLIF(BTRIM(COALESCE(p_lga,'')),'') IS NULL THEN
    RETURN false;
  END IF;
  RETURN lower(BTRIM(v_actor.assigned_state))=lower(BTRIM(p_state))
     AND lower(BTRIM(v_actor.assigned_lga))=lower(BTRIM(p_lga));
END;
$$;

CREATE OR REPLACE FUNCTION public.can_current_actor_read_profile(p_target_user_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_actor public.profiles; v_target public.profiles;
BEGIN
  IF auth.uid() IS NULL OR p_target_user_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_actor FROM public.profiles
   WHERE auth_id=auth.uid()::text AND COALESCE(deleted,false)=false
     AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RETURN false; END IF;
  IF v_actor.user_id=p_target_user_id OR v_actor.role='creator' THEN RETURN true; END IF;
  IF v_actor.role NOT IN ('admin','staff') THEN RETURN false; END IF;
  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id LIMIT 1;
  IF v_target IS NULL THEN RETURN false; END IF;
  RETURN public.current_actor_in_scope(
    COALESCE(NULLIF(v_target.assigned_state,''),NULLIF(v_target.state,'')),
    COALESCE(NULLIF(v_target.assigned_lga,''),NULLIF(v_target.local_government,''),NULLIF(v_target.city,''))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE p.auth_id=auth.uid()::text
      AND p.role IN ('staff','admin','creator')
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
  )
$$;

REVOKE ALL ON FUNCTION public.current_profile_user_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_profile_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_actor_in_scope(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_current_actor_read_profile(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_profile_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_actor_in_scope(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_current_actor_read_profile(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_staff() TO authenticated;

-- 3) Server-side role changes. UI validation is not trusted.
CREATE OR REPLACE FUNCTION public.admin_update_role(p_target_user_id text, p_new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles;
  v_target public.profiles;
  v_target_state text;
  v_target_lga text;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
   WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
     AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false
   LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator access required'; END IF;

  SELECT * INTO v_target FROM public.profiles WHERE user_id=p_target_user_id FOR UPDATE;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target user not found'; END IF;
  IF v_target.auth_id=auth.uid()::text THEN RAISE EXCEPTION 'Cannot modify your own role'; END IF;
  IF v_target.role='creator' OR p_new_role='creator' THEN RAISE EXCEPTION 'Creator role is immutable and not assignable'; END IF;
  IF v_target.role IN ('worker','property_partner') THEN RAISE EXCEPTION 'Worker and Property Partner roles are fixed registration roles'; END IF;
  IF p_new_role IN ('worker','property_partner') THEN RAISE EXCEPTION 'Worker and Property Partner roles must be created through their registration flows'; END IF;
  IF p_new_role NOT IN ('user','staff','admin') THEN RAISE EXCEPTION 'Invalid role transition'; END IF;

  v_target_state := COALESCE(NULLIF(v_target.assigned_state,''),NULLIF(v_target.state,''));
  v_target_lga := COALESCE(NULLIF(v_target.assigned_lga,''),NULLIF(v_target.local_government,''),NULLIF(v_target.city,''));

  IF v_actor.role='admin' THEN
    IF v_target.role NOT IN ('user','staff') OR p_new_role NOT IN ('user','staff') THEN
      RAISE EXCEPTION 'Admin can manage User and Staff roles only';
    END IF;
    IF NOT public.current_actor_in_scope(v_target_state,v_target_lga) THEN
      RAISE EXCEPTION 'Admin scope violation';
    END IF;
  END IF;

  IF p_new_role='admin' AND v_actor.role<>'creator' THEN RAISE EXCEPTION 'Only Creator can assign Admin'; END IF;

  UPDATE public.profiles SET
    role=p_new_role,
    assigned_state=CASE
      WHEN p_new_role IN ('staff','admin') AND v_actor.role='admin' THEN v_actor.assigned_state
      WHEN p_new_role IN ('staff','admin') THEN v_target_state
      ELSE NULL END,
    assigned_lga=CASE
      WHEN p_new_role IN ('staff','admin') AND v_actor.role='admin' THEN v_actor.assigned_lga
      WHEN p_new_role IN ('staff','admin') THEN v_target_lga
      ELSE NULL END,
    scope=CASE WHEN p_new_role IN ('staff','admin') THEN 'local' ELSE NULL END,
    updated_by=v_actor.user_id,
    updated_at=now()
  WHERE user_id=p_target_user_id;

  INSERT INTO public.role_change_history(user_id,user_email,old_role,new_role,changed_by,changed_by_email,created_at)
  VALUES(p_target_user_id,v_target.email,v_target.role,p_new_role,v_actor.user_id,v_actor.email,now());

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id,admin_email,created_at)
  VALUES('ROLE_CHANGE','profiles',p_target_user_id,
    jsonb_build_object('old_role',v_target.role,'new_role',p_new_role,'actor_role',v_actor.role)::text,
    v_actor.user_id,v_actor.email,now());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_role(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_role(text,text) TO authenticated;

-- 4) Profile access remains self + scoped operations + Creator.
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
DROP POLICY IF EXISTS profiles_self_write ON public.profiles;
DROP POLICY IF EXISTS "Users can update own notification prefs" ON public.profiles;
CREATE POLICY profiles_read_canonical ON public.profiles FOR SELECT TO authenticated
  USING (public.can_current_actor_read_profile(user_id));
CREATE POLICY profiles_self_update_canonical ON public.profiles FOR UPDATE TO authenticated
  USING (auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false)
  WITH CHECK (auth_id=auth.uid()::text AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false);

-- 5) Property Partner metadata: own record + scoped internal visibility; no public financial edits.
DROP POLICY IF EXISTS partners_insert ON public.property_partners;
DROP POLICY IF EXISTS partners_select ON public.property_partners;
DROP POLICY IF EXISTS partners_update ON public.property_partners;
DROP POLICY IF EXISTS property_partners_owner_read ON public.property_partners;
DROP POLICY IF EXISTS property_partners_staff_read ON public.property_partners;
CREATE UNIQUE INDEX IF NOT EXISTS property_partners_profile_id_uidx ON public.property_partners(profile_id);
INSERT INTO public.property_partners(profile_id,partner_code,status)
SELECT p.user_id,'WHP-'||replace(p.user_id,'WHU-',''),'pending_verification'
FROM public.profiles p
WHERE p.role='property_partner'
ON CONFLICT (profile_id) DO NOTHING;
CREATE POLICY property_partners_owner_read_canonical ON public.property_partners FOR SELECT TO authenticated
  USING (profile_id=public.current_profile_user_id());
CREATE POLICY property_partners_owner_insert_canonical ON public.property_partners FOR INSERT TO authenticated
  WITH CHECK (profile_id=public.current_profile_user_id() AND public.current_profile_role()='property_partner');
CREATE POLICY property_partners_internal_read_canonical ON public.property_partners FOR SELECT TO authenticated
  USING (
    public.current_profile_role()='creator'
    OR (
      public.current_profile_role() IN ('admin','staff')
      AND EXISTS(
        SELECT 1 FROM public.profiles target
        WHERE target.user_id=property_partners.profile_id
          AND public.current_actor_in_scope(target.state,COALESCE(target.local_government,target.city))
      )
    )
  );
CREATE POLICY property_partners_admin_update_canonical ON public.property_partners FOR UPDATE TO authenticated
  USING (
    public.current_profile_role()='creator'
    OR (
      public.current_profile_role()='admin'
      AND EXISTS(
        SELECT 1 FROM public.profiles target
        WHERE target.user_id=property_partners.profile_id
          AND public.current_actor_in_scope(target.state,COALESCE(target.local_government,target.city))
      )
    )
  )
  WITH CHECK (
    public.current_profile_role()='creator'
    OR (
      public.current_profile_role()='admin'
      AND EXISTS(
        SELECT 1 FROM public.profiles target
        WHERE target.user_id=property_partners.profile_id
          AND public.current_actor_in_scope(target.state,COALESCE(target.local_government,target.city))
      )
    )
  );

-- 6) Worker services: Worker owns data; public discovery stays through get_public_workers().
DROP POLICY IF EXISTS ws_delete ON public.worker_services;
DROP POLICY IF EXISTS ws_insert ON public.worker_services;
DROP POLICY IF EXISTS ws_select ON public.worker_services;
DROP POLICY IF EXISTS ws_update ON public.worker_services;
DROP POLICY IF EXISTS worker_services_owner_delete ON public.worker_services;
DROP POLICY IF EXISTS worker_services_owner_insert ON public.worker_services;
DROP POLICY IF EXISTS worker_services_owner_update ON public.worker_services;
CREATE POLICY worker_services_owner_read_canonical ON public.worker_services FOR SELECT TO authenticated
  USING (worker_id=public.current_profile_user_id() AND public.current_profile_role()='worker');
CREATE POLICY worker_services_owner_insert_canonical ON public.worker_services FOR INSERT TO authenticated
  WITH CHECK (worker_id=public.current_profile_user_id() AND public.current_profile_role()='worker');
CREATE POLICY worker_services_owner_update_canonical ON public.worker_services FOR UPDATE TO authenticated
  USING (worker_id=public.current_profile_user_id() AND public.current_profile_role()='worker')
  WITH CHECK (worker_id=public.current_profile_user_id() AND public.current_profile_role()='worker');
CREATE POLICY worker_services_owner_delete_canonical ON public.worker_services FOR DELETE TO authenticated
  USING (worker_id=public.current_profile_user_id() AND public.current_profile_role()='worker');

-- 7) Immutable user activity stream: own writes/reads; operational scoped reads; no browser edits/deletes.
DROP POLICY IF EXISTS ua_all ON public.user_activity;
DROP POLICY IF EXISTS user_activity_owner ON public.user_activity;
CREATE POLICY user_activity_insert_own_canonical ON public.user_activity FOR INSERT TO authenticated
  WITH CHECK (user_id=public.current_profile_user_id() AND auth_id=auth.uid()::text);
CREATE POLICY user_activity_read_canonical ON public.user_activity FOR SELECT TO authenticated
  USING (public.can_current_actor_read_profile(user_id));

-- 8) Reports: reporter owns report; branch operations can work it; Creator global.
DROP POLICY IF EXISTS listing_reports_policy ON public.listing_reports;
DROP POLICY IF EXISTS lr_all ON public.listing_reports;
DROP POLICY IF EXISTS reports_insert ON public.listing_reports;
DROP POLICY IF EXISTS reports_select ON public.listing_reports;
CREATE POLICY listing_reports_insert_canonical ON public.listing_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id=public.current_profile_user_id());
CREATE POLICY listing_reports_read_canonical ON public.listing_reports FOR SELECT TO authenticated
  USING (reporter_id=public.current_profile_user_id() OR public.can_current_actor_read_profile(reporter_id));
CREATE POLICY listing_reports_operational_update_canonical ON public.listing_reports FOR UPDATE TO authenticated
  USING (public.current_profile_role() IN ('staff','admin','creator') AND public.can_current_actor_read_profile(reporter_id))
  WITH CHECK (public.current_profile_role() IN ('staff','admin','creator') AND public.can_current_actor_read_profile(reporter_id));

-- 9) Notifications: only trusted operational senders; recipient owns reads.
DROP POLICY IF EXISTS notif_insert ON public.notifications;
DROP POLICY IF EXISTS notif_select ON public.notifications;
DROP POLICY IF EXISTS notif_update ON public.notifications;
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
DROP POLICY IF EXISTS notifications_owner ON public.notifications;
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_owner_read_canonical ON public.notifications FOR SELECT TO authenticated
  USING (recipient_id=public.current_profile_user_id());
CREATE POLICY notifications_owner_update_canonical ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_id=public.current_profile_user_id())
  WITH CHECK (recipient_id=public.current_profile_user_id());
CREATE POLICY notifications_operational_insert_canonical ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (
    public.current_profile_role()='creator'
    OR (public.current_profile_role() IN ('admin','staff') AND public.can_current_actor_read_profile(recipient_id))
  );

-- 10) Audit/role-history tables are no longer public mutable surfaces.
DROP POLICY IF EXISTS al_all ON public.admin_audit_log;
CREATE POLICY admin_audit_insert_canonical ON public.admin_audit_log FOR INSERT TO authenticated
  WITH CHECK (admin_id=public.current_profile_user_id() AND public.current_profile_role() IN ('staff','admin','creator'));
CREATE POLICY admin_audit_read_canonical ON public.admin_audit_log FOR SELECT TO authenticated
  USING (public.current_profile_role()='creator' OR admin_id=public.current_profile_user_id());

DROP POLICY IF EXISTS role_change_history_policy ON public.role_change_history;
DROP POLICY IF EXISTS rolehist_insert_all ON public.role_change_history;
DROP POLICY IF EXISTS rolehist_select_admin ON public.role_change_history;
CREATE POLICY role_change_history_read_canonical ON public.role_change_history FOR SELECT TO authenticated
  USING (
    public.current_profile_role()='creator'
    OR (public.current_profile_role()='admin' AND public.can_current_actor_read_profile(user_id))
  );

-- Empty legacy logging tables remain for migration compatibility but lose broad browser access.
DROP POLICY IF EXISTS "Allow_insert_activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Creator_read_activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS admin_insert_logs ON public.admin_logs;
DROP POLICY IF EXISTS admin_read_logs ON public.admin_logs;

-- 11) Hotel reviews: public readable, authenticated User writes own review only.
DROP POLICY IF EXISTS hotel_reviews_all ON public.hotel_reviews;
DROP POLICY IF EXISTS hotel_reviews_insert ON public.hotel_reviews;
DROP POLICY IF EXISTS hotel_reviews_select ON public.hotel_reviews;
CREATE POLICY hotel_reviews_public_read_canonical ON public.hotel_reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY hotel_reviews_user_insert_canonical ON public.hotel_reviews FOR INSERT TO authenticated
  WITH CHECK (user_id=public.current_profile_user_id() AND public.current_profile_role()='user');

-- Duplicate image hashes are internal integrity data, not a shared authenticated scratch table.
DROP POLICY IF EXISTS image_hashes_all ON public.listing_image_hashes;
DROP POLICY IF EXISTS image_hashes_read ON public.listing_image_hashes;
CREATE POLICY listing_image_hashes_internal_read ON public.listing_image_hashes FOR SELECT TO authenticated
  USING (public.current_profile_role() IN ('staff','admin','creator'));

-- 12) Listing ownership and approval authority.
DROP POLICY IF EXISTS listings_canonical_select ON public.listings;
CREATE POLICY listings_read_canonical ON public.listings FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    (public.current_profile_role()='user' AND status='available' AND inspection_request_id IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR reserved_by=public.current_profile_user_id()
    OR owner_id=public.current_profile_user_id()
    OR public.current_profile_role()='creator'
    OR (public.current_profile_role() IN ('admin','staff') AND public.current_actor_in_scope(state,city))
  )
);

CREATE OR REPLACE FUNCTION public.create_internal_listing(p_data jsonb)
RETURNS public.listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_actor public.profiles; v_initial_status text; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('property_partner','staff','admin','creator')
    AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Listing submission is not allowed for this account'; END IF;
  IF NULLIF(BTRIM(p_data->>'title'),'') IS NULL THEN RAISE EXCEPTION 'Listing title is required'; END IF;
  IF COALESCE((p_data->>'price')::numeric,0)<=0 THEN RAISE EXCEPTION 'Listing price must be greater than zero'; END IF;
  IF NULLIF(BTRIM(p_data->>'state'),'') IS NULL OR NULLIF(BTRIM(p_data->>'city'),'') IS NULL THEN RAISE EXCEPTION 'Listing State and LGA are required'; END IF;
  IF v_actor.role IN ('admin','staff') AND NOT public.current_actor_in_scope(p_data->>'state',p_data->>'city') THEN
    RAISE EXCEPTION 'Listing is outside your assigned branch';
  END IF;
  v_initial_status:=CASE WHEN v_actor.role='creator' THEN 'available' ELSE 'pending_approval' END;
  INSERT INTO public.listings(
    listing_id,title,description,price,currency,state,city,address,images,videos,property_type,sub_type,
    bedrooms,bathrooms,status,availability_status,owner_id,partner_id,chat_agent_id,submitted_by_role,
    reserved_by,reservation_expiry,reservation_fee_paid,chat_unlocked,security_deposit_amount,contact_phone,amenities
  ) VALUES(
    gen_random_uuid()::text,BTRIM(p_data->>'title'),NULLIF(BTRIM(p_data->>'description'),''),(p_data->>'price')::numeric,
    COALESCE(NULLIF(BTRIM(p_data->>'currency'),''),'NGN'),BTRIM(p_data->>'state'),BTRIM(p_data->>'city'),NULLIF(BTRIM(p_data->>'address'),''),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_data->'images','[]'::jsonb))),ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_data->'videos','[]'::jsonb))),ARRAY[]::text[]),
    NULLIF(BTRIM(p_data->>'property_type'),''),NULLIF(BTRIM(p_data->>'sub_type'),''),COALESCE((p_data->>'bedrooms')::int,1),COALESCE((p_data->>'bathrooms')::int,1),
    v_initial_status,v_initial_status,v_actor.user_id,NULL,CASE WHEN v_actor.role='staff' THEN v_actor.user_id ELSE NULL END,v_actor.role,
    NULL,NULL,false,false,NULLIF(p_data->>'security_deposit_amount','')::numeric,NULLIF(BTRIM(p_data->>'contact_phone'),''),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_data->'amenities','[]'::jsonb))),ARRAY[]::text[])
  ) RETURNING * INTO v_listing;
  RETURN v_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_listing_internal(p_listing_id uuid)
RETURNS public.listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
   AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator approval required'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_listing.status<>'pending_approval' THEN RAISE EXCEPTION 'Only pending listings can be approved'; END IF;
  IF v_actor.role='admin' THEN
    IF COALESCE(v_listing.submitted_by_role,'') NOT IN ('staff','property_partner') THEN RAISE EXCEPTION 'Admin cannot approve this submission type'; END IF;
    IF NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF;
  END IF;
  UPDATE public.listings SET status='available',availability_status='available',approved_by=v_actor.user_id,approved_at=now(),rejection_reason=NULL
   WHERE id=p_listing_id RETURNING * INTO v_listing;
  RETURN v_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_listing_internal(p_listing_id uuid,p_reason text)
RETURNS public.listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text AND role IN ('admin','creator')
   AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Admin or Creator rejection authority required'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF v_listing.status<>'pending_approval' THEN RAISE EXCEPTION 'Only pending listings can be rejected'; END IF;
  IF v_actor.role='admin' THEN
    IF COALESCE(v_listing.submitted_by_role,'') NOT IN ('staff','property_partner') THEN RAISE EXCEPTION 'Admin cannot reject this submission type'; END IF;
    IF NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF;
  END IF;
  UPDATE public.listings SET status='rejected',availability_status='rejected',approved_by=v_actor.user_id,approved_at=now(),rejection_reason=BTRIM(p_reason)
   WHERE id=p_listing_id RETURNING * INTO v_listing;
  RETURN v_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_listing_internal(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_actor public.profiles; v_listing public.listings;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text
   AND role IN ('property_partner','admin','creator') AND COALESCE(deleted,false)=false AND COALESCE(suspended,false)=false AND COALESCE(banned,false)=false LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authorized to remove listings'; END IF;
  SELECT * INTO v_listing FROM public.listings WHERE id=p_listing_id AND deleted_at IS NULL FOR UPDATE;
  IF v_listing IS NULL THEN RETURN false; END IF;
  IF v_actor.role='property_partner' AND (v_listing.owner_id<>v_actor.user_id OR v_listing.status NOT IN ('pending_approval','rejected','closed')) THEN
    RAISE EXCEPTION 'Property Partner can remove only their own unpublished listing';
  END IF;
  IF v_actor.role='admin' AND NOT public.current_actor_in_scope(v_listing.state,v_listing.city) THEN RAISE EXCEPTION 'Listing is outside your assigned branch'; END IF;
  UPDATE public.listings SET status='closed',availability_status='closed',deleted_at=now() WHERE id=p_listing_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.create_internal_listing(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_listing_internal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_listing_internal(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.soft_delete_listing_internal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_internal_listing(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_listing_internal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_listing_internal(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_listing_internal(uuid) TO authenticated;

-- 13) Storage write hardening. Public buckets may be publicly readable, but writes require auth + role/ownership.
DROP POLICY IF EXISTS avatars_delete_own ON storage.objects;
DROP POLICY IF EXISTS avatars_insert_own ON storage.objects;
DROP POLICY IF EXISTS avatars_update_own ON storage.objects;
DROP POLICY IF EXISTS listing-videos-public ON storage.objects;
DROP POLICY IF EXISTS listing_images_delete_auth ON storage.objects;
DROP POLICY IF EXISTS listing_images_insert_auth ON storage.objects;
DROP POLICY IF EXISTS listing_images_update_auth ON storage.objects;
DROP POLICY IF EXISTS listings_storage_insert ON storage.objects;
DROP POLICY IF EXISTS videos_delete_auth ON storage.objects;
DROP POLICY IF EXISTS videos_insert_auth ON storage.objects;
DROP POLICY IF EXISTS videos_update_auth ON storage.objects;

CREATE POLICY avatars_insert_authenticated ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='avatars');
CREATE POLICY avatars_update_owner ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id='avatars' AND owner_id=auth.uid()::text)
  WITH CHECK (bucket_id='avatars' AND owner_id=auth.uid()::text);
CREATE POLICY avatars_delete_owner ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='avatars' AND owner_id=auth.uid()::text);

CREATE POLICY listing_media_insert_authorized ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('listing-images','listing-videos','listings')
    AND public.current_profile_role() IN ('property_partner','staff','admin','creator')
  );
CREATE POLICY listing_media_update_owner ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('listing-images','listing-videos','listings') AND owner_id=auth.uid()::text)
  WITH CHECK (bucket_id IN ('listing-images','listing-videos','listings') AND owner_id=auth.uid()::text);
CREATE POLICY listing_media_delete_owner_or_creator ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('listing-images','listing-videos','listings')
    AND (owner_id=auth.uid()::text OR public.current_profile_role()='creator')
  );

-- Private Worker evidence buckets. Worker uploads only under their own profile-user-id folder.
DROP POLICY IF EXISTS worker_files_insert_own ON storage.objects;
DROP POLICY IF EXISTS worker_files_select_own ON storage.objects;
DROP POLICY IF EXISTS worker_files_delete_own ON storage.objects;
CREATE POLICY worker_private_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('worker-government-ids','worker-certificates','worker-verification-videos')
    AND public.current_profile_role()='worker'
    AND (storage.foldername(name))[1]=public.current_profile_user_id()
  );
CREATE POLICY worker_private_read_own ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('worker-government-ids','worker-certificates','worker-verification-videos')
    AND public.current_profile_role()='worker'
    AND (storage.foldername(name))[1]=public.current_profile_user_id()
  );
CREATE POLICY worker_private_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('worker-government-ids','worker-certificates','worker-verification-videos')
    AND public.current_profile_role()='worker'
    AND (storage.foldername(name))[1]=public.current_profile_user_id()
  );

-- worker-files was a legacy mixed public bucket; keep it inaccessible for new writes.
UPDATE storage.buckets SET public=false WHERE id='worker-files';

COMMIT;
