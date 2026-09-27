-- Close PostgreSQL table-level privileges that are not governed by RLS.
-- Browser actors may read only their scoped property assignments; Host messages
-- and conversations stay RPC-only. TRUNCATE/REFERENCES/TRIGGER are never browser authority.

revoke all on table public.property_host_assignments from anon,authenticated;
grant select on table public.property_host_assignments to authenticated;

revoke all on table public.property_host_conversations from anon,authenticated;
revoke all on table public.property_host_messages from anon,authenticated;

revoke all on table public.creator_security_credentials from anon,authenticated;
