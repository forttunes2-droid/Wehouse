/** Signed-out pages accept published URLs, never private upload references.
 * Backend public projections remain the authority; this is defense in depth.
 */
export function publicPropertyImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => {
    if (typeof item !== 'string') return false;
    try {
      const url = new URL(item);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
      const path = decodeURIComponent(url.pathname).toLowerCase();
      if (/\/storage\/v1\/(?:object|render\/image)\/(?:sign|authenticated)\//.test(path)) return false;
      return !/\/storage\/v1\/(?:object|render\/image)\/[^/]+\/listing-candidates\//.test(path);
    } catch { return false; }
  }))];
}
