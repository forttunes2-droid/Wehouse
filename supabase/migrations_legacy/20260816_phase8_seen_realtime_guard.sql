-- Phase 8 realtime guard: only write read/seen state when it actually changes.
CREATE OR REPLACE FUNCTION public.mark_my_conversation_seen(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE a public.profiles; c public.conversations;
BEGIN
  SELECT * INTO a FROM public.profiles WHERE auth_id=auth.uid()::text LIMIT 1;
  IF a IS NULL OR NOT public._can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Not authorized for this conversation';
  END IF;

  SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id FOR UPDATE;

  UPDATE public.messages
  SET seen=true
  WHERE conversation_id=p_conversation_id
    AND sender_id<>a.user_id
    AND COALESCE(seen,false)=false;

  IF c.participant_a=a.user_id AND COALESCE(c.unread_a,0)<>0 THEN
    UPDATE public.conversations SET unread_a=0 WHERE id=p_conversation_id;
  ELSIF c.participant_b=a.user_id AND COALESCE(c.unread_b,0)<>0 THEN
    UPDATE public.conversations SET unread_b=0 WHERE id=p_conversation_id;
  END IF;
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

  SELECT * INTO v_conv
  FROM public.booking_conversations
  WHERE id=p_conversation_id;

  IF v_conv IS NULL OR v_actor.user_id NOT IN (v_conv.user_id,v_conv.worker_id) THEN
    RAISE EXCEPTION 'Not authorized for this booking conversation';
  END IF;

  UPDATE public.booking_messages
  SET is_read=true
  WHERE conversation_id=p_conversation_id
    AND sender_id<>v_actor.user_id
    AND COALESCE(is_read,false)=false;
END;
$$;
