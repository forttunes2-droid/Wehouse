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

  if (filters?.state) query = query.ilike('state', `%${filters.state}%`);
  if (filters?.city) query = query.ilike('city', `%${filters.city}%`);
  if (filters?.featured) query = query.eq('featured', true);
  if (filters?.search) query = query.ilike('name', `%${filters.search}%`);

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
  void userId;
  const { data, error } = await supabase.rpc('create_my_verified_hotel_review', { p_hotel_id: hotelId, p_rating: rating, p_comment: comment || null });
  return { review: data as HotelReview | null, error };
}

// ── Bookings ────────────────────────────────────────────

// The browser supplies guest choices only. Identity, availability, room price,
// nights, total and pending-hold status are computed again by Postgres.
export async function createHotelBooking(booking: Omit<HotelBooking, 'booking_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.rpc('create_my_hotel_booking', {
    p_hotel_id: booking.hotel_id,
    p_room_id: booking.room_id,
    p_check_in: booking.check_in,
    p_check_out: booking.check_out,
    p_guest_count: booking.guest_count,
    p_guest_name: booking.guest_name,
    p_guest_phone: booking.guest_phone,
    p_special_requests: booking.special_requests || null,
  });
  return { booking: data as HotelBooking | null, error };
}

export async function initializeHotelBookingPayment(bookingId: number) {
  const { data: bootstrap, error: bootstrapError } = await supabase.rpc('create_hotel_booking_payment', {
    p_booking_id: bookingId,
  });
  if (bootstrapError) return { result: null, error: bootstrapError };
  if (!bootstrap?.success) return { result: bootstrap || null, error: null };
  if (bootstrap.already_paid) return { result: bootstrap, error: null };

  const reference = String(bootstrap.reference || '');
  if (!reference) return { result: { success: false, error: 'Hotel payment reference is missing' }, error: null };
  const { data, error } = await supabase.functions.invoke('payment-init', { body: { reference } });
  return { result: data as any, error };
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
  if (status === 'cancelled') {
    const { error } = await supabase.rpc('cancel_my_hotel_booking', { p_booking_id: bookingId });
    return { error };
  }
  return { error: { message: 'Hotel booking status is controlled by the verified booking workflow.' } as any };
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
  const { data, error } = await supabase.from('hotels').insert(hotel).select().maybeSingle();
  return { hotel: data as Hotel | null, error };
}

export async function updateHotel(hotelId: number, updates: Partial<Hotel>) {
  const { data, error } = await supabase.from('hotels').update({ ...updates, updated_at: new Date().toISOString() }).eq('hotel_id', hotelId).select().maybeSingle();
  return { hotel: data as Hotel | null, error };
}

export async function deleteHotel(hotelId: number) {
  const { error } = await supabase.from('hotels').delete().eq('hotel_id', hotelId);
  return { error };
}

export async function createHotelRoom(room: Omit<HotelRoom, 'room_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.from('hotel_rooms').insert(room).select().maybeSingle();
  return { room: data as HotelRoom | null, error };
}

export async function updateHotelRoom(roomId: number, updates: Partial<HotelRoom>) {
  const { data, error } = await supabase.from('hotel_rooms').update({ ...updates, updated_at: new Date().toISOString() }).eq('room_id', roomId).select().maybeSingle();
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
