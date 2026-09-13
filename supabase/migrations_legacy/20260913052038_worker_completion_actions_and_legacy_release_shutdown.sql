-- Participant-safe read model for the 12-hour reminder, 24-hour controlled
-- release, three-day help window and 48-hour review edit window.

create or replace function public.get_my_worker_completion_actions(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_booking public.worker_bookings;
  v_protection public.payment_protection_transactions;
  v_action public.financial_action_outbox;
begin
  select * into v_booking from public.worker_bookings where id=p_booking_id;
  if v_actor is null or v_booking.id is null
    or v_actor not in(v_booking.user_id,v_booking.worker_id) then
    raise exception 'Worker job participant access required';
  end if;
  select * into v_protection from public.payment_protection_transactions
  where id=v_booking.payment_protection_id;
  select * into v_action from public.financial_action_outbox
  where idempotency_key='release_worker_payment:'||v_booking.id;
  return jsonb_build_object(
    'canonical_job_state',coalesce(v_booking.canonical_job_state,'requested'),
    'marked_complete_at',v_booking.marked_complete_at,
    'reminder_available',v_actor=v_booking.worker_id
      and v_booking.canonical_job_state='completion_marked'
      and v_booking.marked_complete_at+interval '12 hours'<=now()
      and v_booking.completion_reminder_sent_at is null,
    'reminder_sent_at',v_booking.completion_reminder_sent_at,
    'release_eligible_at',v_booking.release_eligible_at,
    'release_status',coalesce(v_action.status,
      case when v_protection.protection_state='released' then 'completed' else 'not_queued' end),
    'protection_state',coalesce(v_protection.protection_state,'unavailable'),
    'customer_confirmed',coalesce(v_booking.user_approved,false),
    'help_until',v_booking.help_until,
    'help_open',v_booking.help_until is not null and v_booking.help_until>=now(),
    'review_edit_until',v_booking.review_edit_until,
    'review_edit_open',v_booking.review_edit_until is not null
      and v_booking.review_edit_until>=now()
  );
end
$$;

-- These functions represented the retired direct-wallet generation. Keep
-- their signatures for migration compatibility, but make execution impossible.
create or replace function public.release_escrow(
  p_booking_id uuid,p_released_by text default 'system'
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  raise exception 'Legacy direct wallet release is disabled; use the canonical financial outbox';
end
$$;

create or replace function public.release_property_partner_earning(
  p_payment_id uuid,p_release_event text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  raise exception 'Legacy pending-wallet release is disabled; use Payment Protection or verified normal settlement';
end
$$;

revoke all on function public.get_my_worker_completion_actions(uuid) from public,anon;
grant execute on function public.get_my_worker_completion_actions(uuid) to authenticated,service_role;
revoke all on function public.release_escrow(uuid,text) from public,anon,authenticated;
revoke all on function public.release_property_partner_earning(uuid,text) from public,anon,authenticated;
grant execute on function public.release_escrow(uuid,text) to service_role;
grant execute on function public.release_property_partner_earning(uuid,text) to service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  case when p.proname='get_my_worker_completion_actions'
    then 'approved_client_rpc' else 'approved_service_only' end,
  case when p.proname='get_my_worker_completion_actions'
    then 'Participant-bound Worker completion read model'
    else 'Disabled legacy release compatibility signature' end,now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'get_my_worker_completion_actions','release_escrow','release_property_partner_earning'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

comment on function public.get_my_worker_completion_actions(uuid) is
  'Canonical Worker completion timing and release status for job participants.';
