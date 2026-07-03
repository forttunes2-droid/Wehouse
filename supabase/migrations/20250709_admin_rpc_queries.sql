-- ═══════════════════════════════════════════════════════════════
-- RPC: Admin query functions (bypass RLS completely)
-- These run as SECURITY DEFINER = postgres privileges
-- ═══════════════════════════════════════════════════════════════

-- 1. Get ALL users (creator dashboard)
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS SETOF public.profiles
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.profiles ORDER BY created_at DESC;
$$;

-- 2. Get ALL listings (admin dashboard)
CREATE OR REPLACE FUNCTION public.admin_get_all_listings()
RETURNS SETOF public.listings
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.listings ORDER BY created_at DESC;
$$;

-- 3. Get ALL workers
CREATE OR REPLACE FUNCTION public.admin_get_all_workers()
RETURNS SETOF public.profiles
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.profiles 
  WHERE role = 'worker' 
  ORDER BY created_at DESC;
$$;

-- 4. Get user count
CREATE OR REPLACE FUNCTION public.admin_get_user_count()
RETURNS TABLE(total bigint, today bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    (SELECT COUNT(*) FROM public.profiles) as total,
    (SELECT COUNT(*) FROM public.profiles WHERE created_at >= date_trunc('day', now())) as today;
$$;

-- 5. Get ALL conversations (for staff shared inbox)
CREATE OR REPLACE FUNCTION public.admin_get_support_conversations()
RETURNS SETOF public.conversations
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.conversations 
  WHERE conversation_type = 'partner_support'
  ORDER BY last_message_at DESC NULLS LAST;
$$;

-- 6. Get conversations for a user (bypass RLS)
CREATE OR REPLACE FUNCTION public.get_user_conversations(p_user_id text)
RETURNS SETOF public.conversations
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.conversations 
  WHERE participant_a = p_user_id OR participant_b = p_user_id
  ORDER BY last_message_at DESC NULLS LAST;
$$;

-- 7. Get messages for a conversation
CREATE OR REPLACE FUNCTION public.get_conversation_messages(p_conversation_id text)
RETURNS SETOF public.messages
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.messages 
  WHERE conversation_id = p_conversation_id
  ORDER BY created_at ASC;
$$;
