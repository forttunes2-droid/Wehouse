/** Payment support is independent of viewer locale and country catalogue visibility. */
export type PaymentMarket = Readonly<{
  country: string;
  currency: string;
  provider: 'paystack';
  minorDigits: number;
}>;
// Only markets with implemented payment, refund and settlement adapters belong
// here. A platform_countries row alone must never enable money movement.
const supportedMarkets: readonly PaymentMarket[] = Object.freeze([
  Object.freeze({ country:'NG',currency:'NGN',provider:'paystack' as const,minorDigits:2 }),
]);

/** Deliberately closed until each market has charge/refund/settlement acceptance. */
export function resolvePaymentMarket(currency: unknown, country?: unknown): PaymentMarket | null {
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
  if (country !== undefined && (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country))) return null;
  const matches = supportedMarkets.filter(market => market.currency === currency
    && (country === undefined || market.country === country));
  // Older records contain only currency. Never guess a country if a later
  // expansion makes that currency ambiguous between supported markets.
  return matches.length === 1 ? matches[0] : null;
}

/** Exact decimal conversion. Never round a price into a different amount. */
export function paymentMinorUnits(value: unknown, digits: number): number | null {
  if (!Number.isInteger(digits) || digits < 0 || digits > 3) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const raw=String(value);
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const [whole,fraction='']=raw.split('.');
  if (fraction.slice(digits).replace(/0/g,'')) return null;
  const minor=BigInt(whole)*10n**BigInt(digits)+BigInt(fraction.slice(0,digits).padEnd(digits,'0')||'0');
  return minor>0n && minor<=BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}
