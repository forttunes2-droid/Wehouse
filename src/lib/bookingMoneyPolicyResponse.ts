/** Reject incomplete policy responses before presenting or editing money rules.
 * This validates the existing server contract; it does not choose new prices. */
export type MoneyPolicyEntry = {
  version: number;
  value: Record<string, unknown>;
  effective_from?: string;
};
export type MoneyPolicyResponse = {
  source_of_truth: 'creator_policy_versions';
  active: Record<string, MoneyPolicyEntry>;
  scheduled?: Record<string, MoneyPolicyEntry>;
};
const fields: Record<string, Record<string, 'number' | 'boolean'>> = {
  short_let_reservation_hold: { minutes: 'number' },
  short_let_cancellation: { full_refund_hours_before_check_in: 'number', late_cancel_max_nights: 'number', no_show_max_nights: 'number' },
  short_let_caution_cap: { enabled: 'boolean', maximum_nights: 'number' },
  caution_claim_windows: { partner_claim_hours: 'number', guest_response_hours: 'number' },
  accommodation_arrival_issue_window: { default_hours: 'number' },
  long_let_reservation_fee: { amount: 'number', payment_hold_minutes: 'number' },
  long_let_reservation_hold: { hours: 'number', full_refund_hours: 'number' },
  future_long_let_installments: { enabled: 'boolean' },
  commission_short_let: { percent: 'number' },
  commission_long_let: { percent: 'number' },
  commission_hotel: { percent: 'number' },
  commission_worker: { percent: 'number' },
  worker_completion_release: { reminder_hours: 'number', release_eligible_hours: 'number' },
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function entry(value: unknown): value is MoneyPolicyEntry {
  return record(value) && Number.isInteger(value.version) && Number(value.version) > 0 && record(value.value);
}
export function isMoneyPolicyResponse(value: unknown): value is MoneyPolicyResponse {
  if (!record(value) || value.source_of_truth !== 'creator_policy_versions' || !record(value.active)) return false;
  if (value.scheduled !== undefined && (!record(value.scheduled) || !Object.values(value.scheduled).every(entry))) return false;
  if (!Object.values(value.active).every(entry)) return false;
  return Object.entries(fields).every(([key, required]) => {
    const policy = (value.active as Record<string, unknown>)[key];
    if (!entry(policy)) return false;
    return Object.entries(required).every(([name, kind]) => {
      const item = policy.value[name];
      return kind === 'boolean' ? typeof item === 'boolean' : typeof item === 'number' && Number.isFinite(item) && item >= 0;
    });
  });
}
