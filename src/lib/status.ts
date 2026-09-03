export function formatCanonicalStatus(value: string) {
  const normalized = String(value || "unknown").trim().replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function canonicalStatusOptions(values: Array<string | null | undefined>) {
  const statuses = Array.from(
    new Set(values.map((value) => String(value || "unknown").trim()).filter(Boolean)),
  ).sort((left, right) => formatCanonicalStatus(left).localeCompare(formatCanonicalStatus(right)));

  return [
    { value: "all", label: "All statuses" },
    ...statuses.map((value) => ({ value, label: formatCanonicalStatus(value) })),
  ];
}
