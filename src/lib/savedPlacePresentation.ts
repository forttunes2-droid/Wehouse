/** Shared presentation without sharing booking/payment rules between products. */
export type SavedPlaceType = 'home' | 'long_let' | 'short_let' | 'hotel';
export type SavedPlace = {
  key: string;
  type: SavedPlaceType;
  id: string;
  title: string;
  location: string;
  image: string | null;
  detail: string;
  unavailable: boolean;
};
export const SAVED_TYPE_LABELS: Record<SavedPlaceType, string> = {
  home: 'Home', long_let: 'Long Let', short_let: 'Short Let', hotel: 'Hotel',
};
export function savedHomePrice(price: unknown, shortLet: boolean): string {
  if (price === null || price === undefined || price === '') return 'View price and details';
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return 'View price and details';
  return `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })} / ${shortLet ? 'night' : 'year'}`;
}
export function visibleSavedPlaces(
  places: readonly SavedPlace[],
  type: 'all' | SavedPlaceType,
): SavedPlace[] {
  return places.filter(place => type === 'all' || place.type === type)
    .sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
