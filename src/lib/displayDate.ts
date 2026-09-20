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

export function displayDateTime(value: unknown, timeZone?: string): string {
  if (!value || !Number.isFinite(new Date(String(value)).getTime())) return "—";
  return new Date(String(value)).toLocaleString("en-GB", {
    timeZone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

/** Nigeria property arrival times stay consistent for travellers in other zones. */
export function nigeriaDateTimeInput(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const part = (type: string) => parts.find(p => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function nigeriaDate(value = new Date()): string {
  return nigeriaDateTimeInput(value).slice(0, 10);
}

export function nigeriaInputToISO(value: string): string {
  // Nigerian property time is WAT (UTC+01:00), without daylight-saving changes.
  return new Date(`${value}:00+01:00`).toISOString();
}
