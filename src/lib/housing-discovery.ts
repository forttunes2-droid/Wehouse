import { supabase } from '@/lib/supabase';
import type { Listing } from '@/types';

export type HomeStayType = 'long_stay' | 'short_let';

export type HomeSearchFilters = {
  query?: string;
  state?: string;
  city?: string;
  stayType?: HomeStayType | 'all';
  minPrice?: number | '';
  maxPrice?: number | '';
  bedrooms?: number | '';
  bathrooms?: number | '';
};
export type HomePageCursor = { createdAt: string; id: string };

export async function getDiscoverableHomes(filters: HomeSearchFilters = {}, cursor: HomePageCursor | null = null) {
  const { data, error } = await supabase.rpc('search_discoverable_homes', {
    p_query: filters.query?.trim() || null,
    p_state: filters.state || null,
    p_city: filters.city || null,
    p_stay_type: filters.stayType === 'all' ? null : filters.stayType || null,
    p_min_price: filters.minPrice === '' ? null : filters.minPrice ?? null,
    p_max_price: filters.maxPrice === '' ? null : filters.maxPrice ?? null,
    p_min_bedrooms: filters.bedrooms === '' ? null : filters.bedrooms ?? null,
    p_min_bathrooms: filters.bathrooms === '' ? null : filters.bathrooms ?? null,
    p_cursor_created_at: cursor?.createdAt || null,
    p_cursor_id: cursor?.id || null,
    p_limit: 24,
  });

  // The server RPC is the publication/operational boundary. Short Let date
  // occupancy is checked separately for the requested interval; the client must
  // never re-introduce globally reserved/occupied rows just because they are
  // Short Lets.
  const homes = ((data?.items || []) as Listing[]).filter((listing) => {
    const type = String(listing.property_type || 'apartment').toLowerCase();
    if (type === 'hotel') return false;
    return listing.status === 'available' &&
      String(listing.availability_status || 'available') === 'available';
  });

  return {
    homes,
    hasMore: Boolean(data?.has_more),
    nextCursor: data?.next_cursor_created_at && data?.next_cursor_id
      ? { createdAt: String(data.next_cursor_created_at), id: String(data.next_cursor_id) }
      : null,
    error,
  };
}

export async function getUnavailableShortStayListingIds(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) return { ids: new Set<string>(), error: null };
  const { data, error } = await supabase.rpc('get_short_stay_unavailable_listing_ids', {
    p_check_in: checkIn,
    p_check_out: checkOut,
  });
  const ids = new Set<string>((Array.isArray(data) ? data : []).map((row: any) => String(row.listing_id)));
  return { ids, error };
}
