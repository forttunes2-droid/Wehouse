import { NIGERIA_STATES, type StateCity } from './nigeria-locations';

// Structured region lists by ISO country code. A country without an entry uses free-text
// region and city inputs, so enabling a country never needs a code change to stay usable.
const REGION_DATASETS: Record<string, StateCity[]> = {
  NG: NIGERIA_STATES,
};

export function regionDataset(countryCode?: string | null): StateCity[] | null {
  return REGION_DATASETS[String(countryCode || '').toUpperCase()] || null;
}
