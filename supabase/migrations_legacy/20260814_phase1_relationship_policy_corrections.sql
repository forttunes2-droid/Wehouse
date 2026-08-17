-- WeHouse Phase 1 relationship policy corrections

DROP POLICY IF EXISTS property_partners_owner_insert ON public.property_partners;
CREATE POLICY property_partners_owner_insert
ON public.property_partners
FOR INSERT TO authenticated
WITH CHECK (
  profile_id=public.current_profile_user_id()
  AND public.current_profile_role()='property_partner'
);

DROP POLICY IF EXISTS property_partners_admin_update ON public.property_partners;
CREATE POLICY property_partners_admin_update
ON public.property_partners
FOR UPDATE TO authenticated
USING (
  public.current_profile_role()='admin'
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.user_id=property_partners.profile_id
      AND public.current_actor_in_scope(target.state,COALESCE(NULLIF(target.local_government,''),target.city))
  )
)
WITH CHECK (
  public.current_profile_role()='admin'
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.user_id=property_partners.profile_id
      AND public.current_actor_in_scope(target.state,COALESCE(NULLIF(target.local_government,''),target.city))
  )
);

DROP POLICY IF EXISTS staff_permissions_admin_read ON public.staff_permissions;
CREATE POLICY staff_permissions_admin_read
ON public.staff_permissions
FOR SELECT TO authenticated
USING (
  public.current_profile_role()='creator'
  OR (
    public.current_profile_role()='admin'
    AND EXISTS (
      SELECT 1
      FROM public.profiles staff_profile
      WHERE staff_profile.user_id=staff_permissions.staff_id
        AND staff_profile.role='staff'
        AND public.current_actor_in_scope(staff_profile.assigned_state,staff_profile.assigned_lga)
    )
  )
);
