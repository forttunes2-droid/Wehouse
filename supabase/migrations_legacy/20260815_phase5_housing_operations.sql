BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_housing_operations()
RETURNS TABLE(
  listing_id text,
  listing_title text,
  listing_status text,
  property_type text,
  sub_type text,
  state text,
  lga text,
  address text,
  annual_rent numeric,
  current_reservation_id text,
  reservation_status text,
  customer_user_id text,
  customer_name text,
  customer_username text,
  reservation_fee_paid boolean,
  payment_status text,
  rental_plan_years integer,
  hold_expires_at timestamptz,
  tenancy_start_date date,
  tenancy_end_date date,
  move_out_grace_until date,
  occupied_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='pg_catalog','public'
AS $$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND role IN ('staff','admin','creator')
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Housing operations access required'; END IF;
  IF v_actor.role='staff' AND NOT public.current_staff_has_permission('operations') THEN
    RAISE EXCEPTION 'Operations permission required';
  END IF;

  RETURN QUERY
  SELECT
    l.id::text,
    l.title,
    l.status,
    l.property_type,
    l.sub_type,
    l.state,
    l.city,
    l.address,
    l.price,
    l.current_reservation_id,
    r.status,
    r.user_id,
    COALESCE(p.full_name,p.username,p.email),
    p.username,
    COALESCE(l.reservation_fee_paid,false),
    r.manual_payment_status,
    r.rental_plan_years,
    r.hold_expires_at,
    r.tenancy_start_date,
    r.tenancy_end_date,
    r.move_out_grace_until,
    l.occupied_at
  FROM public.listings l
  LEFT JOIN public.reservations r ON r.id=l.current_reservation_id
  LEFT JOIN public.profiles p ON p.user_id=r.user_id
  WHERE l.deleted_at IS NULL
    AND COALESCE(l.property_type,'apartment')='apartment'
    AND l.status IN ('available','reserved','occupied','maintenance','closed')
    AND (v_actor.role='creator' OR public.current_actor_in_scope(l.state,l.city))
  ORDER BY
    CASE l.status WHEN 'reserved' THEN 1 WHEN 'occupied' THEN 2 WHEN 'maintenance' THEN 3 WHEN 'available' THEN 4 ELSE 5 END,
    l.updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_housing_operations() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_housing_operations() TO authenticated;

COMMIT;
