import { supabase } from '@/lib/supabase';
import type { Listing } from '@/types';

export type HomeStayType = 'long_stay' | 'short_let';

export async function getDiscoverableHomes() {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .in('status', ['available', 'occupied'])
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const homes = ((data || []) as Listing[]).filter((listing) => {
    const type = String(listing.property_type || 'apartment').toLowerCase();
    if (type === 'hotel') return false;
    if (listing.status === 'available') return true;
    // A currently occupied Short Stay can still have free future dates.
    return listing.sub_type === 'short_let';
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
