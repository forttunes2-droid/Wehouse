-- WEHOUSE ROLE-SPECIFIC PROFILE DATA SECURITY
-- Secures staff permissions, partner accounts, worker services, bank accounts,
-- avatars and worker verification files. No production data is deleted.

BEGIN;

-- ─── STAFF PERMISSIONS ─────────────────────────────────────────────
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sp_all ON public.staff_permissions;
DROP POLICY IF EXISTS staff_permissions_all_access ON public.staff_permissions;
DROP POLICY IF EXISTS staff_permissions_self_read ON public.staff_permissions;
DROP POLICY IF EXISTS staff_permissions_manager_read ON public.staff_permissions;

CREATE POLICY staff_permissions_self_read ON public.staff_permissions
FOR SELECT TO authenticated
USING (
  staff_id = (SELECT p.user_id FROM public.profiles p WHERE p.auth_id = auth.uid()::text LIMIT 1)
);

CREATE POLICY staff_permissions_manager_read ON public.staff_permissions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles caller
    JOIN public.profiles target ON target.user_id = staff_permissions.staff_id
    WHERE caller.auth_id = auth.uid()::text
      AND (
        caller.role = 'creator'
        OR (caller.role = 'admin' AND caller.assigned_lga IS NOT NULL AND target.assigned_lga = caller.assigned_lga)
      )
  )
);

CREATE OR REPLACE FUNCTION public.manage_staff_permission(
  p_staff_id text,
  p_permission text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller public.profiles;
  v_target public.profiles;
BEGIN
  SELECT * INTO v_caller FROM public.profiles WHERE auth_id = auth.uid()::text;
  SELECT * INTO v_target FROM public.profiles WHERE user_id = p_staff_id;

  IF v_caller IS NULL OR v_caller.role NOT IN ('admin','creator') THEN
    RAISE EXCEPTION 'Admin or Creator access required';
  END IF;
  IF v_target IS NULL OR v_target.role <> 'staff' THEN
    RAISE EXCEPTION 'Target must be a Staff account';
  END IF;
  IF v_caller.role = 'admin' AND (
    v_caller.assigned_lga IS NULL OR v_target.assigned_lga IS DISTINCT FROM v_caller.assigned_lga
  ) THEN
    RAISE EXCEPTION 'Admin may manage Staff only within the assigned LGA';
  END IF;

  INSERT INTO public.staff_permissions (staff_id, permission, granted_by, is_active, granted_at, revoked_at)
  VALUES (p_staff_id, p_permission, v_caller.user_id, p_enabled, now(), CASE WHEN p_enabled THEN NULL ELSE now() END)
  ON CONFLICT (staff_id, permission) DO UPDATE SET
    is_active = EXCLUDED.is_active,
    granted_by = EXCLUDED.granted_by,
    granted_at = CASE WHEN EXCLUDED.is_active THEN now() ELSE staff_permissions.granted_at END,
    revoked_at = CASE WHEN EXCLUDED.is_active THEN NULL ELSE now() END;

  INSERT INTO public.audit_logs(action,target_type,target_id,details,admin_id)
  VALUES ('STAFF_PERMISSION','staff_permissions',p_staff_id,
    jsonb_build_object('permission',p_permission,'enabled',p_enabled)::text,
    auth.uid()::text);
END;
$$;
REVOKE ALL ON FUNCTION public.manage_staff_permission(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_staff_permission(text,text,boolean) TO authenticated;

-- ─── PROPERTY PARTNER ACCOUNT ──────────────────────────────────────
ALTER TABLE public.property_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partners_insert ON public.property_partners;
DROP POLICY IF EXISTS partners_select ON public.property_partners;
DROP POLICY IF EXISTS partners_update ON public.property_partners;
DROP POLICY IF EXISTS property_partner_owner_read ON public.property_partners;
DROP POLICY IF EXISTS property_partner_staff_read ON public.property_partners;

CREATE POLICY property_partner_owner_read ON public.property_partners
FOR SELECT TO authenticated
USING (
  profile_id = (SELECT p.user_id FROM public.profiles p WHERE p.auth_id = auth.uid()::text LIMIT 1)
);

CREATE POLICY property_partner_staff_read ON public.property_partners
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role IN ('staff','admin','creator'))
);

