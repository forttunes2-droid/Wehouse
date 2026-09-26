type Stay = { status: string; check_in: string; check_out: string };
/** The daily count and its destination list use the same predicate. */
export function matchesHotelReservationFilter(stay: Stay, filter: string, date: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'arrivals_today') return stay.status === 'confirmed' && stay.check_in === date;
  if (filter === 'departures_today') return stay.status === 'checked_in' && stay.check_out === date;
  if (filter === 'staying') return stay.status === 'checked_in';
  if (filter === 'attention') return stay.status === 'payment_conflict' || (stay.status === 'confirmed' && stay.check_in <= date);
  return stay.status === filter;
}
export function hotelTodayMetrics(stays: ReadonlyArray<Stay>, date: string) {
  const count = (filter: string) => stays.filter(stay => matchesHotelReservationFilter(stay, filter, date)).length;
  return { arrivals: count('arrivals_today'), staying: count('staying'), departures: count('departures_today'), attention: count('attention') };
}
