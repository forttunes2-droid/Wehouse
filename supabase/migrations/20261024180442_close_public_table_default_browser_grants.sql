-- New tables must opt in to browser access with reviewed grants and RLS.
-- Keep service maintenance available; this does not change existing table ACLs.
alter default privileges for role postgres in schema public
 revoke all on tables from public,anon,authenticated;
alter default privileges for role postgres in schema public
 grant all on tables to service_role;
