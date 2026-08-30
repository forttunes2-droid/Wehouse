-- Conversation RLS policies execute this authenticated-safe wrapper. Revoking
-- it breaks every participant read/write policy even though the helper is not
-- intended as a standalone browser API.
REVOKE ALL ON FUNCTION public.can_access_my_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_my_conversation(uuid) TO authenticated;

