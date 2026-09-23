export type MessageAttachment = { url: string; type?: string; name?: string };
export type MessageAttachmentKind = 'image' | 'video' | 'audio' | 'file';

/** MIME is authoritative, especially for audio/webm. Extensions are a legacy fallback. */
export function messageAttachmentKind(type = '', url = ''): MessageAttachmentKind {
  const mime = type.toLowerCase().split(';')[0].trim();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime && mime !== 'application/octet-stream') return 'file';
  const pathname = url.split(/[?#]/)[0];
  if (/\.(jpe?g|png|gif|webp|avif)$/i.test(pathname)) return 'image';
  if (/\.(mp3|m4a|wav|ogg|aac)$/i.test(pathname)) return 'audio';
  if (/\.(mp4|mov|webm)$/i.test(pathname)) return 'video';
  return 'file';
}

/** Attachment URLs come from authorised transports, not message-text link scraping. */
export function usableAttachmentUrl(url: string): boolean {
  if (!url || [...url].some(character => character.charCodeAt(0) < 32)) return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (['https:', 'http:', 'blob:'].includes(parsed.protocol)) return true;
    // Local image fixtures/previews only; never permit HTML/document data links.
    return /^data:image\/(?:png|jpeg|webp|gif|avif|svg\+xml)[;,]/i.test(url);
  } catch { return false; }
}

export function attachmentFileLabel(item: MessageAttachment): string {
  // Never show storage paths, signed query strings or encryption metadata as a filename.
  if (item.name?.trim()) return item.name.trim().split(/[\\/]/).at(-1)!.slice(0, 120);
  const mime = item.type?.toLowerCase().split(';')[0].trim();
  if (mime === 'application/pdf' || /\.pdf(?:[?#]|$)/i.test(item.url)) return 'PDF document';
  return 'Document';
}
export function attachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
