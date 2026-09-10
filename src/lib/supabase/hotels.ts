import { supabase } from './client';
import type { Hotel, HotelRoom, HotelBooking, HotelReview, HotelRatePlan, HotelVenue } from '@/types';
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
  const { data, error } = await supabase.rpc('get_discoverable_hotels');
  const rows = (Array.isArray(data) ? data : []) as (Hotel & { hotel_rooms: { room_id: number; price_per_night: number; room_type: string }[] })[];
  const includes = (value: unknown, query: string) => String(value || '').toLowerCase().includes(query.toLowerCase());
  const hotels = rows.filter((hotel) => {
    if (filters?.state && !includes(hotel.state, filters.state)) return false;
    if (filters?.city && !includes(hotel.city, filters.city)) return false;
    if (filters?.featured && !hotel.featured) return false;
    if (filters?.search && !includes(hotel.name, filters.search)) return false;
    if (filters?.amenities?.length && !filters.amenities.every((item) => hotel.amenities?.includes(item))) return false;
    if (filters?.minPrice != null || filters?.maxPrice != null) {
      const prices = (hotel.hotel_rooms || []).map((room) => Number(room.price_per_night || 0));
      if (!prices.some((price) => (filters.minPrice == null || price >= filters.minPrice) && (filters.maxPrice == null || price <= filters.maxPrice))) return false;
    }
    return true;
  });
  return { hotels, error };
}

export async function getHotelById(hotelId: number) {
  const { data, error } = await supabase.rpc('get_public_hotel_detail', { p_hotel_id: hotelId });
  return { hotel: data as (Hotel & { hotel_rooms: HotelRoom[]; venues?: HotelVenue[] }) | null, error };
}

export async function getHotelRooms(hotelId: number) {
  const { data, error } = await supabase
    .from('hotel_rooms')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('price_per_night', { ascending: true });
  return { rooms: data as HotelRoom[] | null, error };
}

export async function getRoomById(roomId: number, hotelId?: number) {
  let resolvedHotelId = hotelId;
  if (!resolvedHotelId) {
    const roomResult = await supabase.from('hotel_rooms').select('hotel_id').eq('room_id', roomId).maybeSingle();
    if (roomResult.error || !roomResult.data) return { room: null, error: roomResult.error };
    resolvedHotelId = Number(roomResult.data.hotel_id);
  }
  const result = await getHotelById(resolvedHotelId);
  const room = result.hotel?.hotel_rooms?.find((item) => Number(item.room_id) === Number(roomId));
  return { room: room && result.hotel ? { ...room, hotels: result.hotel } : null, error: result.error };
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

export async function canReviewHotel(hotelId: number, userId: string) {
  const { data, error } = await supabase
    .from('hotel_bookings')
    .select('booking_id')
    .eq('hotel_id', hotelId)
    .eq('user_id', userId)
    .eq('payment_status', 'paid')
    .in('status', ['checked_out', 'completed'])
    .limit(1);
  return { eligible: Boolean(data?.length), error };
}

// ── Bookings ────────────────────────────────────────────

// The browser supplies guest choices only. Identity, availability, room price,
// nights, total and pending-hold status are computed again by Postgres.
export async function createHotelBooking(booking: Omit<HotelBooking, 'booking_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.rpc('create_my_hotel_booking_with_rate', {
    p_hotel_id: booking.hotel_id,
    p_room_id: booking.room_id,
    p_rate_plan_id: booking.rate_plan_id,
    p_check_in: booking.check_in,
    p_check_out: booking.check_out,
    p_guest_count: booking.guest_count,
    p_guest_name: booking.guest_name,
    p_guest_phone: booking.guest_phone,
    p_special_requests: booking.special_requests || null,
  });
  return { booking: data as HotelBooking | null, error };
}

