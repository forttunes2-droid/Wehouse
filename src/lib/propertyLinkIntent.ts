import { parsePropertyShareUrl, propertyReference, type SharedProperty } from './propertyShare';
const KEY = 'wh_public_property_intent_v1';
const LIFETIME = 30 * 60_000;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Only the public kind/id survives a sign-in redirect. No authority, private
 * preview, conversation, recipient or payment data is stored here. */
export function readPropertyLinkIntent(url: string, store: Store, now = Date.now()): SharedProperty | null {
  const fromUrl = parsePropertyShareUrl(url);
  if (fromUrl) return fromUrl;
  try {
    const entry = JSON.parse(store.getItem(KEY) || 'null');
    if (!entry || !Number.isFinite(entry.expires) || entry.expires <= now || entry.expires > now + LIFETIME) return null;
    return propertyReference(entry.property?.kind, entry.property?.id);
  } catch { return null; }
}
export function savePropertyLinkIntent(property: SharedProperty | null, store: Store, now = Date.now()): void {
  try {
    const valid = property && propertyReference(property.kind, property.id);
    if (!valid) store.removeItem(KEY);
    else store.setItem(KEY, JSON.stringify({ property: valid, expires: now + LIFETIME }));
  } catch { /* Sign-in still works if session storage is unavailable. */ }
}
