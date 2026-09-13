-- Canonical postflight: make relationship lookups index-backed, remove a
-- compatibility duplicate, and capture the final function execution surface.

create index if not exists activity_audience_recipient_fk_idx
  on public.activity_event_audiences(recipient_user_id);
create index if not exists canonical_thread_items_thread_fk_idx
  on public.canonical_thread_items(thread_id);
create index if not exists canonical_thread_items_sender_fk_idx
  on public.canonical_thread_items(sender_user_id);
create index if not exists canonical_thread_participant_user_fk_idx
  on public.canonical_thread_participants(user_id);
create index if not exists canonical_thread_continuation_fk_idx
  on public.canonical_threads(continuation_of_thread_id);
create index if not exists caution_claim_protection_fk_idx
  on public.caution_claims(payment_protection_id);
create index if not exists caution_evidence_claim_fk_idx
  on public.caution_evidence(caution_claim_id);
create index if not exists caution_evidence_reservation_fk_idx
  on public.caution_evidence(reservation_id);
create index if not exists caution_evidence_submitter_fk_idx
  on public.caution_evidence(submitted_by);
create index if not exists creator_elevation_user_fk_idx
  on public.creator_elevation_grants(creator_user_id);
create index if not exists creator_policy_approved_by_fk_idx
  on public.creator_policy_versions(approved_by);
create index if not exists creator_policy_created_by_fk_idx
  on public.creator_policy_versions(created_by);
create index if not exists creator_policy_supersedes_fk_idx
  on public.creator_policy_versions(supersedes);
create index if not exists financial_outbox_protection_fk_idx
  on public.financial_action_outbox(payment_protection_id);
create index if not exists function_registry_reviewer_fk_idx
  on public.function_execution_registry(reviewed_by);
create index if not exists hotel_integration_creator_fk_idx
  on public.hotel_integrations(created_by);
create index if not exists hotel_transition_booking_fk_idx
  on public.hotel_stay_transitions(hotel_booking_id);
create index if not exists hotel_transition_policy_fk_idx
  on public.hotel_stay_transitions(policy_version_id);
create index if not exists ledger_transaction_provider_event_fk_idx
  on public.ledger_transactions(provider_event_id);
create index if not exists long_let_transition_policy_fk_idx
  on public.long_let_reservation_transitions(policy_version_id);
create index if not exists long_let_transition_reservation_fk_idx
  on public.long_let_reservation_transitions(reservation_id);
create index if not exists obligation_snapshot_policy_fk_idx
  on public.obligation_policy_snapshots(policy_version_id);
create index if not exists operational_case_event_case_fk_idx
  on public.operational_case_events(operational_case_id);
create index if not exists operational_case_evidence_case_fk_idx
  on public.operational_case_evidence(operational_case_id);
create index if not exists operational_case_evidence_submitter_fk_idx
  on public.operational_case_evidence(submitted_by);
create index if not exists operational_case_assignee_fk_idx
  on public.operational_cases(assigned_user_id);
create index if not exists operational_case_requester_fk_idx
  on public.operational_cases(requester_user_id);
create index if not exists protection_transition_ledger_fk_idx
  on public.payment_protection_transitions(ledger_transaction_id);
create index if not exists protection_transition_parent_fk_idx
  on public.payment_protection_transitions(payment_protection_id);
create index if not exists payout_change_bank_account_fk_idx
  on public.payout_account_change_requests(bank_account_id);
create index if not exists policy_receipt_version_fk_idx
  on public.policy_acceptance_receipts(policy_version_id);
create index if not exists shared_payment_creator_fk_idx
  on public.shared_payment_groups(created_by);
create index if not exists shared_payment_policy_fk_idx
  on public.shared_payment_groups(policy_version_id);
create index if not exists shared_payment_reservation_fk_idx
  on public.shared_payment_groups(reservation_id);
create index if not exists shared_payment_member_user_fk_idx
  on public.shared_payment_members(user_id);
create index if not exists short_let_transition_policy_fk_idx
  on public.short_let_booking_transitions(policy_version_id);
create index if not exists short_let_transition_reservation_fk_idx
  on public.short_let_booking_transitions(reservation_id);
create index if not exists worker_reminder_requester_fk_idx
  on public.worker_completion_reminder_requests(requested_by);
create index if not exists worker_transition_policy_fk_idx
  on public.worker_job_transitions(policy_version_id);
create index if not exists worker_transition_booking_fk_idx
  on public.worker_job_transitions(worker_booking_id);

-- One SELECT policy avoids evaluating two permissive policies for every
-- authenticated policy-registry read.
drop policy if exists creator_policy_public_read
  on public.creator_policy_versions;
drop policy if exists creator_policy_creator_read
  on public.creator_policy_versions;
drop policy if exists creator_policy_read
  on public.creator_policy_versions;
create policy creator_policy_read
on public.creator_policy_versions for select to anon,authenticated
using(
  (
    public_disclosure=true and status='active' and effective_from<=now()
    and (effective_until is null or effective_until>now())
  )
  or public.current_actor_has_workspace('creator',null)
);

-- Older schemas already have a unique constraint for this pair. Keep the
-- compatibility index only when it is the sole unique implementation.
do $deduplicate$
declare v_exact_unique_count integer;
begin
  select count(*) into v_exact_unique_count
  from pg_index index_record
  where index_record.indrelid='public.hotel_team_members'::regclass
    and index_record.indisunique
    and index_record.indpred is null
    and index_record.indexprs is null
    and (
      select array_agg(attribute.attname order by key_column.ordinality)
      from unnest(index_record.indkey::smallint[]) with ordinality key_column(attnum,ordinality)
      join pg_attribute attribute
        on attribute.attrelid=index_record.indrelid
       and attribute.attnum=key_column.attnum
    )=array['hotel_id','member_user_id']::name[];
  if v_exact_unique_count>1
    and to_regclass('public.hotel_team_member_unique') is not null then
    drop index public.hotel_team_member_unique;
  end if;
end
$deduplicate$;

-- Final grant snapshot after Hotel and PMS functions have been installed.
insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  procedure.oid::regprocedure::text,
  procedure.proname,
  case when procedure.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',procedure.oid,'execute'),
  has_function_privilege('anon',procedure.oid,'execute'),
  has_function_privilege('authenticated',procedure.oid,'execute'),
  has_function_privilege('service_role',procedure.oid,'execute'),
  case
    when procedure.oid in(
      to_regprocedure('public.get_discoverable_hotels()'),
      to_regprocedure('public.get_public_hotel_detail(integer)')
    ) then 'approved_public_projection'
    when not has_function_privilege('anon',procedure.oid,'execute')
      and not has_function_privilege('authenticated',procedure.oid,'execute')
      and has_function_privilege('service_role',procedure.oid,'execute')
      then 'approved_service_only'
    else coalesce(existing.review_state,'requires_review')
  end,
  case
    when procedure.oid in(
      to_regprocedure('public.get_discoverable_hotels()'),
      to_regprocedure('public.get_public_hotel_detail(integer)')
    ) then 'Reviewed redacted Hotel discovery projection'
    else existing.rationale
  end,
  now()
from pg_proc procedure
join pg_namespace namespace on namespace.oid=procedure.pronamespace
left join public.function_execution_registry existing
  on existing.function_signature=procedure.oid::regprocedure::text
where namespace.nspname='public'
on conflict(function_signature) do update set
  function_name=excluded.function_name,
  security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=excluded.captured_at;

comment on table public.function_execution_registry is
'Final explicit inventory of public-schema RPC security mode and role grants; requires_review rows block production sign-off.';
