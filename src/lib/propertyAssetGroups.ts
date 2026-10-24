type Asset = { id: string; site_id?: string | null; site_label?: string | null; _assetKind?: string };
export type PropertyAssetGroup<T> = { key: string; label: string | null; items: T[] };

/** Group only verified physical identities. An address or matching label is not identity. */
export function propertyAssetGroups<T extends Asset>(assets: T[]): PropertyAssetGroup<T>[] {
  const groups = new Map<string, PropertyAssetGroup<T>>();
  for (const asset of assets) {
    const siteId = asset._assetKind !== 'hotel' && typeof asset.site_id === 'string'
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(asset.site_id)
      ? asset.site_id.toLowerCase() : null;
    const key = siteId ? `site:${siteId}` : `asset:${asset.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: siteId ? asset.site_label?.trim() || 'Compound or building' : null, items: [] };
      groups.set(key, group);
    }
    group.items.push(asset);
  }
  return [...groups.values()];
}
