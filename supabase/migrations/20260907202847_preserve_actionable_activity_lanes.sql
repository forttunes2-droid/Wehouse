-- Applied migration version: 20260907202847.
-- Reading an Activity item is not the same as resolving its underlying work.
-- Preserve actionable records, use category-specific windows, and deduplicate only
-- non-actionable events inside the same lifecycle lane.
create or replace function public.prune_my_activity()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient text := public.current_profile_user_id();
  v_deleted integer := 0;
  v_step integer := 0;
begin
  if v_recipient is null then raise exception 'Authenticated profile required'; end if;

  delete from public.notifications n
  where n.recipient_id = v_recipient
    and (
      (n.type ~* '(^|_)(message|reply|replied|chat)(_|$)'
        and ((n.read and n.created_at < now() - interval '1 day') or n.created_at < now() - interval '30 days'))
      or (n.type ~* '(action_required|payment_conflict|dispute|changes_requested|escalat|verification_required|refund_due|failed)'
        and n.created_at < now() - interval '180 days')
      or (n.type !~* '(action_required|payment_conflict|dispute|changes_requested|escalat|verification_required|refund_due|failed)'
        and n.type ~* '(payment|payout|earning|refund)'
        and ((n.read and n.created_at < now() - interval '90 days') or n.created_at < now() - interval '180 days'))
      or (n.type !~* '(action_required|payment_conflict|dispute|changes_requested|escalat|verification_required|refund_due|failed)'
        and n.type ~* '(roommate|match|invite|interest)'
        and ((n.read and n.created_at < now() - interval '14 days') or n.created_at < now() - interval '30 days'))
      or (n.type !~* '(action_required|payment_conflict|dispute|changes_requested|escalat|verification_required|refund_due|failed)'
        and n.type ~* '(booking|reservation|inspection|visit|listing|property|hotel|job|worker)'
        and ((n.read and n.created_at < now() - interval '30 days') or n.created_at < now() - interval '90 days'))
      or (n.type !~* '(action_required|payment_conflict|dispute|changes_requested|escalat|verification_required|refund_due|failed)'
        and n.type ~* '(verification|password|security)'
        and ((n.read and n.created_at < now() - interval '30 days') or n.created_at < now() - interval '90 days'))
      or (n.type !~* '(action_required|payment_conflict|dispute|changes_requested|escalat|verification_required|refund_due|failed|payment|payout|earning|refund|roommate|match|invite|interest|booking|reservation|inspection|visit|listing|property|hotel|job|worker|verification|password|security|message|reply|replied|chat)'
        and ((n.read and n.created_at < now() - interval '14 days') or n.created_at < now() - interval '30 days'))
    );
  get diagnostics v_deleted = row_count;

  delete from public.notifications older
  using public.notifications newer
  where older.recipient_id = v_recipient
    and newer.recipient_id = older.recipient_id
    and nullif(older.source_type, '') is not null
    and nullif(older.source_id, '') is not null
    and newer.source_type = older.source_type
    and newer.source_id = older.source_id
    and (newer.created_at, newer.id) > (older.created_at, older.id)
    and older.type !~* '(action_required|payment_conflict|dispute|changes_requested|escalat|verification_required|refund_due|failed)'
    and older.type ~* '(payment|payout|earning|refund|roommate|match|invite|interest|booking|reservation|inspection|visit|listing|property|hotel|job|worker|verification|status)'
    and (case
      when older.type ~* '(payment|payout|earning|refund|dispute)' then 'finance'
      when older.type ~* '(inspection|visit|access_evidence)' then 'inspection'
      when older.type ~* 'hotel' then 'hotel'
      when older.type ~* '(reservation|booking|tenancy|move_in|handover|property|listing)' then 'housing'
      when older.type ~* '(worker|job|service)' then 'worker'
      when older.type ~* '(roommate|match|invite|interest)' then 'roommate'
      when older.type ~* '(verification|password|security)' then 'account'
      else 'general' end)
      = (case
      when newer.type ~* '(payment|payout|earning|refund|dispute)' then 'finance'
      when newer.type ~* '(inspection|visit|access_evidence)' then 'inspection'
      when newer.type ~* 'hotel' then 'hotel'
      when newer.type ~* '(reservation|booking|tenancy|move_in|handover|property|listing)' then 'housing'
      when newer.type ~* '(worker|job|service)' then 'worker'
      when newer.type ~* '(roommate|match|invite|interest)' then 'roommate'
      when newer.type ~* '(verification|password|security)' then 'account'
      else 'general' end);
  get diagnostics v_step = row_count;
  return v_deleted + v_step;
end;
$$;

revoke all on function public.prune_my_activity() from public, anon;
grant execute on function public.prune_my_activity() to authenticated, service_role;
