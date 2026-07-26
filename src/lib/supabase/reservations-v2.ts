// ═══════════════════════════════════════════════════════════
// Reservation System v2 — Backend-Enforced
// All business rules are enforced server-side via RPCs.
// ═══════════════════════════════════════════════════════════

import { supabase } from './client';

// ─── Create reservation (triggers double-reservation prevention + expiry) ───
export async function createReservationV2(
  listingId: string,
  userId: string,
  listingSnapshot?: { title: string; price: number; location: string }
) {
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      listing_id: listingId,
      user_id: userId,
      listing_title: listingSnapshot?.title || '',
      listing_price: listingSnapshot?.price || 0,
      listing_location: listingSnapshot?.location || '',
      status: 'active',
      amount: listingSnapshot?.price ? Math.round(listingSnapshot.price * 0.05) : 5000, // 5% or default
      currency: 'NGN',
    })
    .select()
    .single();

  return { reservation: data, error };
}

// ─── Process refund (server-side calculation) ───
export async function processReservationRefund(
  reservationId: string,
  reasonCategory: 'expired_no_action' | 'customer_declined_inspection' | 'provider_failure' | 'listing_mismatch' | 'manual_override',
  reasonDetail?: string,
  manualPercent?: number
) {
  const { data, error } = await supabase.rpc('process_reservation_refund', {
    p_reservation_id: reservationId,
    p_reason_category: reasonCategory,
    p_reason_detail: reasonDetail || null,
    p_manual_percent: manualPercent || null,
  });
  return { success: data, error };
}

// ─── Expire overdue reservations (call periodically or via cron) ───
export async function expireOverdueReservations() {
  const { data, error } = await supabase.rpc('expire_overdue_reservations');
  return { count: data, error };
}

// ─── Complete inspection with result ───
export async function completeInspectionResult(
  inspectionId: string,
  result: 'passed' | 'failed' | 'customer_declined'
) {
  const { data, error } = await supabase.rpc('complete_inspection_result', {
    p_inspection_id: inspectionId,
    p_result: result,
  });
  return { success: data, error };
}

// ─── Calculate refund preview (before processing) ───
export async function calculateReservationRefund(
  reservationId: string,
  reasonCategory: string
) {
  const { data, error } = await supabase.rpc('calculate_reservation_refund', {
    p_reservation_id: reservationId,
    p_reason_category: reasonCategory,
  }).single();
  return { result: data, error };
}
