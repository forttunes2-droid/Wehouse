// Shared display defaults, independent of payment-provider availability. Adding a
// country catalogue row does not enable its payments, refunds, tax or settlement.
// The fallback keeps presentation working before the configured row has loaded.
export type RegionalDefaults = {
  countryCode: string;
  countryName: string;
  currencyCode: string;
  timeZone: string;
  locale: string;
};

let defaults: RegionalDefaults = {
  countryCode: 'NG',
  countryName: 'Nigeria',
  currencyCode: 'NGN',
  timeZone: 'Africa/Lagos',
  locale: 'en-NG',
};

export function setRegionalDefaults(next: Partial<RegionalDefaults>) {
  defaults = { ...defaults, ...next };
}

export function getRegionalDefaults(): RegionalDefaults {
  return defaults;
}

export function viewerLocale(): string {
  return (typeof navigator !== 'undefined' && navigator.language) || defaults.locale;
}

export function viewerTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || defaults.timeZone; }
  catch { return defaults.timeZone; }
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}

/** A property's own zone when it has one, otherwise the platform default. */
export function propertyTimeZone(zone?: string | null): string {
  return isValidTimeZone(zone) ? zone : defaults.timeZone;
}

/** Amounts are shown in the currency they were charged in, formatted for the viewer. */
export function formatMoney(
  amount: unknown,
  options: { currency?: string | null; minFraction?: number; maxFraction?: number } = {},
): string {
  const value = Number(amount);
  const currency = options.currency && /^[A-Za-z]{3}$/.test(options.currency) ? options.currency.toUpperCase() : defaults.currencyCode;
  const minimumFractionDigits = options.minFraction ?? 0;
  const maximumFractionDigits = Math.max(minimumFractionDigits, options.maxFraction ?? 2);
  try {
    return new Intl.NumberFormat(viewerLocale(), {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits, maximumFractionDigits,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${currency} ${(Number.isFinite(value) ? value : 0).toLocaleString()}`;
  }
}

/** Financial records never change currency when the viewer changes region.
 * Pre-currency Hotel/Service records were charged in NGN. This compatibility
 * fallback must not be used to select the currency for a new charge.
 */
export function formatRecordedMoney(amount:unknown, currency:unknown='NGN'):string {
  const code=currency==null||currency===''?'NGN':typeof currency==='string'?currency.trim().toUpperCase():'';
  if(!/^[A-Z]{3}$/.test(code))return 'Currency unavailable';
  if(!['number','string'].includes(typeof amount)||String(amount).trim()===''||!Number.isFinite(Number(amount)))return 'Amount unavailable';
  return new Intl.NumberFormat(viewerLocale(),{style:'currency',currency:code,currencyDisplay:'narrowSymbol'}).format(Number(amount));
}

/** Symbol of the platform's default currency (or the given one), formatted for the viewer. */
export function currencySymbol(currency?: string | null): string {
  const code = currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : defaults.currencyCode;
  try {
    return new Intl.NumberFormat(viewerLocale(), { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find(part => part.type === 'currency')?.value || code;
  } catch { return code; }
}

/** Short zone name such as WAT, GMT or EST, so a time never needs a country-specific suffix. */
export function timeZoneLabel(zone?: string | null, at: Date = new Date()): string {
  const timeZone = propertyTimeZone(zone);
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' }).formatToParts(at)
      .find(part => part.type === 'timeZoneName')?.value || timeZone;
  } catch { return timeZone; }
}

/** Calendar date (YYYY-MM-DD) in the given zone. */
export function dateInZone(zone?: string | null, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: propertyTimeZone(zone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => parts.find(p => p.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Value for a datetime-local input, shown in the given zone. */
export function dateTimeInputInZone(at: Date, zone?: string | null): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: propertyTimeZone(zone), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => parts.find(p => p.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** Turns a datetime-local value typed in the given zone into a real instant. */
export function zonedInputToISO(value: string, zone?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return new Date(NaN).toISOString();
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const asWallClock = (at: number) => Date.parse(dateTimeInputInZone(new Date(at), zone) + ':00Z');
  const offsets = new Set([-86400000, 0, 86400000].map(delta => asWallClock(wallClock + delta) - wallClock - delta));
  const choices = [...offsets].map(offset => wallClock - offset);
  const exact = choices.filter(at => asWallClock(at) === wallClock);
  // Match PostgreSQL: repeated local times use the later occurrence; missing
  // spring-forward times use the pre-transition offset and move forward.
  const after = choices.filter(at => asWallClock(at) > wallClock).sort((a,b) => asWallClock(a)-asWallClock(b));
  return new Date(exact.length ? Math.max(...exact) : after[0] ?? NaN).toISOString();
}
