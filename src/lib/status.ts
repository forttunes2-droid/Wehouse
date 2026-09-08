export function formatCanonicalStatus(value: string) {
  const normalized = String(value || "unknown").trim().replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function canonicalStatusOptions(values: Array<string | null | undefined>) {
  const statuses = Array.from(
    new Set(values.map((value) => String(value || "unknown").trim()).filter(Boolean)),
  ).sort((left, right) => formatCanonicalStatus(left).localeCompare(formatCanonicalStatus(right)));

  return [
    { value: "all", label: "All" },
    ...statuses.map((value) => ({ value, label: formatCanonicalStatus(value) })),
  ];
}

const PROPERTY_LIFECYCLE_LABELS: Record<string, string> = {
  access_required: "Access required",
  access_review: "Access review",
  inspection_ready: "Inspection ready",
  inspection: "Inspection in progress",
  visit_reviewed: "Visit reviewed",
  listing_prepared: "Listing prepared",
  live: "Live",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};

export function propertyLifecycleLabel(value: string | null | undefined) {
  const stage = String(value || "access_required");
  return PROPERTY_LIFECYCLE_LABELS[stage] || formatCanonicalStatus(stage);
}
