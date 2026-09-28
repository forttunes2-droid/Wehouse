function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (kind: string) => parts.find(part => part.type === kind)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function dayNumber(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  return Date.parse(`${value}T00:00:00Z`) / 86400000;
}

/** Booking dates belong to the hotel, even when the guest is in another time zone. */
export function hotelArrivalGuidance(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
  checkInTime: string,
  timeZone = 'Africa/Lagos',
  now = new Date(),
): string | null {
  if (!checkIn || !checkOut) return null;
  let today: string;
  try { today = localDate(now, timeZone); }
  catch { today = localDate(now, 'Africa/Lagos'); }
  const until = dayNumber(checkIn.slice(0, 10)) - dayNumber(today);
  const checkout = dayNumber(checkOut.slice(0, 10)) - dayNumber(today);
  if (!Number.isFinite(until) || !Number.isFinite(checkout)) return null;
  if (until === 1) return `Check-in tomorrow from ${checkInTime} (hotel local time). Open your booking for the code and directions.`;
  if (until === 0) return `Check-in today from ${checkInTime} (hotel local time). Open your booking for the code and directions.`;
  if (until < 0 && checkout >= 0) return 'Your check-in date has passed. If you have not arrived, contact the hotel from this booking.';
  if (checkout < 0) return 'Your stay dates have passed without a recorded check-in. Contact WeHouse if you need help with a missed arrival.';
  return null;
}
