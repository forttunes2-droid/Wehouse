import { supabase } from './client';

export async function getMySavedHotelIds() {
  const { data, error } = await supabase
    .from('saved_hotels')
    .select('hotel_id')
    .order('created_at', { ascending: false });
  return {
    hotelIds: (data || []).map((row) => Number(row.hotel_id)).filter(Number.isFinite),
    error,
  };
}

export async function saveHotel(hotelId: number) {
  const { error } = await supabase.rpc('save_my_hotel', { p_hotel_id: hotelId });
  return { error };
}

export async function unsaveHotel(hotelId: number) {
  const { error } = await supabase.rpc('unsave_my_hotel', { p_hotel_id: hotelId });
  return { error };
}
