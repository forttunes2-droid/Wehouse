\set ON_ERROR_STOP on
begin;
create temporary table prerequisite_before on commit drop as
 select * from public.creator_policy_versions;
\ir ../migrations/20261023111611_accommodation_cancellation_policy_prerequisite.sql
\ir ../migrations/20261023111611_accommodation_cancellation_policy_prerequisite.sql
do $$ begin
 if exists(
  (select * from public.creator_policy_versions except select * from prerequisite_before)
  union all
  (select * from prerequisite_before except select * from public.creator_policy_versions)
 ) then raise exception 'Retry rewrote existing policy history';end if;
 if not exists(select 1 from public.creator_policy_versions
  where policy_key='hotel_standard_cancellation' and scope_type='global'
   and scope_key='*' and status='active'
   and value->>'full_refund_hours_before_check_in'='24'
   and value->>'payment_protection_required'='true') then
  raise exception 'Fresh replay did not publish the approved protected Hotel deadline';
 end if;
 if not exists(select 1 from public.creator_policy_versions
  where policy_key='accommodation_non_refundable_rate' and scope_type='global'
   and scope_key='*' and status='active'
   and value->>'provider_failure_overrides_non_refundable'='true') then
  raise exception 'Fresh replay omitted non-refundable provider-failure protection';
 end if;
end $$;
rollback;
