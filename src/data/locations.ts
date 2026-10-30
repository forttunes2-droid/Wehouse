import { NIGERIA_STATES, type StateCity } from './nigeria-locations';

// Structured region lists by ISO country code. A country without an entry uses free-text
// region and city inputs, so enabling a country never needs a code change to stay usable.
const REGION_DATASETS: Record<string, StateCity[]> = {
  NG: NIGERIA_STATES,
};

export function regionDataset(countryCode?: string | null): StateCity[] | null {
  return REGION_DATASETS[String(countryCode || '').toUpperCase()] || null;
}

/** A saved profile country wins over presentation defaults. Unknown country
 * names must never acquire another country's region/LGA list. */
export function locationCountryCode(country: string | null | undefined, defaults: {countryCode:string;countryName:string}): string | null {
  const value=String(country||'').trim().toUpperCase();
  if (!value || value===defaults.countryName.trim().toUpperCase()) return defaults.countryCode.toUpperCase();
  if (/^[A-Z]{2}$/.test(value)) return value;
  if (value==='NIGERIA') return 'NG';
  return null;
}
