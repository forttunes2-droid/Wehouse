/** A public property reference is a kind plus an ID, never an untyped ID. */
export type PublicPropertyDestination =
  | { kind: 'listing'; page: 'detail'; id: string }
  | { kind: 'hotel'; page: 'hotel_detail'; id: number };

export function publicPropertyDestination(
  page: string,
  id?: string | number | null,
): PublicPropertyDestination | null {
  const route = page.toLowerCase().replace(/-/g, '_');
  const value = String(id ?? '').trim();
  if (!value) return null;
  if (route === 'detail' || route === 'listing_detail') {
    // Listing IDs are opaque; do not turn numeric hotel IDs into listing IDs.
    return { kind: 'listing', page: 'detail', id: value };
  }
  if (route !== 'hotel_detail' || !/^[1-9]\d*$/.test(value)) return null;
  const hotelId = Number(value);
  return Number.isSafeInteger(hotelId)
    ? { kind: 'hotel', page: 'hotel_detail', id: hotelId }
    : null;
}
