import { supabase } from './client';

// ═══════════════════════════════════════════════════════════════
// WORKER BOOKING NEGOTIATION API
// ═══════════════════════════════════════════════════════════════

// Step 1: Customer creates booking request
export async function createBookingRequest(
  userId: string,
  workerId: string,
  serviceType: string,
  description: string,
  address: string,
  scheduledDate: string,
  customerMessage?: string
) {
  const { data, error } = await supabase.rpc('create_booking_request', {
    p_user_id: userId,
    p_worker_id: workerId,
    p_service_type: serviceType,
    p_description: description,
    p_address: address,
    p_scheduled_date: scheduledDate,
    p_customer_message: customerMessage || null,
  });
  if (error) return { booking: null, error };
  return { booking: data?.[0] || null, error: null };
}

// Get all booking conversations for a user (customer or worker)
export async function getMyBookingConversations(userId: string) {
  const { data, error } = await supabase.rpc('get_my_booking_conversations', {
    p_user_id: userId,
  });
  return { conversations: data || [], error };
}

// Get booking messages
export async function getBookingMessages(conversationId: string) {
  const { data, error } = await supabase.rpc('get_booking_messages', {
    p_conversation_id: conversationId,
  });
  return { messages: data || [], error };
}

// Send booking message
export async function sendBookingMessage(conversationId: string, senderId: string, content: string) {
  const { data, error } = await supabase.rpc('send_booking_message', {
    p_conversation_id: conversationId,
    p_sender_id: senderId,
    p_content: content,
  });
  return { messageId: data, error };
}

// Step 4: Worker accepts booking with negotiated price and schedule date
export async function workerAcceptBooking(bookingId: string, workerId: string, negotiatedAmount: number, scheduledDate?: string) {
  const { data, error } = await supabase.rpc('worker_accept_booking', {
    p_booking_id: bookingId,
    p_worker_id: workerId,
    p_negotiated_amount: negotiatedAmount,
    p_scheduled_date: scheduledDate || null,
  });
  return { success: data, error };
}

// Step 5: Customer confirms payment
export async function customerConfirmPayment(bookingId: string, userId: string, paystackRef: string, paystackTxId: string) {
  const { data, error } = await supabase.rpc('customer_confirm_payment', {
    p_booking_id: bookingId,
    p_user_id: userId,
    p_paystack_ref: paystackRef,
    p_paystack_tx_id: paystackTxId,
  });
  return { success: data, error };
}

// Step 6: Worker starts job
export async function workerStartJob(bookingId: string, workerId: string) {
  const { data, error } = await supabase.rpc('worker_start_job', {
    p_booking_id: bookingId,
    p_worker_id: workerId,
  });
  return { success: data, error };
}

// Step 7: Worker marks complete
export async function workerMarkComplete(bookingId: string, workerId: string) {
  const { data, error } = await supabase.rpc('worker_mark_complete', {
    p_booking_id: bookingId,
    p_worker_id: workerId,
  });
  return { success: data, error };
}

// Step 7: Customer confirms completion
export async function customerConfirmCompletion(bookingId: string, userId: string) {
  const { data, error } = await supabase.rpc('customer_confirm_completion', {
    p_booking_id: bookingId,
    p_user_id: userId,
  });
  return { success: data, error };
}

// Step 8: Customer raises dispute
export async function customerRaiseDispute(bookingId: string, userId: string, reason: string) {
  const { data, error } = await supabase.rpc('customer_raise_dispute', {
    p_booking_id: bookingId,
    p_user_id: userId,
    p_reason: reason,
  });
  return { success: data, error };
}

// Cancel booking (either party, before payment)
export async function cancelBooking(bookingId: string, cancellerId: string, reason: string) {
  const { data, error } = await supabase.rpc('cancel_booking', {
    p_booking_id: bookingId,
    p_canceller_id: cancellerId,
    p_reason: reason,
  });
  return { success: data, error };
}

// Get single booking details
export async function getBookingDetails(bookingId: string) {
  const { data, error } = await supabase.rpc('get_booking_details', {
    p_booking_id: bookingId,
  });
  return { booking: data?.[0] || null, error };
}

// Get all bookings for a worker
export async function getWorkerBookings(workerId: string) {
  const { data, error } = await supabase
    .from('worker_bookings')
    .select('*, profiles!worker_bookings_user_id_fkey(full_name, phone)')
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false });
  return { bookings: data || [], error };
}

// Status labels for display
export const BOOKING_STATUS_LABELS: Record<string, { label: string; color: string; description: string }> = {
  booking_requested: { label: 'Booking Requested', color: 'bg-amber-500/10 text-amber-400', description: 'Waiting for worker to respond' },
  negotiating: { label: 'Negotiating', color: 'bg-blue-500/10 text-blue-400', description: 'Discussing terms and price' },
  waiting_payment: { label: 'Waiting for Payment', color: 'bg-purple-500/10 text-purple-400', description: 'Worker accepted, customer needs to pay' },
  confirmed: { label: 'Confirmed', color: 'bg-emerald-500/10 text-emerald-400', description: 'Payment received, ready to start' },
  in_progress: { label: 'In Progress', color: 'bg-indigo-500/10 text-indigo-400', description: 'Worker is performing the job' },
  completed_pending_approval: { label: 'Pending Approval', color: 'bg-orange-500/10 text-orange-400', description: 'Worker marked complete, awaiting customer confirmation' },
  approved_released: { label: 'Completed', color: 'bg-emerald-500/10 text-emerald-400', description: 'Job completed, payment released' },
  disputed: { label: 'Disputed', color: 'bg-red-500/10 text-red-400', description: 'Under review by WeHouse' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-500/10 text-gray-400', description: 'Booking was cancelled' },
  refunded: { label: 'Refunded', color: 'bg-gray-500/10 text-gray-400', description: 'Payment refunded' },
};
