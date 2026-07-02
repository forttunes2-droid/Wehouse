import { supabase } from './client';
import type { Hotel, HotelRoom, HotelBooking, HotelReview } from '@/types';
import { compressImageFile } from './utils';

// ── Browse Hotels ──────────────────────────────────────

export async function getHotels(filters?: {
  state?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  amenities?: string[];
  search?: string;
  featured?: boolean;
}) {
  let query = supabase
    .from('hotels')
    .select('*, hotel_rooms(room_id, price_per_night, room_type)')
    .eq('status', 'active');

  if (filters?.state) {
    query = query.ilike('state', `%${filters.state}%`);
  }
  if (filters?.city) {
    query = query.ilike('city', `%${filters.city}%`);
  }
  if (filters?.featured) {
    query = query.eq('featured', true);
  }
  if (filters?.search) {
    query = query.ilike('name', `%${filters.search}%`);
  }

  const { data, error } = await query.order('featured', { ascending: false }).order('created_at', { ascending: false });
  return { hotels: data as (Hotel & { hotel_rooms: { room_id: number; price_per_night: number; room_type: string }[] })[] | null, error };
}

export async function getHotelById(hotelId: number) {
  const { data, error } = await supabase
    .from('hotels')
    .select('*, hotel_rooms(*)')
    .eq('hotel_id', hotelId)
    .maybeSingle();
  return { hotel: data as (Hotel & { hotel_rooms: HotelRoom[] }) | null, error };
}

export async function getHotelRooms(hotelId: number) {
  const { data, error } = await supabase
    .from('hotel_rooms')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('price_per_night', { ascending: true });
  return { rooms: data as HotelRoom[] | null, error };
}

export async function getRoomById(roomId: number) {
  const { data, error } = await supabase
    .from('hotel_rooms')
    .select('*, hotels(*)')
    .eq('room_id', roomId)
    .maybeSingle();
  return { room: data as (HotelRoom & { hotels: Hotel }) | null, error };
}

// ── Reviews ────────────────────────────────────────────

export async function getHotelReviews(hotelId: number) {
  const { data, error } = await supabase
    .from('hotel_reviews')
    .select('*, profiles(username, avatar_url)')
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: false });
  return { reviews: data as (HotelReview & { profiles: { username: string | null; avatar_url: string | null } })[] | null, error };
}

export async function addHotelReview(hotelId: number, userId: string, rating: number, comment?: string) {
  const { data, error } = await supabase
    .from('hotel_reviews')
    .insert({ hotel_id: hotelId, user_id: userId, rating, comment: comment || null })
    .select()
    .maybeSingle();
  // Update hotel average rating
  if (!error) {
    const { data: allReviews } = await supabase
      .from('hotel_reviews')
      .select('rating')
      .eq('hotel_id', hotelId);
    if (allReviews) {
      const avg = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
      await supabase.from('hotels').update({
        rating: Math.round(avg * 10) / 10,
        review_count: allReviews.length,
      }).eq('hotel_id', hotelId);
    }
  }
  return { review: data as HotelReview | null, error };
}

// ── Bookings ───────────────────────────────────────────

export async function createHotelBooking(booking: Omit<HotelBooking, 'booking_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('hotel_bookings')
    .insert(booking)
    .select()
    .maybeSingle();
  return { booking: data as HotelBooking | null, error };
}

export async function getHotelBookingsForUser(userId: string) {
  const { data, error } = await supabase
    .from('hotel_bookings')
    .select('*, hotels(name, city, state, images), hotel_rooms(room_type, bed_type)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { bookings: data as (HotelBooking & { hotels: Hotel; hotel_rooms: HotelRoom })[] | null, error };
}

export async function getHotelBookingsForHotel(hotelId: number) {
  const { data, error } = await supabase
    .from('hotel_bookings')
    .select('*, profiles(username, phone), hotel_rooms(room_type)')
    .eq('hotel_id', hotelId)
    .order('check_in', { ascending: true });
  return { bookings: data as (HotelBooking & { profiles: { username: string | null; phone: string | null }; hotel_rooms: { room_type: string } })[] | null, error };
}

export async function updateBookingStatus(bookingId: number, status: HotelBooking['status']) {
  const { error } = await supabase
    .from('hotel_bookings')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('booking_id', bookingId);
  return { error };
}

// ── Hotel Owner Dashboard (CRUD) ───────────────────────

export async function getHotelsByOwner(ownerId: string) {
  const { data, error } = await supabase
    .from('hotels')
    .select('*, hotel_rooms(*)')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  return { hotels: data as (Hotel & { hotel_rooms: HotelRoom[] })[] | null, error };
}

export async function createHotel(hotel: Omit<Hotel, 'hotel_id' | 'rating' | 'review_count' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('hotels')
    .insert(hotel)
    .select()
    .maybeSingle();
  return { hotel: data as Hotel | null, error };
}

export async function updateHotel(hotelId: number, updates: Partial<Hotel>) {
  const { data, error } = await supabase
    .from('hotels')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('hotel_id', hotelId)
    .select()
    .maybeSingle();
  return { hotel: data as Hotel | null, error };
}

export async function deleteHotel(hotelId: number) {
  const { error } = await supabase.from('hotels').delete().eq('hotel_id', hotelId);
  return { error };
}

export async function createHotelRoom(room: Omit<HotelRoom, 'room_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('hotel_rooms')
    .insert(room)
    .select()
    .maybeSingle();
  return { room: data as HotelRoom | null, error };
}

export async function updateHotelRoom(roomId: number, updates: Partial<HotelRoom>) {
  const { data, error } = await supabase
    .from('hotel_rooms')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('room_id', roomId)
    .select()
    .maybeSingle();
  return { room: data as HotelRoom | null, error };
}

export async function deleteHotelRoom(roomId: number) {
  const { error } = await supabase.from('hotel_rooms').delete().eq('room_id', roomId);
  return { error };
}

// ── Upload hotel images ────────────────────────────────

export async function uploadHotelImage(file: File, hotelId: number) {
  if (!file.type.startsWith('image/')) return { url: null, error: { message: 'Please select an image' } as any };
  try {
    const compressed = await compressImageFile(file, 1200, 0.8);
    const path = `hotels/${hotelId}/${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage.from('listings').upload(path, compressed, { contentType: 'image/jpeg', cacheControl: '3600' });
    if (uploadError) return { url: null, error: uploadError };
    const { data } = supabase.storage.from('listings').getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  } catch (err: any) {
    return { url: null, error: { message: err.message || 'Upload failed' } };
  }
}

export async function uploadRoomImage(file: File, hotelId: number, roomId: number) {
  if (!file.type.startsWith('image/')) return { url: null, error: { message: 'Please select an image' } as any };
  try {
    const compressed = await compressImageFile(file, 1200, 0.8);
    const path = `hotels/${hotelId}/rooms/${roomId}/${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage.from('listings').upload(path, compressed, { contentType: 'image/jpeg', cacheControl: '3600' });
    if (uploadError) return { url: null, error: uploadError };
    const { data } = supabase.storage.from('listings').getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  } catch (err: any) {
    return { url: null, error: { message: err.message || 'Upload failed' } };
  }
}

