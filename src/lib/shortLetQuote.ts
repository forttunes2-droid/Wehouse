/** Calendar dates are property-local days, not the guest device's timezone. */
const DAY = 86_400_000;
export function calendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / DAY : null;
}
export function addCalendarDays(value: string, days: number): string {
  const day = calendarDay(value);
  if (day === null || !Number.isSafeInteger(days)) return '';
  const result = new Date((day + days) * DAY);
  return Number.isFinite(result.getTime()) ? result.toISOString().slice(0, 10) : '';
}
export function nigeriaCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export type ShortLetSelection = {
  checkIn: string; checkOut: string; today: string; lastDate: string;
  guests: number; maxGuests: number; minNights: number; maxNights: number;
  nightlyRate: number; refundableDeposit: number;
};
export type ShortLetQuote = { valid: false; total: null; nights: number; error: string }
  | { valid: true; total: number; nights: number; rent: number; deposit: number; error: '' };
/** Display estimate only. The reservation RPC remains the price/availability authority. */
export function shortLetQuote(selection: ShortLetSelection): ShortLetQuote {
  const fail = (error: string, nights = 0): ShortLetQuote => ({ valid: false, total: null, nights, error });
  if (!selection.checkIn || !selection.checkOut) return fail('Choose your check-in and check-out dates.');
  const start = calendarDay(selection.checkIn), end = calendarDay(selection.checkOut);
  const today = calendarDay(selection.today), last = calendarDay(selection.lastDate);
  if (start === null || end === null || today === null || last === null) return fail('Choose valid stay dates.');
  const nights = end - start;
  if (start < today || end > last || nights <= 0) return fail('Choose available future dates, with checkout after check-in.');
  if (![selection.minNights, selection.maxNights].every(value => Number.isSafeInteger(value) && value > 0)
    || selection.maxNights < selection.minNights) return fail('Stay rules could not be loaded. Please refresh.');
  if (nights < selection.minNights || nights > selection.maxNights) return fail(`Choose a stay of ${selection.minNights}–${selection.maxNights} nights.`, nights);
  if (!Number.isSafeInteger(selection.maxGuests) || selection.maxGuests < 1) return fail('Guest capacity is not available for this property.', nights);
  if (!Number.isSafeInteger(selection.guests) || selection.guests < 1 || selection.guests > selection.maxGuests) return fail(`Choose between 1 and ${selection.maxGuests} guests.`, nights);
  if (!Number.isFinite(selection.nightlyRate) || selection.nightlyRate <= 0 || !Number.isFinite(selection.refundableDeposit) || selection.refundableDeposit < 0) return fail('The price could not be confirmed. Please refresh.', nights);
  const rate = Math.round(selection.nightlyRate * 100), deposit = Math.round(selection.refundableDeposit * 100), rent = rate * nights;
  if (![rate, deposit, rent, rent + deposit].every(Number.isSafeInteger)) return fail('The price could not be confirmed. Please refresh.', nights);
  return { valid: true, total: (rent + deposit) / 100, nights, rent: rent / 100, deposit: deposit / 100, error: '' };
}
