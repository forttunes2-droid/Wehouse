-- Remove legacy policies/triggers that conflict with the consolidated Profile model.

BEGIN;

-- Staff permission mutations must use manage_staff_permission().
DROP POLICY IF EXISTS staff_permissions_creator_manage ON public.staff_permissions;
DROP POLICY IF EXISTS staff_permissions_view_own ON public.staff_permissions;

-- Profiles: self-service writes only. Administrative changes use secured RPCs.
DROP POLICY IF EXISTS profiles_delete ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS "Users can update own notification prefs" ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
DROP POLICY IF EXISTS profiles_self_write ON public.profiles;

CREATE POLICY profiles_insert_own ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (auth_id=auth.uid()::text AND role IN ('user','worker','property_partner'));

CREATE POLICY profiles_read_own ON public.profiles
FOR SELECT TO authenticated
USING (auth_id=auth.uid()::text AND suspended=false AND banned=false);

CREATE POLICY profiles_internal_read ON public.profiles
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles caller
    WHERE caller.auth_id=auth.uid()::text AND (
      caller.role='creator'
      OR (
        caller.role IN ('admin','staff') AND caller.assigned_lga IS NOT NULL
        AND (
          profiles.assigned_lga=caller.assigned_lga
          OR COALESCE(profiles.local_government,profiles.city)=caller.assigned_lga
        )
      )
    )
  )
);

CREATE POLICY profiles_update_own ON public.profiles
FOR UPDATE TO authenticated
USING (auth_id=auth.uid()::text AND suspended=false AND banned=false AND deleted=false)
WITH CHECK (auth_id=auth.uid()::text AND suspended=false AND banned=false AND deleted=false);

-- Multiple devices are supported. Remove the legacy single-session trigger.
DROP TRIGGER IF EXISTS trg_invalidate_old_sessions ON public.user_sessions;
DROP FUNCTION IF EXISTS public.invalidate_old_sessions();

DROP POLICY IF EXISTS sessions_insert_own ON public.user_sessions;
DROP POLICY IF EXISTS sessions_select_own ON public.user_sessions;
DROP POLICY IF EXISTS sessions_update_own ON public.user_sessions;
DROP POLICY IF EXISTS sess_insert_own ON public.user_sessions;
DROP POLICY IF EXISTS sess_select_own ON public.user_sessions;
DROP POLICY IF EXISTS sess_update_own ON public.user_sessions;
DROP POLICY IF EXISTS user_sessions_owner ON public.user_sessions;
DROP POLICY IF EXISTS sessions_admin ON public.user_sessions;

CREATE POLICY user_sessions_owner_read ON public.user_sessions
FOR SELECT TO authenticated
USING (auth_id=auth.uid()::text);
CREATE POLICY user_sessions_owner_insert ON public.user_sessions
FOR INSERT TO authenticated
WITH CHECK (auth_id=auth.uid()::text AND user_id=(SELECT p.user_id FROM public.profiles p WHERE p.auth_id=auth.uid()::text LIMIT 1));
CREATE POLICY user_sessions_owner_update ON public.user_sessions
FOR UPDATE TO authenticated
USING (auth_id=auth.uid()::text)
WITH CHECK (auth_id=auth.uid()::text);
CREATE POLICY user_sessions_admin_read ON public.user_sessions
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.auth_id=auth.uid()::text AND p.role IN ('creator','admin')));

COMMIT;
