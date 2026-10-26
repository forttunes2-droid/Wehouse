/** Literal, case-insensitive words across public fields; order does not matter.
 * Keep the 80-character bound aligned with private.discovery_text_matches.
 * Structured budget, dates and capacity constraints remain explicit filters.
 */
export function matchesDiscoveryText(fields: unknown[], query: string) {
  const words = Array.from(query.trim()).slice(0, 80).join('').toLowerCase().split(/\s+/u).filter(Boolean);
  const text = fields.filter(value => value != null).map(String).join(' ').toLowerCase();
  return words.every(word => text.includes(word));
}

export function homeDiscoveryFields(home: {
  title?: unknown; address?: unknown; city?: unknown; state?: unknown;
  home_style?: unknown; bedrooms?: number | null; space_scope?: unknown; sub_type?: unknown;
}) {
  return [home.title, home.address, home.city, home.state, home.home_style,
    home.bedrooms != null ? `${home.bedrooms} bedroom ${home.bedrooms} bed` : '',
    home.bedrooms === 0 && home.space_scope !== 'private_room' ? 'studio self-contained self contained' : '',
    home.sub_type === 'short_let' ? 'short let shortlet' : home.sub_type === 'long_stay' ? 'long let longlet' : ''];
}
