/** Date-only booking values are calendar dates, never UTC instants. */
export function displayDate(value: unknown): string {
  if (!value) return "—";
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T12:00:00`)
    : new Date(text);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function displayDateTime(value: unknown): string {
  if (!value || !Number.isFinite(new Date(String(value)).getTime())) return "—";
  return new Date(String(value)).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}
