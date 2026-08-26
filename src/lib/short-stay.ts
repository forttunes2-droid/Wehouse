import { supabase } from '@/lib/supabase';

export async function getMyShortStayReservations(listingId: string) {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('listing_id', listingId)
    .eq('stay_type', 'short_let')
    .in('status', ['payment_pending','reserved','inspection_pending','ready_for_move_in','occupied'])
    .order('stay_check_in', { ascending: true });
  return { reservations: data || [], error };
}

export async function createShortStayReservation(listingId: string, checkIn: string, checkOut: string) {
  const { data, error } = await supabase.rpc('create_short_stay_reservation', {
    p_listing_id: listingId,
    p_check_in: checkIn,
    p_check_out: checkOut,
  });
  return { reservation: data as any || null, error };
}

async function openPayment(reference: string) {
  const { data, error } = await supabase.functions.invoke('payment-init', { body: { reference } });
  return { result: data as any, error };
}

export async function initializeShortStayReservationFee(reference: string) {
  return openPayment(reference);
}

export async function initializeShortStayPayment(reservationId: string) {
  const { data: bootstrap, error: bootstrapError } = await supabase.rpc('create_short_stay_payment', {
    p_reservation_id: reservationId,
  });
  if (bootstrapError) return { result: null, error: bootstrapError };
  if (!bootstrap?.success || bootstrap?.already_paid) return { result: bootstrap || null, error: null };
  const reference = String(bootstrap.reference || '');
  if (!reference) return { result: { success: false, error: 'Short Let payment reference is missing' }, error: null };
  return openPayment(reference);
}
