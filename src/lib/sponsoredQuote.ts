/** Prices are checked in minor units before an advertiser leaves for checkout. */
export function sponsoredPriceKobo(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  const kobo = Math.round(amount * 100);
  return Number.isFinite(amount) && Number.isSafeInteger(kobo) && kobo > 0
    && Math.abs(amount * 100 - kobo) < 0.000001 ? kobo : null;
}

export function matchesSponsoredQuote(quote: any, type: string, id: string, days: number, expectedKobo: number | null) {
  return expectedKobo !== null && quote?.resource_type === type
    && String(quote?.resource_id) === id && quote?.duration_days === days
    && sponsoredPriceKobo(quote?.amount_ngn) === expectedKobo;
}
