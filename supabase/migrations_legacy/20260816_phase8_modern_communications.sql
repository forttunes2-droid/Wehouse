-- Phase 8 communications consolidation
-- Support: no new voice-note uploads.
-- Roommate + Worker booking chats: private media, participant-scoped presence,
-- and per-user inbox hiding without destroying the other participant's history.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachments text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS attachment_types text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS hidden_at_a timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_at_b timestamptz;

ALTER TABLE public.booking_conversations
  ADD COLUMN IF NOT EXISTS hidden_at_user timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_at_worker timestamptz;

-- Presence is already represented on profiles. Reset stale flags once, then use
-- a participant-checked heartbeat RPC. Online is also freshness-checked on read.
UPDATE public.profiles
SET is_online=false
WHERE COALESCE(is_online,false)=true
  AND (last_seen IS NULL OR last_seen < now()-interval '2 minutes');

CREATE OR REPLACE FUNCTION public.touch_my_presence(p_online boolean DEFAULT true)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_now timestamptz:=now();
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;

  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  UPDATE public.profiles
  SET is_online=COALESCE(p_online,true),last_seen=v_now,updated_at=now()
  WHERE user_id=v_actor.user_id;

  RETURN v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chat_peer_presence(p_peer_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_peer public.profiles;
  v_related boolean:=false;
  v_online boolean:=false;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_peer_user_id IS NULL OR p_peer_user_id=v_actor.user_id THEN RAISE EXCEPTION 'Peer required'; END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.conversations c
    WHERE c.conversation_type='roommate'
      AND ((c.participant_a=v_actor.user_id AND c.participant_b=p_peer_user_id)
        OR (c.participant_b=v_actor.user_id AND c.participant_a=p_peer_user_id))
      AND public._can_access_conversation(c.id)
  ) OR EXISTS(
    SELECT 1
    FROM public.booking_conversations bc
    WHERE (bc.user_id=v_actor.user_id AND bc.worker_id=p_peer_user_id)
       OR (bc.worker_id=v_actor.user_id AND bc.user_id=p_peer_user_id)
  ) INTO v_related;

  IF NOT v_related THEN RAISE EXCEPTION 'Chat relationship required'; END IF;

  SELECT * INTO v_peer
  FROM public.profiles
  WHERE user_id=p_peer_user_id
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;

  IF v_peer IS NULL THEN
    RETURN jsonb_build_object('visible',false,'online',false,'last_seen',NULL);
  END IF;

  IF COALESCE(v_peer.privacy_activity_visible,true)=false THEN
    RETURN jsonb_build_object('visible',false,'online',false,'last_seen',NULL);
  END IF;

  v_online:=COALESCE(v_peer.is_online,false)
    AND v_peer.last_seen IS NOT NULL
    AND v_peer.last_seen >= now()-interval '90 seconds';

  RETURN jsonb_build_object(
    'visible',true,
    'online',v_online,
    'last_seen',v_peer.last_seen
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_conversations(p_user_id text)
RETURNS SETOF public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE a public.profiles;
BEGIN
  a:=public._current_comm_actor();
  IF a IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_user_id IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'User identity mismatch'; END IF;

  RETURN QUERY
    SELECT c.*
    FROM public.conversations c
    WHERE (c.participant_a=a.user_id OR c.participant_b=a.user_id)
      AND public._can_access_conversation(c.id)
      AND public._conversation_route_allowed(c.id,a.user_id)
      AND (
        (c.participant_a=a.user_id AND (c.hidden_at_a IS NULL OR c.last_message_at>c.hidden_at_a))
        OR
        (c.participant_b=a.user_id AND (c.hidden_at_b IS NULL OR c.last_message_at>c.hidden_at_b))
      )
    ORDER BY c.last_message_at DESC NULLS LAST,c.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.hide_my_roommate_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_conv public.conversations;
BEGIN
  v_actor:=public._current_comm_actor();
  IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Regular user account required'; END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id=p_conversation_id AND conversation_type='roommate'
  FOR UPDATE;

  IF v_conv IS NULL OR v_actor.user_id NOT IN (v_conv.participant_a,v_conv.participant_b)
     OR NOT public._can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Roommate conversation unavailable';
  END IF;

  UPDATE public.messages
  SET seen=true
  WHERE conversation_id=p_conversation_id AND sender_id<>v_actor.user_id;

  IF v_conv.participant_a=v_actor.user_id THEN
    UPDATE public.conversations SET hidden_at_a=now(),unread_a=0 WHERE id=p_conversation_id;
  ELSE
    UPDATE public.conversations SET hidden_at_b=now(),unread_b=0 WHERE id=p_conversation_id;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_roommate_messages_v2(p_conversation_id uuid)
RETURNS TABLE(
  id uuid,
  conversation_id uuid,
  sender_id text,
  content text,
  seen boolean,
  created_at timestamptz,
  edited_at timestamptz,
  file_url text,
  file_name text,
  file_type text,
  attachments text[],
  attachment_types text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF NOT public._can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Not authorized for this conversation';
  END IF;

  RETURN QUERY
  SELECT m.id,m.conversation_id,m.sender_id,m.content,m.seen,m.created_at,m.edited_at,
         m.file_url,m.file_name,m.file_type,m.attachments,m.attachment_types
  FROM public.messages m
  WHERE m.conversation_id=p_conversation_id
  ORDER BY m.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_my_roommate_message_v2(
  p_conversation_id uuid,
  p_content text DEFAULT '',
  p_attachments text[] DEFAULT '{}'::text[],
  p_attachment_types text[] DEFAULT '{}'::text[]
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_conv public.conversations;
  v_message public.messages;
  v_path text;
  v_type text;
  v_i integer;
BEGIN
  v_actor:=public._current_comm_actor();
  IF v_actor IS NULL OR v_actor.role<>'user' THEN RAISE EXCEPTION 'Regular user account required'; END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id=p_conversation_id;
  IF v_conv IS NULL OR v_conv.conversation_type<>'roommate'
     OR v_actor.user_id NOT IN (v_conv.participant_a,v_conv.participant_b)
     OR NOT public._can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Roommate conversation unavailable';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_content,'')),'') IS NULL AND COALESCE(cardinality(p_attachments),0)=0 THEN
    RAISE EXCEPTION 'Message, photo or voice note is required';
  END IF;
  IF COALESCE(cardinality(p_attachments),0)>6 THEN RAISE EXCEPTION 'A maximum of 6 attachments can be sent at once'; END IF;
  IF COALESCE(cardinality(p_attachments),0)<>COALESCE(cardinality(p_attachment_types),0) THEN
    RAISE EXCEPTION 'Attachment metadata mismatch';
  END IF;

  IF COALESCE(cardinality(p_attachments),0)>0 THEN
    FOR v_i IN 1..cardinality(p_attachments) LOOP
      v_path:=p_attachments[v_i];
      v_type:=COALESCE(p_attachment_types[v_i],'');
      IF v_path IS NULL OR v_path NOT LIKE p_conversation_id::text||'/%' THEN
        RAISE EXCEPTION 'Invalid attachment path';
      END IF;
      IF v_type NOT LIKE 'image/%' AND v_type NOT LIKE 'audio/%' THEN
        RAISE EXCEPTION 'Roommate chat supports photos and voice notes only';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.messages(conversation_id,sender_id,content,seen,created_at,attachments,attachment_types)
  VALUES(
    p_conversation_id,
    v_actor.user_id,
    COALESCE(BTRIM(p_content),''),
    false,
    now(),
    COALESCE(p_attachments,'{}'::text[]),
    COALESCE(p_attachment_types,'{}'::text[])
  )
  RETURNING * INTO v_message;

  RETURN v_message;
END;
$$;

CREATE OR REPLACE FUNCTION public._sync_conversation_after_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  c public.conversations;
  v_preview text;
  v_type text;
BEGIN
  SELECT * INTO c FROM public.conversations WHERE id=NEW.conversation_id FOR UPDATE;
  IF c IS NULL THEN RETURN NEW; END IF;

  IF NULLIF(BTRIM(COALESCE(NEW.content,'')),'') IS NOT NULL THEN
    v_preview:=BTRIM(NEW.content);
  ELSIF COALESCE(cardinality(NEW.attachments),0)>0 THEN
    v_type:=COALESCE(NEW.attachment_types[1],'');
    IF v_type LIKE 'image/%' THEN v_preview:='Photo';
    ELSIF v_type LIKE 'audio/%' THEN v_preview:='Voice message';
    ELSE v_preview:='Attachment';
    END IF;
  ELSIF NEW.file_name IS NOT NULL THEN
    v_preview:='Attachment · '||NEW.file_name;
  ELSE
    v_preview:='New message';
  END IF;

  UPDATE public.conversations
  SET last_message=v_preview,
      last_message_at=NEW.created_at,
      unread_a=CASE WHEN c.participant_a=NEW.sender_id THEN c.unread_a ELSE COALESCE(c.unread_a,0)+1 END,
      unread_b=CASE WHEN c.participant_b=NEW.sender_id THEN c.unread_b ELSE COALESCE(c.unread_b,0)+1 END
  WHERE id=NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_my_booking_messages_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_conv public.booking_conversations;
BEGIN
  v_actor:=public._current_comm_actor();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_conv FROM public.booking_conversations WHERE id=p_conversation_id;
  IF v_conv IS NULL OR v_actor.user_id NOT IN (v_conv.user_id,v_conv.worker_id) THEN
    RAISE EXCEPTION 'Not authorized for this booking conversation';
  END IF;
  UPDATE public.booking_messages
  SET is_read=true
  WHERE conversation_id=p_conversation_id AND sender_id<>v_actor.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hide_my_booking_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_conv public.booking_conversations;
BEGIN
  v_actor:=public._current_comm_actor();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_conv FROM public.booking_conversations WHERE id=p_conversation_id FOR UPDATE;
  IF v_conv IS NULL OR v_actor.user_id NOT IN (v_conv.user_id,v_conv.worker_id) THEN
    RAISE EXCEPTION 'Not authorized for this booking conversation';
  END IF;

  UPDATE public.booking_messages
  SET is_read=true
  WHERE conversation_id=p_conversation_id AND sender_id<>v_actor.user_id;

  IF v_conv.user_id=v_actor.user_id THEN
    UPDATE public.booking_conversations SET hidden_at_user=now() WHERE id=p_conversation_id;
  ELSE
    UPDATE public.booking_conversations SET hidden_at_worker=now() WHERE id=p_conversation_id;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_booking_conversations_v2(p_user_id text)
RETURNS TABLE(
  conversation_id uuid,
  booking_id uuid,
  booking_code text,
  booking_status text,
  service_type text,
  negotiated_amount numeric,
  other_person_id text,
  other_person_name text,
  other_person_avatar text,
  last_message text,
  last_message_time timestamptz,
  unread_count bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE a public.profiles;
BEGIN
  a:=public._current_comm_actor();
  IF a IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_user_id IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'User identity mismatch'; END IF;

  RETURN QUERY
  SELECT
    bc.id,
    bc.booking_id,
    wb.booking_code,
    wb.status,
    wb.service_type,
    wb.negotiated_amount,
    CASE WHEN bc.user_id=a.user_id THEN bc.worker_id ELSE bc.user_id END,
    COALESCE(p.full_name,p.username,'WeHouse member'),
    p.avatar_url,
    CASE
      WHEN NULLIF(BTRIM(COALESCE(lm.content,'')),'') IS NOT NULL THEN lm.content
      WHEN COALESCE(cardinality(lm.attachments),0)>0 AND lm.attachments[1] ~* '\\.(webm|m4a|mp3|wav|ogg)(\\?|$)' THEN 'Voice message'
      WHEN COALESCE(cardinality(lm.attachments),0)>0 AND lm.attachments[1] ~* '\\.(jpg|jpeg|png|gif|webp)(\\?|$)' THEN 'Photo'
      WHEN COALESCE(cardinality(lm.attachments),0)>0 THEN 'Attachment'
      ELSE NULL
    END,
    lm.created_at,
    COALESCE(unread.count,0),
    GREATEST(bc.updated_at,COALESCE(lm.created_at,bc.updated_at))
  FROM public.booking_conversations bc
  JOIN public.worker_bookings wb ON wb.id=bc.booking_id
  JOIN public.profiles p ON p.user_id=CASE WHEN bc.user_id=a.user_id THEN bc.worker_id ELSE bc.user_id END
  LEFT JOIN LATERAL (
    SELECT bm.content,bm.attachments,bm.created_at
    FROM public.booking_messages bm
    WHERE bm.conversation_id=bc.id
    ORDER BY bm.created_at DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS count
    FROM public.booking_messages bm
    WHERE bm.conversation_id=bc.id
      AND COALESCE(bm.is_read,false)=false
      AND bm.sender_id<>a.user_id
  ) unread ON true
  WHERE (bc.user_id=a.user_id OR bc.worker_id=a.user_id)
    AND (
      (bc.user_id=a.user_id AND (bc.hidden_at_user IS NULL OR lm.created_at>bc.hidden_at_user))
      OR
      (bc.worker_id=a.user_id AND (bc.hidden_at_worker IS NULL OR lm.created_at>bc.hidden_at_worker))
    )
  ORDER BY GREATEST(bc.updated_at,COALESCE(lm.created_at,bc.updated_at)) DESC;
END;
$$;

-- Keep booking detail JSON compatible while adding avatars for the modern chat header.
CREATE OR REPLACE FUNCTION public.get_my_worker_booking_details(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_actor public.profiles;
  v_booking public.worker_bookings;
  v_customer public.profiles;
  v_worker public.profiles;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=auth.uid()::text
    AND COALESCE(deleted,false)=false
    AND COALESCE(suspended,false)=false
    AND COALESCE(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_booking FROM public.worker_bookings WHERE id=p_booking_id;
  IF v_booking IS NULL THEN RETURN NULL; END IF;
  IF v_actor.user_id IS DISTINCT FROM v_booking.user_id
     AND v_actor.user_id IS DISTINCT FROM v_booking.worker_id THEN
    RAISE EXCEPTION 'Booking participant access required';
  END IF;

  SELECT * INTO v_customer FROM public.profiles WHERE user_id=v_booking.user_id LIMIT 1;
  SELECT * INTO v_worker FROM public.profiles WHERE user_id=v_booking.worker_id LIMIT 1;

  RETURN jsonb_build_object(
    'id',v_booking.id,
    'booking_code',v_booking.booking_code,
    'status',v_booking.status,
    'service_type',v_booking.service_type,
    'description',v_booking.description,
    'address',v_booking.address,
    'negotiated_amount',v_booking.negotiated_amount,
    'agreed_amount',v_booking.agreed_amount,
    'scheduled_date',v_booking.scheduled_date,
    'created_at',v_booking.created_at,
    'updated_at',v_booking.updated_at,
    'user_id',v_booking.user_id,
    'worker_id',v_booking.worker_id,
    'user_name',COALESCE(v_customer.full_name,v_customer.username,'Customer'),
    'customer_username',v_customer.username,
    'user_avatar',v_customer.avatar_url,
    'worker_name',COALESCE(v_worker.full_name,v_worker.username,'Worker'),
    'worker_avatar',v_worker.avatar_url
  );
END;
$$;

-- Extend the existing private chat-files bucket to mutually accepted roommate chats.
DROP POLICY IF EXISTS "chat-files-roommate-insert" ON storage.objects;
CREATE POLICY "chat-files-roommate-insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='chat-files'
  AND EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id::text=(storage.foldername(objects.name))[1]
      AND c.conversation_type='roommate'
      AND public._can_access_conversation(c.id)
  )
);

DROP POLICY IF EXISTS "chat-files-roommate-select" ON storage.objects;
CREATE POLICY "chat-files-roommate-select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='chat-files'
  AND EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id::text=(storage.foldername(objects.name))[1]
      AND c.conversation_type='roommate'
      AND public._can_access_conversation(c.id)
  )
);

DROP POLICY IF EXISTS "chat-files-owner-delete" ON storage.objects;
CREATE POLICY "chat-files-owner-delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='chat-files' AND owner=auth.uid());

-- Support remains file/photo/document based. Existing historical audio objects remain readable,
-- but the bucket no longer accepts new voice-note MIME types.
UPDATE storage.buckets
SET allowed_mime_types=ARRAY[
  'image/jpeg','image/png','image/webp','image/gif',
  'application/pdf','text/plain','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]::text[]
WHERE id='support-files';

GRANT EXECUTE ON FUNCTION public.touch_my_presence(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_peer_presence(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hide_my_roommate_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_roommate_messages_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_my_roommate_message_v2(uuid,text,text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_my_booking_messages_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hide_my_booking_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_booking_conversations_v2(text) TO authenticated;
