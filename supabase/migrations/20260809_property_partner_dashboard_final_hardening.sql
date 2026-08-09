BEGIN;

-- Property inspection requests are created only through the authenticated RPC.
ALTER TABLE public.inspection_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inspection_requests_all ON public.inspection_requests;
DROP POLICY IF EXISTS ir_insert ON public.inspection_requests;
DROP POLICY IF EXISTS ir_partner_select ON public.inspection_requests;
DROP POLICY IF EXISTS ir_select ON public.inspection_requests;
DROP POLICY IF EXISTS ir_update ON public.inspection_requests;

CREATE POLICY inspection_requests_partner_read
ON public.inspection_requests
FOR SELECT TO authenticated
USING (
  owner_id = (
    SELECT p.user_id FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
      AND p.role = 'property_partner'
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
    LIMIT 1
  )
);

CREATE POLICY inspection_requests_staff_read
ON public.inspection_requests
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
      AND p.role IN ('staff','admin','creator')
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
  )
);

CREATE POLICY inspection_requests_staff_update
ON public.inspection_requests
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
      AND p.role IN ('staff','admin','creator')
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_id = auth.uid()::text
      AND p.role IN ('staff','admin','creator')
      AND COALESCE(p.deleted,false)=false
      AND COALESCE(p.suspended,false)=false
      AND COALESCE(p.banned,false)=false
  )
);

