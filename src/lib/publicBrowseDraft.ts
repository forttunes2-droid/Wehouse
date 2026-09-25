/** Non-authoritative browse choices only. Never stores identity, access codes,
 * price/payment state or permissions. The booking server still validates inputs. */
const key = (type: string, id: string) => `wh_browse_v1:${type}:${id}`;
export function readPublicBrowseDraft(type: 'hotel' | 'listing', id: string): Record<string, unknown> {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(type, id)) || 'null');
    if (!value || typeof value !== 'object' || !Number.isFinite(value.at) || Date.now() - value.at > 6 * 60 * 60 * 1000 || !value.choices || typeof value.choices !== 'object' || Array.isArray(value.choices)) return {};
    return value.choices;
  } catch { return {}; }
}
export function savePublicBrowseDraft(type: 'hotel' | 'listing', id: string, choices: Record<string, string | number | null>) {
  try { sessionStorage.setItem(key(type, id), JSON.stringify({ at: Date.now(), choices })); } catch { /* Private browsing may deny storage. */ }
}
export function browseDate(value: unknown) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''; }
