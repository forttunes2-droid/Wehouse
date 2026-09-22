export type HelpTarget = {
  subject_type: string;
  subject_id: string;
  context_type?: string;
  label: string;
  detail?: string;
  status?: string;
  stay_type?: string;
  updated_at?: string;
  record_date?: string | null;
  record_reference?: string;
};

/** Hotel property 1 and hotel booking 1 are different linked objects. */
export function helpTargetKey(target: HelpTarget) {
  return JSON.stringify([target.context_type || target.subject_type, target.subject_type, target.subject_id]);
}

export function helpTargetLabel(target: HelpTarget) {
  const date = target.record_date ? new Date(target.record_date) : null;
  const dateLabel = date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date)
    : "";
  return [target.label, target.detail, dateLabel, target.record_reference].filter(Boolean).join(" · ");
}

/** Only the server decides which owned records represent payment help. Never
 * rebuild this list from every booking when an older/malformed response omits it.
 */
export function paymentHelpTargets(targets: { payment_targets?: HelpTarget[] }) {
  return Array.isArray(targets.payment_targets) ? targets.payment_targets : [];
}

const HELP_LISTS = [
  "worker_jobs", "withdrawals", "reservations", "hotel_bookings",
  "property_requests", "properties", "hotels", "partner_reservations",
  "partner_hotel_bookings", "payment_targets",
] as const;

function isHelpTarget(value: unknown): value is HelpTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (!["subject_type", "subject_id", "label"].every(key =>
    typeof item[key] === "string" && (item[key] as string).trim().length > 0)) return false;
  return ["context_type", "detail", "status", "stay_type", "updated_at",
    "record_date", "record_reference"].every(key => item[key] == null || typeof item[key] === "string");
}

/** A successful HTTP response is not necessarily a usable Help projection.
 * Missing/invalid records must reach the retry UI, not look like empty history
 * or throw while constructing the record selectors. Authorization remains on
 * the server; this only validates the response shape used by the UI. */
export function isHelpTargetsResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (!isHelpTarget(data.account) || data.account.subject_type !== "account"
    || !Array.isArray(data.payment_targets)) return false;
  if (data.worker_profile != null && !isHelpTarget(data.worker_profile)) return false;
  return HELP_LISTS.every(key => data[key] == null
    || (Array.isArray(data[key]) && data[key].every(isHelpTarget)));
}
