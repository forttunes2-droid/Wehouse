-- Phase 8: Support should become a real case only after a real message exists.
-- Remove legacy empty shells created by opening Support, and keep the member
-- thread reader aligned with the management inbox rule.

DELETE FROM public.partner_support_conversations c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.partner_support_messages m
  WHERE m.conversation_id = c.id
);

CREATE OR REPLACE FUNCTION public.get_my_support_conversations()
RETURNS TABLE(
  conversation_id uuid,
  subject text,
  status text,
  category text,
  context_type text,
  context_id text,
  context_snapshot jsonb,
  priority text,
  assigned_staff_name text,
  last_message text,
  last_message_time timestamptz,
  unread_count bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
  LIMIT 1;

  IF v_actor.user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    'WeHouse Support'::text,
    c.status,
    c.category,
    c.context_type,
    c.context_id,
    c.context_snapshot,
    c.priority,
    COALESCE(s.full_name,s.username),
    (
      SELECT CASE
        WHEN NULLIF(BTRIM(m.content),'') IS NOT NULL THEN m.content
        WHEN COALESCE(cardinality(m.attachments),0)>0 THEN 'Attachment'
        ELSE ''
      END
      FROM public.partner_support_messages m
      WHERE m.conversation_id=c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ),
    (
      SELECT m.created_at
      FROM public.partner_support_messages m
      WHERE m.conversation_id=c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ),
    (
      SELECT COUNT(*)
      FROM public.partner_support_messages m
      WHERE m.conversation_id=c.id
        AND COALESCE(m.is_read,false)=false
        AND m.sender_id<>v_actor.user_id
    ),
    c.created_at
  FROM public.partner_support_conversations c
  LEFT JOIN public.profiles s ON s.user_id=c.assigned_staff_id
  WHERE c.partner_id=v_actor.user_id
    AND EXISTS (
      SELECT 1
      FROM public.partner_support_messages first_message
      WHERE first_message.conversation_id=c.id
    )
  ORDER BY c.updated_at DESC
  LIMIT 1;
END
$function$;
