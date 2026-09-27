import { parsePropertyShareUrl, propertyReference, type SharedProperty } from './propertyShare';
const KEY = 'wh_public_property_intent_v1';
const LIFETIME = 10 * 60_000;
const FLOW = 'property_sign_in_v2';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Only the public kind/id survives a sign-in redirect. No authority, private
 * preview, conversation, recipient or payment data is stored here. */
export function readPropertyLinkIntent(url: string, store: Store, now = Date.now()): SharedProperty | null {
  const fromUrl = parsePropertyShareUrl(url);
  if (fromUrl) return fromUrl;
  try {
    const location = new URL(url);
    const application = ['https:', 'http:'].includes(location.protocol) && location.pathname === '/';
    const testFixture = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname) && location.pathname === '/tests/browser/experience.html';
    if (!application && !testFixture) return null;
    const authReturn = location.hash === '#login' || location.searchParams.has('code') || /^#(?:access_token|error_description)=/.test(location.hash);
    if (!authReturn) return null;
    const entry = JSON.parse(store.getItem(KEY) || 'null');
    if (!entry || entry.flow !== FLOW || !Number.isFinite(entry.expires) || entry.expires <= now || entry.expires > now + LIFETIME) return null;
    return propertyReference(entry.property?.kind, entry.property?.id);
  } catch { return null; }
}
export function savePropertyLinkIntent(property: SharedProperty | null, store: Store, now = Date.now()): void {
  try {
    const valid = property && propertyReference(property.kind, property.id);
    if (!valid) store.removeItem(KEY);
    else store.setItem(KEY, JSON.stringify({ flow: FLOW, property: valid, expires: now + LIFETIME }));
  } catch { /* Sign-in still works if session storage is unavailable. */ }
}