CREATE OR REPLACE FUNCTION public.ensure_my_partner_account()
RETURNS public.property_partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_partner public.property_partners;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text;
  IF v_profile IS NULL OR v_profile.role <> 'property_partner' THEN
    RAISE EXCEPTION 'Property Partner account required';
  END IF;

  SELECT * INTO v_partner FROM public.property_partners WHERE profile_id=v_profile.user_id;
  IF v_partner IS NULL THEN
    INSERT INTO public.property_partners(profile_id,partner_code,status)
    VALUES (v_profile.user_id, 'WHP-' || upper(substr(md5(v_profile.user_id || clock_timestamp()::text),1,10)), 'pending_verification')
    RETURNING * INTO v_partner;
  END IF;
  RETURN v_partner;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_my_partner_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_my_partner_account() TO authenticated;

-- ─── WORKER SERVICES ───────────────────────────────────────────────
ALTER TABLE public.worker_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_delete ON public.worker_services;
DROP POLICY IF EXISTS ws_insert ON public.worker_services;
DROP POLICY IF EXISTS ws_select ON public.worker_services;
DROP POLICY IF EXISTS ws_update ON public.worker_services;
DROP POLICY IF EXISTS worker_services_public_read ON public.worker_services;
DROP POLICY IF EXISTS worker_services_owner_all ON public.worker_services;

CREATE POLICY worker_services_public_read ON public.worker_services
FOR SELECT TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id=worker_services.worker_id
      AND p.role='worker' AND p.worker_status='verified'
      AND p.deleted=false AND p.suspended=false AND p.banned=false
  )
);

CREATE POLICY worker_services_owner_all ON public.worker_services
FOR ALL TO authenticated
USING (
  worker_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='worker' LIMIT 1)
)
WITH CHECK (
  worker_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role='worker' LIMIT 1)
);

-- ─── BANK ACCOUNTS ─────────────────────────────────────────────────
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_accounts_owner_read ON public.bank_accounts;
DROP POLICY IF EXISTS bank_accounts_finance_read ON public.bank_accounts;
CREATE POLICY bank_accounts_owner_read ON public.bank_accounts
FOR SELECT TO authenticated
USING (user_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1));
CREATE POLICY bank_accounts_finance_read ON public.bank_accounts
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role IN ('creator','admin')));

