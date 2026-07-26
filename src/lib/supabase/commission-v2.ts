// ═══════════════════════════════════════════════════════════
// Commission System v2 — Server-Side Calculation
// Commission rates are read from platform_settings and persisted on transactions.
// ═══════════════════════════════════════════════════════════

import { supabase } from './client';

// ─── Create worker booking with server-side commission calc ───
export async function createWorkerBookingV2(
  userId: string,
  workerId: string,
  agreedPrice: number,
  serviceType?: string,
  address?: string,
  notes?: string
) {
  const { data, error } = await supabase.rpc('create_worker_booking_v2', {
    p_user_id: userId,
    p_worker_id: workerId,
    p_agreed_price: agreedPrice,
    p_service_type: serviceType || null,
    p_address: address || null,
    p_notes: notes || null,
  });
  return { bookingId: data, error };
}

// ─── Create rent plan with snapshotted settings ───
export async function createRentPlan(
  userId: string,
  listingId: string,
  targetAmount: number
) {
  const { data, error } = await supabase.rpc('create_rent_plan', {
    p_user_id: userId,
    p_listing_id: listingId,
    p_target_amount: targetAmount,
  });
  return { planId: data, error };
}

// ─── Cancel rent plan with server-side fee calc ───
export async function cancelRentPlan(
  planId: string,
  reason?: string,
  reasonCategory?: 'voluntary' | 'provider_failure' | 'other'
) {
  const { data, error } = await supabase.rpc('cancel_rent_plan', {
    p_plan_id: planId,
    p_reason: reason || null,
    p_reason_category: reasonCategory || 'voluntary',
  });
  return { result: data, error };
}
