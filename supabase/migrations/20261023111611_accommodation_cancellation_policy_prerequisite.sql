-- Missing-only prerequisite for the already-recorded 24-hour rollout.
-- Ordered immediately before 20261023111612: its predecessor assumed Creator
-- had already published Hotel rules. Never rewrite that applied migration or
-- replace an existing draft, scheduled rule, policy history or booking snapshot.
do $$
declare item record; rollout_at timestamptz:=now();
begin
 lock table public.creator_policy_versions in share row exclusive mode;
 for item in select * from (values
  ('hotel_standard_cancellation',
   '{"full_refund_hours_before_check_in":24,"late_cancellation_requires_review":true,"provider_failure_full_refund":true,"payment_protection_required":true}'::jsonb,
   'cancellation_policy',
   'Standard refundable Hotel bookings: full refund until 24 hours before check-in. The booking displays its exact deadline and saved terms.'),
  ('accommodation_non_refundable_rate',
   '{"minimum_discount_percent":1,"maximum_discount_percent":30,"guest_cancellation_refund_percent":0,"no_show_provider_eligible_after_review":true,"security_deposit_full_refund_without_occupancy":true,"provider_failure_overrides_non_refundable":true,"payment_or_listing_mismatch_reviewable":true,"payment_protection_required":true}'::jsonb,
   'accommodation_rate_terms',
   'A lower non-refundable accommodation price remains protected against provider failure, payment error and listing mismatch.')
 ) as rules(policy_key,value,schema_type,disclosure) loop
  if exists(select 1 from public.creator_policy_versions p where
    p.policy_key=item.policy_key and p.scope_type='global' and p.scope_key='*') then
   continue;
  end if;
  insert into public.creator_policy_versions(policy_key,scope_type,scope_key,version,
   value,value_schema,status,effective_from,public_disclosure,disclosure_text,
   legal_review_state,reason,checksum,published_at)
  values(item.policy_key,'global','*',1,item.value,
   jsonb_build_object('type',item.schema_type),'active',rollout_at,true,item.disclosure,
   'pending','Restore missing accommodation policy prerequisite; preserve all existing versions.',
   md5(item.policy_key||':1:'||item.value::text),rollout_at);
 end loop;
end $$;
