-- Align the hosted predecessor with the replayed policy interval contract.
-- Only a retired version may have a zero-length effective interval.
-- Existing policy values and accepted booking snapshots remain untouched.
alter table public.creator_policy_versions drop constraint creator_policy_versions_check;
alter table public.creator_policy_versions add constraint creator_policy_versions_check
 check(effective_until is null or effective_until>effective_from
  or (status='retired' and effective_until=effective_from));
