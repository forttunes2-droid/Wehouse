import { dateInZone, dateTimeInputInZone, propertyTimeZone, timeZoneLabel, viewerTimeZone, zonedInputToISO } from "./regional";

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

/** Time at a property, with its zone name, so travellers in other zones are never confused. */
export function displayDateTimeAtProperty(value: unknown, zone?: string | null): string {
  const timeZone = propertyTimeZone(zone);
  const text = displayDateTime(value, timeZone);
  return text === "—" ? text : `${text} ${timeZoneLabel(timeZone, new Date(String(value)))}`;
}

/** A moment (payment, deadline) shown in the viewer's own time zone. */
export function displayMoment(value: unknown): string {
  return displayDateTimeAtProperty(value, viewerTimeZone());
}

export function propertyDateTimeInput(value: Date, zone?: string | null): string {
  return dateTimeInputInZone(value, zone);
}

export function propertyDate(value = new Date(), zone?: string | null): string {
  return dateInZone(zone, value);
}

export function propertyInputToISO(value: string, zone?: string | null): string {
  return zonedInputToISO(value, zone);
}
