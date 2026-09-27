export function takeFollowedSearchIntent(kind: 'homes' | 'hotels'): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem('wehouse:open-followed-search');
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || (parsed as { kind?: unknown }).kind !== kind) return null;
    sessionStorage.removeItem('wehouse:open-followed-search');
    const criteria = (parsed as { criteria?: unknown }).criteria;
    return criteria && typeof criteria === 'object' && !Array.isArray(criteria) ? criteria as Record<string, unknown> : null;
  } catch { return null; }
}
