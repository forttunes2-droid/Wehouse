/** Size-bounded LRU for binary data. Expired entries never retain the budget. */
export class ByteCache {
  private entries = new Map<string, { bytes: ArrayBuffer; expires: number }>();
  private used = 0;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  constructor(maxBytes: number, ttlMs: number) { this.maxBytes = maxBytes; this.ttlMs = ttlMs; }
  get byteLength() { return this.used; }
  private remove(key: string) {
    const item = this.entries.get(key);
    if (item) { this.used -= item.bytes.byteLength; this.entries.delete(key); }
  }
  private prune(now: number) {
    for (const [key, item] of this.entries) if (item.expires <= now) this.remove(key);
  }
  get(key: string, now = Date.now()) {
    this.prune(now);
    const item = this.entries.get(key);
    if (!item) return null;
    this.entries.delete(key); this.entries.set(key, item);
    return item.bytes.slice(0);
  }
  set(key: string, bytes: ArrayBuffer, now = Date.now()) {
    this.prune(now); this.remove(key);
    if (!bytes.byteLength || bytes.byteLength > this.maxBytes) return;
    while (this.used + bytes.byteLength > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    this.entries.set(key, { bytes: bytes.slice(0), expires: now + this.ttlMs });
    this.used += bytes.byteLength;
  }
  clear() { this.entries.clear(); this.used = 0; }
}
