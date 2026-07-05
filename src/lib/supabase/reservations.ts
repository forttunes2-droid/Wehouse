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
    .in('status', ['pending', 'approved_for_verification', 'inspection_scheduled'])
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
    .in('status', ['pending', 'approved_for_verification', 'inspection_scheduled'])
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

export async function updateReservationPlan(reservationId: string, planYears: number) {
  const { data, error } = await supabase
    .from('reservations')
    .update({ rental_plan_years: planYears, rental_plan_selected_at: new Date().toISOString() })
    .eq('id', reservationId)
    .select()
    .maybeSingle();
  return { reservation: data as any, error };
}

export async function markSupportContacted(reservationId: string) {
  const { error } = await supabase
    .from('reservations')
    .update({ support_contacted: true, updated_at: new Date().toISOString() })
    .eq('id', reservationId);
  return { error };
}

// ═══════════════════════════════════════════════════════════
// USER INSPECTION REQUESTS (after reservation)
// ═══════════════════════════════════════════════════════════

export async function createInspectionRequest(
  reservationId: string,
  listingId: string,
  userId: string,
  notes?: string
) {
  // Check if one already exists for this reservation
  const { data: existing } = await supabase
    .from('user_inspection_requests')
    .select('id')
    .eq('reservation_id', reservationId)
    .in('status', ['pending', 'scheduled', 'in_progress'])
    .maybeSingle();

  if (existing) {
    return { inspection: existing as any, error: null, alreadyExists: true };
  }

  const { data, error } = await supabase
    .from('user_inspection_requests')
    .insert({
      reservation_id: reservationId,
      listing_id: listingId,
      user_id: userId,
      notes: notes || null,
      status: 'pending',
    })
    .select()
    .maybeSingle();

  return { inspection: data as any, error, alreadyExists: false };
}

export async function getInspectionRequestForReservation(reservationId: string) {
  const { data, error } = await supabase
    .from('user_inspection_requests')
    .select('*, listings(title, city, state, images)')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { inspection: data as any, error };
}

export async function getInspectionRequestsForUser(userId: string) {
  const { data, error } = await supabase
    .from('user_inspection_requests')
    .select('*, listings(title, city, state, images)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { inspections: data as any[] | null, error };
}

export async function getPendingInspectionRequests() {
  const { data, error } = await supabase
    .from('user_inspection_requests')
    .select('*, listings(title, city, state), profiles!user_inspection_requests_user_id_fkey(username, full_name, phone)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return { inspections: data as any[] | null, error };
}

export async function getInspectionRequestsForFieldOfficer(fieldOfficerId: string) {
  // Query BOTH tables — user_inspection_requests (field_officer_id) and inspection_requests (assigned_to)
  const [userReqs, partnerReqs] = await Promise.all([
    supabase
      .from('user_inspection_requests')
      .select('*, listings(title, city, state, address, images)')
      .eq('field_officer_id', fieldOfficerId)
      .in('status', ['scheduled', 'in_progress'])
      .order('scheduled_date', { ascending: true }),
    supabase
      .from('inspection_requests')
      .select('*')
      .eq('assigned_to', fieldOfficerId)
      .in('status', ['scheduled', 'in_progress'])
      .order('scheduled_date', { ascending: true }),
  ]);

  // Normalize partner records to match user record shape
  const normalizedPartners = (partnerReqs.data || []).map((p: any) => ({
    ...p,
    _source: 'partner', // marker so UI can tell them apart
    inspection_code: p.request_code,
    contact_name: p.owner_id, // will be looked up by OfficerName if needed
    contact_phone: p.owner_phone,
    // Map property fields to listing-like structure for unified rendering
    listings: {
      title: p.property_address || 'Property Inspection',
      address: p.property_address,
      city: p.property_city,
      state: p.property_state,
      images: p.photo_urls || [],
    },
  }));

  const allInspections = [
    ...(userReqs.data || []),
    ...normalizedPartners,
  ];

  return { inspections: allInspections, error: userReqs.error || partnerReqs.error };
}

export async function assignFieldOfficer(inspectionId: string, fieldOfficerId: string, scheduledDate?: string) {
  // Try user_inspection_requests first (field_officer_id column)
  const userUpdate: Record<string, any> = {
    field_officer_id: fieldOfficerId,
    status: 'scheduled',
    updated_at: new Date().toISOString(),
  };
  if (scheduledDate) userUpdate.scheduled_date = scheduledDate;

  const userResult = await supabase
    .from('user_inspection_requests')
    .update(userUpdate)
    .eq('id', inspectionId)
    .select()
    .maybeSingle();

  if (userResult.data) {
    return { inspection: userResult.data as any, error: null };
  }

  // If not found in user_inspection_requests, try inspection_requests (assigned_to column)
  const partnerUpdate: Record<string, any> = {
    assigned_to: fieldOfficerId,
    status: 'scheduled',
    updated_at: new Date().toISOString(),
  };
  if (scheduledDate) partnerUpdate.scheduled_date = scheduledDate;

  const partnerResult = await supabase
    .from('inspection_requests')
    .update(partnerUpdate)
    .eq('id', inspectionId)
    .select()
    .maybeSingle();

  return { inspection: partnerResult.data as any, error: partnerResult.error };
}

export async function startInspection(inspectionId: string) {
  const { data, error } = await supabase
    .from('user_inspection_requests')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', inspectionId)
    .select()
    .maybeSingle();
  return { inspection: data as any, error };
}

export async function completeInspection(
  inspectionId: string,
  report: string,
  condition: string,
  photoUrls?: string[]
) {
  const { data, error } = await supabase
    .from('user_inspection_requests')
    .update({
      status: 'completed',
      report,
      condition,
      photo_urls: photoUrls || [],
      updated_at: new Date().toISOString(),
    })
    .eq('id', inspectionId)
    .select()
    .maybeSingle();
  return { inspection: data as any, error };
}

export async function cancelInspectionRequest(inspectionId: string) {
  const { error } = await supabase
    .from('user_inspection_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', inspectionId);
  return { error };
}

// ═══════════════════════════════════════════════════════════
// HOTELS — Browse, Book, Manage
// ═══════════════════════════════════════════════════════════
