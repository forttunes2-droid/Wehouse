-- BLOCK 3: Chat RPC functions
-- Creates inspection chat and general support chat functions

CREATE OR REPLACE FUNCTION public.start_partner_inspection_chat(p_partner_id TEXT)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_conv public.conversations;
  new_conv public.conversations;
BEGIN
  SELECT * INTO existing_conv FROM public.conversations
  WHERE participant_a = p_partner_id
    AND participant_b = 'wehouse_support'
    AND conversation_type = 'partner_inspection'
  LIMIT 1;

  IF existing_conv.id IS NOT NULL THEN
    RETURN existing_conv;
  END IF;

  INSERT INTO public.conversations (participant_a, participant_b, status, conversation_type, subject)
  VALUES (p_partner_id, 'wehouse_support', 'active', 'partner_inspection', 'Property Inspection Request')
  RETURNING * INTO new_conv;

  RETURN new_conv;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_general_support_chat(p_user_id TEXT)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_conv public.conversations;
  new_conv public.conversations;
BEGIN
  SELECT * INTO existing_conv FROM public.conversations
  WHERE participant_a = p_user_id
    AND participant_b = 'wehouse_support'
    AND conversation_type = 'general_support'
  LIMIT 1;

  IF existing_conv.id IS NOT NULL THEN
    RETURN existing_conv;
  END IF;

  INSERT INTO public.conversations (participant_a, participant_b, status, conversation_type, subject)
  VALUES (p_user_id, 'wehouse_support', 'active', 'general_support', 'General Support')
  RETURNING * INTO new_conv;

  RETURN new_conv;
END;
$$;
