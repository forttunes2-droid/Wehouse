/** A shared property is a public reference, not a reservation or payment invite. */
export type SharedProperty = { kind: 'listing' | 'hotel'; id: string };
const PREFIX = 'https://wehouse.com.ng/#place/';
export function propertyReference(kind: unknown, id: unknown): SharedProperty | null {
  if (kind !== 'listing' && kind !== 'hotel') return null;
  const value = typeof id === 'number' ? String(id) : typeof id === 'string' ? id.trim() : '';
  if (!value || value.length > 160 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  if (kind === 'hotel' && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) return null;
  return { kind, id: value };
}
export function propertyShareUrl(property: SharedProperty): string {
  const ref = propertyReference(property.kind, property.id);
  if (!ref) throw new Error('This property cannot be shared.');
  return `${PREFIX}${ref.kind}/${encodeURIComponent(ref.id)}`;
}
export function parsePropertyShareUrl(value: string): SharedProperty | null {
  if (value.length > 400) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['wehouse.com.ng', 'www.wehouse.com.ng'].includes(url.hostname)
      || url.username || url.password || url.port || url.pathname !== '/' || url.search) return null;
    const match = /^#place\/(listing|hotel)\/([^/?&#\s]+)$/.exec(url.hash);
    return match ? propertyReference(match[1], decodeURIComponent(match[2])) : null;
  } catch { return null; }
}
export function propertyShareMessage(property: SharedProperty, text = ''): string {
  const note = text.trim();
  return `${note ? `${note}\n\n` : ''}${propertyShareUrl(property)}`;
}
export function parsePropertyShareMessage(content: string): { property: SharedProperty; text: string } | null {
  // One explicit, canonical link on the final line. Never follow arbitrary URLs
  // for previews or treat untrusted message text as a command/payment request.
  if (content.length > 16_000) return null;
  const lines = content.trimEnd().split('\n');
  const property = parsePropertyShareUrl(lines.at(-1)?.trim() || '');
  return property ? { property, text: lines.slice(0, -1).join('\n').trimEnd() } : null;
}
export function propertyMessagePreview(content: string): string {
  const shared = parsePropertyShareMessage(content);
  return shared ? shared.text || 'Shared a property' : content;
}
const drafts = new Map<string, { property: SharedProperty; expires: number }>();
const key = (userId: string, conversationId: string) => JSON.stringify([userId, conversationId]);
export function queuePropertyShare(userId: string, conversationId: string, property: SharedProperty, now = Date.now()): void {
  const ref = propertyReference(property.kind, property.id);
  if (!userId || !conversationId || !ref) throw new Error('Choose an available connection and property.');
  for (const [id, draft] of drafts) if (draft.expires <= now) drafts.delete(id);
  if (drafts.size >= 20) drafts.delete(drafts.keys().next().value!);
  // Memory-only, account/conversation-bound and short-lived. No unencrypted
  // message or recipient list is written to browser storage.
  drafts.set(key(userId, conversationId), { property: ref, expires: now + 15 * 60_000 });
}
export function pendingPropertyShare(userId: string, conversationId: string, now = Date.now()): SharedProperty | null {
  const draft = drafts.get(key(userId, conversationId));
  if (!draft || draft.expires <= now) { drafts.delete(key(userId, conversationId)); return null; }
  return { ...draft.property };
}
export function clearPropertyShare(userId: string, conversationId: string): void { drafts.delete(key(userId, conversationId)); }
