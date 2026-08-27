-- `_can_access_conversation` is an authorization predicate used by RLS policies
-- on conversations, messages, and roommate chat storage objects. Those policies
-- execute as the signed-in database role, so authenticated users need EXECUTE on
-- the predicate even though it must remain unavailable to anonymous callers.
--
-- The function returns only a boolean and derives the actor from auth.uid(); it
-- does not accept an actor/user id from the caller or expose conversation data.
revoke execute on function public._can_access_conversation(uuid) from public, anon;
grant execute on function public._can_access_conversation(uuid) to authenticated, service_role;

-- Keep the lower-level route predicate internal. It is reached only while the
-- SECURITY DEFINER wrapper above executes as its owner.
revoke execute on function public._conversation_route_allowed(uuid, text) from public, anon, authenticated;
grant execute on function public._conversation_route_allowed(uuid, text) to service_role;