CREATE OR REPLACE FUNCTION public.upsert_my_bank_account(
  p_bank_name text,
  p_bank_code text,
  p_account_number text,
  p_account_name text
)
RETURNS public.bank_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_bank public.bank_accounts;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
  WHERE auth_id=auth.uid()::text AND role IN ('worker','property_partner')
    AND deleted=false AND suspended=false AND banned=false;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Payout account is available only to Workers and Property Partners'; END IF;
  IF length(regexp_replace(COALESCE(p_account_number,''),'\D','','g')) <> 10 THEN
    RAISE EXCEPTION 'Bank account number must contain 10 digits';
  END IF;
  IF nullif(trim(p_bank_name),'') IS NULL OR nullif(trim(p_account_name),'') IS NULL THEN
    RAISE EXCEPTION 'Bank and account name are required';
  END IF;

  SELECT * INTO v_bank FROM public.bank_accounts WHERE user_id=v_profile.user_id AND is_default=true LIMIT 1;
  IF v_bank IS NULL THEN
    INSERT INTO public.bank_accounts(user_id,account_number,bank_code,bank_name,account_name,is_default)
    VALUES(v_profile.user_id,regexp_replace(p_account_number,'\D','','g'),COALESCE(p_bank_code,''),trim(p_bank_name),trim(p_account_name),true)
    RETURNING * INTO v_bank;
  ELSE
    UPDATE public.bank_accounts SET
      account_number=regexp_replace(p_account_number,'\D','','g'),
      bank_code=COALESCE(p_bank_code,''), bank_name=trim(p_bank_name), account_name=trim(p_account_name),
      verified_at=NULL
    WHERE id=v_bank.id RETURNING * INTO v_bank;
  END IF;
  RETURN v_bank;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_my_bank_account(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_my_bank_account(text,text,text,text) TO authenticated;

-- Compatibility for old role dashboard SettingsTab. It routes data to the
-- correct secure subsystem instead of writing unrestricted profile columns.
CREATE OR REPLACE FUNCTION public.worker_update_profile(p_user_id text,p_updates jsonb)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_personal jsonb := '{}'::jsonb;
  v_privacy jsonb := '{}'::jsonb;
  v_professional_changed boolean := false;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE auth_id=auth.uid()::text;
  IF v_profile IS NULL OR v_profile.user_id<>p_user_id THEN RAISE EXCEPTION 'You may update only your own account'; END IF;

  v_personal := p_updates - ARRAY[
    'worker_occupation','worker_status','worker_verified','privacy_profile_visible','privacy_search_visible','privacy_activity_visible',
    'privacy_email_visible','privacy_phone_visible','bank_name','bank_code','bank_account_number','bank_account_name'
  ];
  IF v_personal <> '{}'::jsonb THEN
    v_profile := public.update_my_profile(v_personal);
  END IF;

  v_privacy := jsonb_strip_nulls(jsonb_build_object(
    'privacy_profile_visible',p_updates->'privacy_profile_visible',
    'privacy_search_visible',p_updates->'privacy_search_visible',
    'privacy_activity_visible',p_updates->'privacy_activity_visible',
    'privacy_email_visible',p_updates->'privacy_email_visible',
    'privacy_phone_visible',p_updates->'privacy_phone_visible'
  ));
  IF v_privacy <> '{}'::jsonb THEN v_profile := public.update_my_privacy(v_privacy); END IF;

  IF p_updates ? 'worker_occupation' THEN
    IF v_profile.role<>'worker' THEN RAISE EXCEPTION 'Worker profile required'; END IF;
    UPDATE public.profiles SET worker_occupation=nullif(trim(p_updates->>'worker_occupation'),''), updated_at=now()
    WHERE user_id=v_profile.user_id RETURNING * INTO v_profile;
    v_professional_changed := true;
  END IF;

  IF v_professional_changed AND v_profile.worker_status IN ('approved_for_verification','profile_under_review','verified') THEN
    UPDATE public.profiles SET worker_status='pending',worker_verified=false,updated_at=now()
    WHERE user_id=v_profile.user_id RETURNING * INTO v_profile;
  END IF;

  IF p_updates ? 'bank_name' OR p_updates ? 'bank_account_number' OR p_updates ? 'bank_account_name' THEN
    PERFORM public.upsert_my_bank_account(
      COALESCE(p_updates->>'bank_name',''),COALESCE(p_updates->>'bank_code',''),
      COALESCE(p_updates->>'bank_account_number',''),COALESCE(p_updates->>'bank_account_name','')
    );
  END IF;

  RETURN v_profile;
END;
$$;
REVOKE ALL ON FUNCTION public.worker_update_profile(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_update_profile(text,jsonb) TO authenticated;

-- ─── AVATAR STORAGE ────────────────────────────────────────────────
DROP POLICY IF EXISTS avatars_insert_own ON storage.objects;
DROP POLICY IF EXISTS avatars_update_own ON storage.objects;
DROP POLICY IF EXISTS avatars_delete_own ON storage.objects;
DROP POLICY IF EXISTS avatars_select_public ON storage.objects;

CREATE POLICY avatars_select_public ON storage.objects
FOR SELECT TO public USING (bucket_id='avatars');
CREATE POLICY avatars_insert_own ON storage.objects
FOR INSERT TO authenticated WITH CHECK (bucket_id='avatars' AND (storage.foldername(name))[1]=auth.uid()::text);
CREATE POLICY avatars_update_own ON storage.objects
FOR UPDATE TO authenticated USING (bucket_id='avatars' AND (storage.foldername(name))[1]=auth.uid()::text)
WITH CHECK (bucket_id='avatars' AND (storage.foldername(name))[1]=auth.uid()::text);
CREATE POLICY avatars_delete_own ON storage.objects
FOR DELETE TO authenticated USING (bucket_id='avatars' AND (storage.foldername(name))[1]=auth.uid()::text);

-- Worker identity evidence is private. Existing application paths use either
-- worker-files/worker-verifications/<WHU-ID>/... or worker_docs/worker_docs/<WHU-ID>/...
UPDATE storage.buckets SET public=false WHERE id IN ('worker-files','worker_docs');
DROP POLICY IF EXISTS "worker-files-public" ON storage.objects;
DROP POLICY IF EXISTS worker_verification_owner_insert ON storage.objects;
DROP POLICY IF EXISTS worker_verification_owner_read ON storage.objects;
DROP POLICY IF EXISTS worker_verification_staff_read ON storage.objects;

CREATE POLICY worker_verification_owner_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id IN ('worker-files','worker_docs') AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND (
      ((storage.foldername(name))[2]=p.user_id)
      OR ((storage.foldername(name))[1]=p.user_id)
    )
  )
);
CREATE POLICY worker_verification_owner_read ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id IN ('worker-files','worker_docs') AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND (
      ((storage.foldername(name))[2]=p.user_id)
      OR ((storage.foldername(name))[1]=p.user_id)
    )
  )
);
CREATE POLICY worker_verification_staff_read ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id IN ('worker-files','worker_docs') AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role IN ('staff','admin','creator')
  )
);

COMMIT;
