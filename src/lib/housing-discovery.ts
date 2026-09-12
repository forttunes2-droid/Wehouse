import { supabase } from '@/lib/supabase';
import type { Listing } from '@/types';

export type HomeStayType = 'long_stay' | 'short_let';

export async function getDiscoverableHomes() {
  const { data, error } = await supabase.rpc('get_discoverable_listings');

  // The server RPC is the publication/operational boundary. Short Let date
  // occupancy is checked separately for the requested interval; the client must
  // never re-introduce globally reserved/occupied rows just because they are
  // Short Lets.
  const homes = ((data || []) as Listing[]).filter((listing) => {
    const type = String(listing.property_type || 'apartment').toLowerCase();
    if (type === 'hotel') return false;
    return listing.status === 'available' &&
      String(listing.availability_status || 'available') === 'available';
  });

  return { homes, error };
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
