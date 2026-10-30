export type ListingDiscountQuote = { host: number; wehouse: number; total: number; endsOn: string | null };

/** Validate the public offer receipt. Checkout remains the price authority. */
export function listingDiscountQuote(value: unknown): ListingDiscountQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Offers could not be confirmed.');
  const row = value as Record<string, unknown>;
  const values = [row.host_percent, row.wehouse_percent, row.total_percent];
  if (values.some(n => !['number','string'].includes(typeof n) || String(n).trim() === '' || !Number.isFinite(Number(n)) || Number(n) < 0 || Number(n) > 100)) throw new Error('Offers could not be confirmed.');
  const [host, wehouse, total] = values.map(Number);
  if (total > 50 || Math.abs(host + wehouse - total) > 0.000001 || row.ends_on != null && (typeof row.ends_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.ends_on) || !Number.isFinite(Date.parse(row.ends_on)) || new Date(row.ends_on).toISOString().slice(0,10) !== row.ends_on)) throw new Error('Offers could not be confirmed.');
  return { host, wehouse, total, endsOn: row.ends_on as string | null ?? null };
}

/** Current home prices use two minor digits, matching the reservation quote. */
export function discountedListingRate(amount: unknown, percent: number): number | null {
  if (!['number','string'].includes(typeof amount) || String(amount).trim() === '' || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !Number.isFinite(percent) || percent < 0 || percent > 50) return null;
  const scaled = (value: string): bigint | null => {
    const match = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(value);
    return match ? BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2,'0')) : null;
  };
  const price = scaled(String(amount).trim()), basis = scaled(String(percent));
  if (price === null || basis === null) return null;
  // Match Postgres numeric half-up rounding, including half-minor-unit ties.
  const minor = Number((price * (10000n - basis) + 5000n) / 10000n);
  return Number.isSafeInteger(minor) ? minor / 100 : null;
}
