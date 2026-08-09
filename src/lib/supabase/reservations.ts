import { supabase } from './client';

const ACTIVE_RESERVATION_STATUSES = ['active', 'inspection_pending'];
const ACTIVE_INSPECTION_STATUSES = ['pending', 'scheduled', 'in_progress'];

// Canonical apartment reservation API. Identity, availability, fee and duplicate
// prevention are enforced by the database; caller-supplied user or price data is ignored.
export async function createReservation(
  listingId: string,
  _userId?: string,
  _listingSnapshot?: { title: string; price: number; location: string }
) {
  const { data, error } = await supabase.rpc('create_apartment_reservation', {
    p_listing_id: listingId,
  });

  return {
    reservation: data as any || null,
    error,
    alreadyExists: false,
  };
}

export async function getReservationForListing(listingId: string, _userId?: string) {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('listing_id', listingId)
    .in('status', ACTIVE_RESERVATION_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return { reservation: data as any, error };
}

export async function getReservationsForUser(_userId?: string) {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .order('created_at', { ascending: false });

  return { reservations: data as any[] | null, error };
}

export async function cancelReservation(reservationId: string) {
  const { data, error } = await supabase.rpc('cancel_my_apartment_reservation', {
    p_reservation_id: reservationId,
  });
  return { reservation: data as any || null, error };
}

export async function updateReservationPlan(reservationId: string, planYears: number) {
  const { data, error } = await supabase.rpc('update_my_reservation_plan', {
    p_reservation_id: reservationId,
    p_plan_years: planYears,
  });
  return { reservation: data as any || null, error };
}

export async function markSupportContacted(reservationId: string) {
  const { data, error } = await supabase.rpc('mark_my_reservation_support_contacted', {
    p_reservation_id: reservationId,
  });
  return { reservation: data as any || null, error };
}

// USER INSPECTION REQUESTS (after reservation)
export async function createInspectionRequest(
  reservationId: string,
  _listingId?: string,
  _userId?: string,
  notes?: string
) {
  const { data, error } = await supabase.rpc('create_user_inspection_request', {
    p_reservation_id: reservationId,
    p_notes: notes || null,
  });

  return {
    inspection: data as any || null,
    error,
    alreadyExists: false,
  };
}

export async function getInspectionRequestForReservation(reservationId: string) {
  const { data, error } = await supabase
    .from('user_inspection_requests')
    .select('*')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { inspection: data as any, error };
}

export async function getInspectionRequestsForUser(_userId?: string) {
  const { data, error } = await supabase
    .from('user_inspection_requests')
    .select('*')
    .order('created_at', { ascending: false });
  return { inspections: data as any[] | null, error };
}

export async function getPendingInspectionRequests() {
  const { data, error } = await supabase
    .from('user_inspection_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return { inspections: data as any[] | null, error };
}

export async function getInspectionRequestsForFieldOfficer(fieldOfficerId: string) {
  const [userReqs, partnerReqs] = await Promise.all([
    supabase
      .from('user_inspection_requests')
      .select('*')
      .eq('field_officer_id', fieldOfficerId)
      .in('status', ['scheduled', 'in_progress'])
      .order('scheduled_date', { ascending: true }),
    supabase
      .from('inspection_requests')
      .select('*')
      .or(`assigned_to.eq.${fieldOfficerId},field_officer_id.eq.${fieldOfficerId},assigned_field_officer_id.eq.${fieldOfficerId}`)
      .in('status', ['scheduled', 'in_progress'])
      .order('scheduled_date', { ascending: true }),
  ]);

  const normalizedPartners = (partnerReqs.data || []).map((request: any) => ({
    ...request,
    _source: 'partner',
    inspection_code: request.request_code,
    contact_name: request.owner_id,
    contact_phone: request.owner_phone,
    listings: {
      title: request.property_address || 'Property Inspection',
      address: request.property_address,
      city: request.property_city,
      state: request.property_state,
      images: request.photo_urls || [],
    },
  }));

  return {
    inspections: [...(userReqs.data || []), ...normalizedPartners],
    error: userReqs.error || partnerReqs.error,
  };
}

export async function assignFieldOfficer(inspectionId: string, fieldOfficerId: string, scheduledDate?: string) {
  const { data, error } = await supabase.rpc('staff_assign_customer_inspection', {
    p_inspection_id: inspectionId,
    p_field_officer_id: fieldOfficerId,
    p_scheduled_date: scheduledDate || null,
  });
  return { inspection: data as any || null, error };
}

export async function startInspection(inspectionId: string) {
  const { data, error } = await supabase.rpc('staff_start_customer_inspection', {
    p_inspection_id: inspectionId,
  });
  return { inspection: data as any || null, error };
}

export async function completeInspection(
  inspectionId: string,
  report: string,
  condition: string,
  photoUrls?: string[]
) {
  const { data, error } = await supabase.rpc('staff_complete_customer_inspection', {
    p_inspection_id: inspectionId,
    p_report: report,
    p_condition: condition,
    p_photo_urls: photoUrls || [],
  });
  return { inspection: data as any || null, error };
}

export async function cancelInspectionRequest(inspectionId: string) {
  const { data, error } = await supabase.rpc('cancel_my_inspection_request', {
    p_inspection_id: inspectionId,
  });
  return { inspection: data as any || null, error };
}

export async function processReservationRefund(
  reservationId: string,
  reasonCategory: 'expired_no_action' | 'customer_declined_inspection' | 'provider_failure' | 'listing_mismatch',
  reasonDetail?: string
) {
  const { data, error } = await supabase.rpc('process_reservation_refund', {
    p_reservation_id: reservationId,
    p_reason_category: reasonCategory,
    p_reason_detail: reasonDetail || null,
  });
  return { success: data, error };
}

export async function calculateReservationRefund(reservationId: string, reasonCategory: string) {
  const { data, error } = await supabase.rpc('calculate_reservation_refund', {
    p_reservation_id: reservationId,
    p_reason_category: reasonCategory,
  }).single();
  return { result: data, error };
}

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

export async function expireOverdueReservations() {
  const { data, error } = await supabase.rpc('expire_overdue_reservations');
  return { count: data, error };
}
