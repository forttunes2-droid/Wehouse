-- The parent command authenticates the trusted session, canonical workspace grants
-- and geographic scope. Its returned IDs are the only rows this projection joins.
-- Invoker RLS otherwise silently discards those rows for additive workspace grants
-- when the person's base profile remains Personal. Do not broaden table policies.
alter function public.get_my_property_pipeline_v2(text) security definer;
alter function public.get_my_property_pipeline_v2(text) set search_path to pg_catalog,public;
revoke all on function public.get_my_property_pipeline_v2(text) from public,anon,service_role;
grant execute on function public.get_my_property_pipeline_v2(text) to authenticated;
