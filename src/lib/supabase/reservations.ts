import { supabase } from './client';
import { WEHOUSE_FEES } from '@/types';

// ─── RESERVATIONS ─────────────────────────────────
// NOTE: This creates a reservation RECORD only. Actual payment collection
// requires Paystack integration (Phase 8). Until then, staff manually
// confirm payments via Creator Dashboard > Operations.

export async function createReservation(
  listingId: string,
  userId: string,
  listingSnapshot?: { title: string; price: number; location: string }
) {
  // Check if already has pending/paid reservation for this listing
  const { data: existing } = await supabase
    .from('reservations')
    .select('*')
    .eq('listing_id', listingId)
    .eq('user_id', userId)
    .in('status', ['pending', 'paid', 'inspection_scheduled'])
    .maybeSingle();

  if (existing) {
    return { reservation: existing as any, error: null, alreadyExists: true };
  }

  // Get user profile for contact info
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, phone')
    .eq('user_id', userId)
    .maybeSingle();

  const { data, error } = await supabase.from('reservations').insert({
    listing_id: listingId,
    user_id: userId,
    user_email: profile?.email || '',
    user_phone: profile?.phone || '',
    listing_title: listingSnapshot?.title || '',
    listing_price: listingSnapshot?.price || 0,
    listing_location: listingSnapshot?.location || '',
    status: 'active',
    manual_payment_status: 'unpaid',
    amount: WEHOUSE_FEES.RESERVATION_FEE, // Uses Creator-configured fee (default N5,000)
    currency: 'NGN',
    support_phone: 'support@wehouse.com.ng', // Contact for manual payment confirmation
  }).select();

  return { reservation: data?.[0] as any || null, error, alreadyExists: false };
}

export async function getReservationForListing(listingId: string, userId: string) {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('listing_id', listingId)
    .eq('user_id', userId)
    .in('status', ['pending', 'paid', 'inspection_scheduled'])
    .maybeSingle();
  return { reservation: data as any, error };
}

export async function getReservationsForUser(userId: string) {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { reservations: data as any[] | null, error };
}

export async function cancelReservation(reservationId: string) {
  const { error } = await supabase
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('id', reservationId);
  return { error };
}

export async function markSupportContacted(reservationId: string) {
  const { error } = await supabase
    .from('reservations')
    .update({ support_contacted: true, updated_at: new Date().toISOString() })
    .eq('id', reservationId);
  return { error };
}

// ═══════════════════════════════════════════════════════════
// HOTELS — Browse, Book, Manage
// ═══════════════════════════════════════════════════════════