export async function quoteHotelRoomRate(input: {
  hotelId: number;
  roomId: number;
  ratePlanId: number;
  checkIn: string;
  checkOut: string;
}) {
  const { data, error } = await supabase.rpc('quote_hotel_room_rate', {
    p_hotel_id: input.hotelId,
    p_room_id: input.roomId,
    p_rate_plan_id: input.ratePlanId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
  });
  return { quote: data as { available: boolean; nights?: number; total_price?: number; blocked_date?: string; rate_plan_name?: string } | null, error };
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
  void userId;
  const { data, error } = await supabase.rpc('get_my_hotel_bookings');
  return { bookings: (Array.isArray(data) ? data : []) as (HotelBooking & { hotels: Hotel; hotel_rooms: HotelRoom; hotel_rate_plans?: HotelRatePlan | null })[], error };
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

export async function partnerCreateHotelRoom(room: Omit<HotelRoom, 'room_id' | 'created_at' | 'updated_at' | 'rate_plans'>) {
  const { data, error } = await supabase.rpc('partner_create_hotel_room', {
    p_hotel_id: room.hotel_id,
    p_room_type: room.room_type,
    p_description: room.description,
    p_price_per_night: room.price_per_night,
    p_max_guests: room.max_guests,
    p_bed_type: room.bed_type,
    p_total_rooms: room.total_rooms,
    p_amenities: room.amenities || [],
    p_images: room.images || [],
  });
  return { room: data as HotelRoom | null, error };
}

export async function partnerSaveHotelRatePlan(plan: Partial<HotelRatePlan> & Pick<HotelRatePlan, 'room_id' | 'name' | 'meal_plan' | 'payment_timing' | 'refundable' | 'price_per_night'>) {
  const { data, error } = await supabase.rpc('partner_save_hotel_rate_plan', {
    p_rate_plan_id: plan.rate_plan_id || null,
    p_room_id: plan.room_id,
    p_name: plan.name,
    p_description: plan.description || null,
    p_meal_plan: plan.meal_plan,
    p_payment_timing: plan.payment_timing,
    p_refundable: plan.refundable,
    p_cancellation_hours: plan.refundable ? plan.cancellation_hours ?? 24 : null,
    p_price_per_night: plan.price_per_night,
    p_included_features: plan.included_features || [],
    p_active: plan.active ?? true,
  });
  return { plan: data as HotelRatePlan | null, error };
}

export async function partnerSaveHotelVenue(venue: Partial<HotelVenue> & Pick<HotelVenue, 'hotel_id' | 'name' | 'kind'>) {
  const { data, error } = await supabase.rpc('partner_save_hotel_venue', {
    p_venue_id: venue.venue_id || null,
    p_hotel_id: venue.hotel_id,
    p_name: venue.name,
    p_kind: venue.kind,
    p_description: venue.description || null,
    p_opening_hours: venue.opening_hours || null,
    p_package_notes: venue.package_notes || null,
    p_active: venue.active ?? true,
  });
  return { venue: data as HotelVenue | null, error };
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
    const path = `hotels/${hotelId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage.from('listing-images').upload(path, compressed, { contentType: 'image/jpeg', cacheControl: '3600' });
    if (uploadError) return { url: null, error: uploadError };
    const { data } = supabase.storage.from('listing-images').getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  } catch (err: any) {
    return { url: null, error: { message: err.message || 'Upload failed' } };
  }
}

export async function uploadRoomImage(file: File, hotelId: number, roomId: number) {
  if (!file.type.startsWith('image/')) return { url: null, error: { message: 'Please select an image' } as any };
  try {
    const compressed = await compressImageFile(file, 1200, 0.8);
    const path = `hotels/${hotelId}/rooms/${roomId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage.from('listing-images').upload(path, compressed, { contentType: 'image/jpeg', cacheControl: '3600' });
    if (uploadError) return { url: null, error: uploadError };
    const { data } = supabase.storage.from('listing-images').getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  } catch (err: any) {
    return { url: null, error: { message: err.message || 'Upload failed' } };
  }
}
