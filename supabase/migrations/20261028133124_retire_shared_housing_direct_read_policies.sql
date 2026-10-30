-- These old direct-read policies recurse through shared_housing_members and
-- compare Auth UUIDs to product actor IDs. Scoped group commands already own
-- the supported read model; keep both compatibility tables private by default.
drop policy if exists shared_housing_groups_member_read on public.shared_housing_groups;
drop policy if exists shared_housing_members_member_read on public.shared_housing_members;
create policy canonical_rpc_only on public.shared_housing_groups
 for all to anon,authenticated using(false) with check(false);
create policy canonical_rpc_only on public.shared_housing_members
 for all to anon,authenticated using(false) with check(false);
