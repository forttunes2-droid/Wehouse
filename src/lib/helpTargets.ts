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
