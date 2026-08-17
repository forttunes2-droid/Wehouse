-- Field Officer: normalize partner_id to text in the combined inspection projection.
-- Support: an opened-but-empty support shell must not appear in the staff/creator inbox.

CREATE OR REPLACE FUNCTION public.get_my_inspections(p_field_officer_id text)
RETURNS TABLE(
  id uuid, inspection_code text, property_address text, property_city text, property_state text,
  property_type text, status text, owner_id text, owner_name text, owner_email text, owner_phone text,
  notes text, field_officer_id text, partner_id text, scheduled_date timestamptz, completed_at timestamptz,
  created_at timestamptz, photo_urls text[], document_urls text[], _source text,
  gps_latitude numeric, gps_longitude numeric, location_accuracy_m numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role<>'staff' OR v_actor.user_id<>p_field_officer_id OR NOT public.current_staff_has_permission('field_officer') THEN
    RAISE EXCEPTION 'Field Officer access required';
  END IF;

  RETURN QUERY
  SELECT ir.id,ir.request_code,ir.property_address,ir.property_city,ir.property_state,ir.property_type,ir.status,
         ir.owner_id,COALESCE(p.full_name,p.username,p.email),ir.owner_email,ir.owner_phone,ir.notes,
         COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to),ir.partner_id::text,
         ir.scheduled_date::timestamptz,ir.completed_at,ir.created_at,ir.photo_urls,ir.document_urls,'partner'::text,
         ir.gps_latitude,ir.gps_longitude,ir.location_accuracy_m
  FROM public.inspection_requests ir
  LEFT JOIN public.profiles p ON p.user_id=ir.owner_id
  WHERE COALESCE(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)=v_actor.user_id
  UNION ALL
  SELECT ur.id,COALESCE(ur.reservation_id,ur.id::text),COALESCE(l.address,l.title,'Reserved property'),l.city,l.state,
         l.property_type::text,ur.status,ur.user_id,COALESCE(u.full_name,u.username,u.email),u.email,u.phone,ur.notes,
         ur.field_officer_id,NULL::text,ur.scheduled_date,NULL::timestamptz,ur.created_at,ur.photo_urls,ARRAY[]::text[],
         'user'::text,l.gps_latitude,l.gps_longitude,NULL::numeric
  FROM public.user_inspection_requests ur
  LEFT JOIN public.listings l ON l.listing_id=ur.listing_id OR l.id::text=ur.listing_id
  LEFT JOIN public.profiles u ON u.user_id=ur.user_id
  WHERE ur.field_officer_id=v_actor.user_id
  ORDER BY created_at DESC;
END
$function$;

REVOKE ALL ON FUNCTION public.get_my_inspections(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_inspections(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_inspections(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.support_inbox()
RETURNS TABLE(
  conversation_id uuid, requester_id text, requester_role text, requester_name text, requester_email text,
  requester_state text, requester_lga text, subject text, status text, category text, context_type text,
  context_id text, context_snapshot jsonb, priority text, assigned_staff_id text, assigned_staff_name text,
  last_message text, last_message_time timestamptz, unread_count bigint, created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_actor public.profiles; v_staff_ok boolean:=false;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor.user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_actor.role='staff' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.staff_permissions sp
      WHERE sp.staff_id=v_actor.user_id AND sp.permission='support'
        AND COALESCE(sp.is_active,true)=true AND sp.revoked_at IS NULL
    ) INTO v_staff_ok;
  END IF;
  IF v_actor.role NOT IN ('admin','creator') AND NOT v_staff_ok THEN RAISE EXCEPTION 'Support team access required'; END IF;

  RETURN QUERY
  SELECT c.id,c.partner_id,COALESCE(c.requester_role,p.role),COALESCE(p.full_name,p.username,p.email),p.email,p.state,
         COALESCE(NULLIF(p.local_government,''),p.city),'WeHouse Support'::text,c.status,c.category,c.context_type,c.context_id,
         c.context_snapshot,c.priority,c.assigned_staff_id,COALESCE(s.full_name,s.username),
         (SELECT CASE WHEN NULLIF(BTRIM(m.content),'') IS NOT NULL THEN m.content
                      WHEN COALESCE(cardinality(m.attachments),0)>0 THEN 'Attachment' ELSE '' END
            FROM public.partner_support_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1),
         (SELECT m.created_at FROM public.partner_support_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1),
         (SELECT COUNT(*) FROM public.partner_support_messages m
            WHERE m.conversation_id=c.id AND COALESCE(m.is_read,false)=false AND m.sender_id<>v_actor.user_id),
         c.created_at
  FROM public.partner_support_conversations c
  JOIN public.profiles p ON p.user_id=c.partner_id
  LEFT JOIN public.profiles s ON s.user_id=c.assigned_staff_id
  WHERE EXISTS (SELECT 1 FROM public.partner_support_messages first_message WHERE first_message.conversation_id=c.id)
    AND (v_actor.role='creator' OR (p.state=v_actor.assigned_state AND COALESCE(NULLIF(p.local_government,''),p.city)=v_actor.assigned_lga))
    AND (v_actor.role<>'staff' OR c.assigned_staff_id IS NULL OR c.assigned_staff_id=v_actor.user_id)
  ORDER BY CASE WHEN c.assigned_staff_id=v_actor.user_id THEN 0 WHEN c.assigned_staff_id IS NULL THEN 1 ELSE 2 END,
           (SELECT MAX(m.created_at) FROM public.partner_support_messages m WHERE m.conversation_id=c.id) DESC NULLS LAST,
           c.updated_at DESC;
END
$function$;

REVOKE ALL ON FUNCTION public.support_inbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.support_inbox() FROM anon;
GRANT EXECUTE ON FUNCTION public.support_inbox() TO authenticated;