CREATE OR REPLACE FUNCTION public.create_partner_support_conversation(
  p_partner_id text,
  p_subject text,
  p_property_name text,
  p_property_address text,
  p_property_city text,
  p_property_state text,
  p_property_type text DEFAULT 'support',
  p_rental_mode text DEFAULT 'general'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor record;
  v_conv_id uuid;
BEGIN
  SELECT user_id, role, deleted, suspended, banned INTO v_actor
  FROM public.profiles WHERE auth_id = auth.uid()::text LIMIT 1;
  IF v_actor IS NULL OR v_actor.role <> 'property_partner' THEN
    RAISE EXCEPTION 'Property Partner account required';
  END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;
  IF p_partner_id IS DISTINCT FROM v_actor.user_id THEN
    RAISE EXCEPTION 'Partner identity mismatch';
  END IF;
  IF NULLIF(btrim(p_subject),'') IS NULL THEN RAISE EXCEPTION 'Subject is required'; END IF;

  INSERT INTO public.partner_support_conversations(
    partner_id, subject, status, property_name, property_address,
    property_city, property_state, property_type, rental_mode, created_at, updated_at
  ) VALUES (
    v_actor.user_id, btrim(p_subject), 'open', NULLIF(btrim(p_property_name),''),
    NULLIF(btrim(p_property_address),''), NULLIF(btrim(p_property_city),''),
    NULLIF(btrim(p_property_state),''), NULLIF(btrim(p_property_type),''),
    NULLIF(btrim(p_rental_mode),''), now(), now()
  ) RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_partner_conversations(p_partner_id text)
RETURNS TABLE(
  conversation_id uuid, subject text, status text, property_name text,
  property_address text, rental_mode text, assigned_staff_name text,
  assigned_officer_name text, last_message text, last_message_time timestamptz,
  unread_count bigint, created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_actor record;
BEGIN
  SELECT user_id, role, deleted, suspended, banned INTO v_actor
  FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;
  IF v_actor.role='property_partner' AND p_partner_id IS DISTINCT FROM v_actor.user_id THEN RAISE EXCEPTION 'Partner identity mismatch'; END IF;
  IF v_actor.role NOT IN ('property_partner','staff','admin','creator') THEN RAISE EXCEPTION 'Not authorised'; END IF;

  RETURN QUERY
  SELECT psc.id, psc.subject, psc.status, psc.property_name, psc.property_address,
         psc.rental_mode, s.full_name, o.full_name,
         (SELECT m.content FROM public.partner_support_messages m WHERE m.conversation_id=psc.id ORDER BY m.created_at DESC LIMIT 1),
         (SELECT m.created_at FROM public.partner_support_messages m WHERE m.conversation_id=psc.id ORDER BY m.created_at DESC LIMIT 1),
         (SELECT count(*) FROM public.partner_support_messages m WHERE m.conversation_id=psc.id AND COALESCE(m.is_read,false)=false AND m.sender_role <> 'partner'),
         psc.created_at
  FROM public.partner_support_conversations psc
  LEFT JOIN public.profiles s ON s.user_id=psc.assigned_staff_id
  LEFT JOIN public.profiles o ON o.user_id=psc.assigned_field_officer_id
  WHERE psc.partner_id=p_partner_id
    AND (v_actor.role IN ('staff','admin','creator') OR psc.partner_id=v_actor.user_id)
  ORDER BY psc.updated_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_partner_support_messages(p_conversation_id uuid)
RETURNS TABLE(id uuid, sender_id text, sender_name text, sender_role text, content text,
 attachments text[], attachment_types text[], action_type text, action_metadata jsonb,
 is_read boolean, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_actor record; v_conv record;
BEGIN
  SELECT user_id,role,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;
  SELECT * INTO v_conv FROM public.partner_support_conversations WHERE id=p_conversation_id;
  IF v_conv IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF NOT (v_actor.user_id=v_conv.partner_id OR v_actor.user_id=v_conv.assigned_staff_id OR v_actor.user_id=v_conv.assigned_field_officer_id OR v_actor.role IN ('admin','creator')) THEN RAISE EXCEPTION 'Not authorised'; END IF;
  RETURN QUERY SELECT m.id,m.sender_id,COALESCE(p.full_name,'WeHouse'),m.sender_role,m.content,m.attachments,m.attachment_types,m.action_type,m.action_metadata,m.is_read,m.created_at
  FROM public.partner_support_messages m LEFT JOIN public.profiles p ON p.user_id=m.sender_id
  WHERE m.conversation_id=p_conversation_id ORDER BY m.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_partner_support_message(p_conversation_id uuid,p_sender_id text,p_content text,p_sender_role text DEFAULT 'partner')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_actor record; v_conv record; v_message_id uuid; v_role text;
BEGIN
  SELECT user_id,role,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF COALESCE(v_actor.deleted,false) OR COALESCE(v_actor.suspended,false) OR COALESCE(v_actor.banned,false) THEN RAISE EXCEPTION 'Account is not active'; END IF;
  SELECT * INTO v_conv FROM public.partner_support_conversations WHERE id=p_conversation_id FOR UPDATE;
  IF v_conv IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF NOT (v_actor.user_id=v_conv.partner_id OR v_actor.user_id=v_conv.assigned_staff_id OR v_actor.user_id=v_conv.assigned_field_officer_id OR v_actor.role IN ('admin','creator')) THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF p_sender_id IS DISTINCT FROM v_actor.user_id THEN RAISE EXCEPTION 'Sender identity mismatch'; END IF;
  IF NULLIF(btrim(p_content),'') IS NULL THEN RAISE EXCEPTION 'Message is required'; END IF;
  v_role := CASE WHEN v_actor.role='property_partner' THEN 'partner' WHEN v_actor.user_id=v_conv.assigned_field_officer_id THEN 'field_officer' WHEN v_actor.role='creator' THEN 'creator' ELSE 'staff' END;
  IF p_sender_role IS DISTINCT FROM v_role THEN RAISE EXCEPTION 'Sender role mismatch'; END IF;
  INSERT INTO public.partner_support_messages(conversation_id,sender_id,sender_role,content,created_at)
  VALUES(p_conversation_id,v_actor.user_id,v_role,btrim(p_content),now()) RETURNING id INTO v_message_id;
  UPDATE public.partner_support_conversations SET updated_at=now() WHERE id=p_conversation_id;
  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_partner_messages_read(p_conversation_id uuid,p_reader_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_actor record; v_conv record; v_role text;
BEGIN
  SELECT user_id,role,deleted,suspended,banned INTO v_actor FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_conv FROM public.partner_support_conversations WHERE id=p_conversation_id;
  IF v_conv IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF NOT (v_actor.user_id=v_conv.partner_id OR v_actor.user_id=v_conv.assigned_staff_id OR v_actor.user_id=v_conv.assigned_field_officer_id OR v_actor.role IN ('admin','creator')) THEN RAISE EXCEPTION 'Not authorised'; END IF;
  v_role := CASE WHEN v_actor.role='property_partner' THEN 'partner' WHEN v_actor.user_id=v_conv.assigned_field_officer_id THEN 'field_officer' WHEN v_actor.role='creator' THEN 'creator' ELSE 'staff' END;
  IF p_reader_role IS DISTINCT FROM v_role THEN RAISE EXCEPTION 'Reader role mismatch'; END IF;
  UPDATE public.partner_support_messages SET is_read=true WHERE conversation_id=p_conversation_id AND sender_role<>v_role AND COALESCE(is_read,false)=false;
END;
$$;

REVOKE ALL ON FUNCTION public.create_partner_support_conversation(text,text,text,text,text,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_partner_conversations(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_partner_support_messages(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.send_partner_support_message(uuid,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.mark_partner_messages_read(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_partner_support_conversation(text,text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_conversations(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_support_messages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_partner_support_message(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_partner_messages_read(uuid,text) TO authenticated;

COMMIT;
