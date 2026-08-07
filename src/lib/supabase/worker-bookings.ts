import { supabase } from './client';
import { compressImageFile } from './utils';

// ═══════════════════════════════════════════════════════════════
// WORKER BOOKING NEGOTIATION API
// ═══════════════════════════════════════════════════════════════

// Step 1: Customer creates booking request
// SECURITY: Backend derives customer identity from auth.uid().
export async function createBookingRequest(
  workerId: string,
  serviceType: string,
  description: string,
  address: string,
  scheduledDate: string,
  customerMessage?: string
) {
  const { data, error } = await supabase.rpc('create_booking_request', {
    p_worker_id: workerId,
    p_service_type: serviceType,
    p_description: description,
    p_address: address,
    p_scheduled_date: scheduledDate,
    p_customer_message: customerMessage || null,
  });
  if (error) return { booking: null, error };
  return { booking: data || null, error: null };
}

// Get all booking conversations for a user (customer or worker) — uses RPC (bypasses RLS)
export async function getMyBookingConversations(userId: string) {
  const { data, error } = await supabase.rpc('get_my_booking_conversations', {
    p_user_id: userId,
  });
  // Map RPC response to expected format
  const conversations = (data || []).map((row: any) => ({
    conversation_id: row.conversation_id,
    booking_id: row.booking_id,
    booking_code: row.booking_code,
    booking_status: row.booking_status,
    service_type: row.service_type,
    negotiated_amount: row.negotiated_amount || 0,
    other_person_name: row.other_person_name || 'Unknown',
    other_person_username: '',
    updated_at: row.updated_at,
  }));
  return { conversations, error };
}

// Get booking messages
// Post-processes image paths into short-lived signed URLs for display.
export async function getBookingMessages(conversationId: string) {
  const { data, error } = await supabase.rpc('get_booking_messages', {
    p_conversation_id: conversationId,
  });
  if (error || !data) return { messages: data || [], error };

  // Convert storage paths to signed URLs for image messages
  const messages = await Promise.all(
    (data as any[]).map(async (msg: any) => {
      const content = msg.content || '';
      if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(content) && !content.startsWith('http')) {
        const { data: signed } = await supabase.storage
          .from('chat-files')
          .createSignedUrl(content, 60 * 60); // 1 hour
        return { ...msg, content: signed?.signedUrl || content };
      }
      return msg;
    })
  );

  return { messages, error };
}

// Send booking message
// SECURITY: The backend RPC 'send_booking_message' derives sender from auth.uid().
// Frontend NEVER passes sender_id to prevent spoofing.
export async function sendBookingMessage(conversationId: string, content: string) {
  const { data, error } = await supabase.rpc('send_booking_message', {
    p_conversation_id: conversationId,
    p_content: content,
  });
  return { messageId: data, error };
}

// Step 4: Worker accepts booking with negotiated price
// SECURITY: Backend derives worker identity from auth.uid().
export async function workerAcceptBooking(bookingId: string, negotiatedAmount: number, scheduledDate?: string) {
  const { data, error } = await supabase.rpc('worker_accept_booking', {
    p_booking_id: bookingId,
    p_negotiated_amount: negotiatedAmount,
    p_scheduled_date: scheduledDate || null,
  });
  return { success: data, error };
}

// Step 5 (Payment): The customer pays via Paystack popup.
// After Paystack popup success, the frontend calls verifyPaymentWithRetry()
// from @/lib/supabase/payment-verify, which invokes the paystack-verify Edge
// Function. The Edge Function verifies with Paystack API, then routes to:
//   - confirm_worker_booking_payment (for purpose='worker_booking')
//   - confirm_booking_payment (for all other purposes)
// Frontend NEVER calls either RPC directly.
//
// DEPRECATED wrappers removed:
//   - customerConfirmPayment() → called customer_confirm_payment directly (unsafe)
//   - confirmWorkerBookingPayment() → called confirm_worker_booking_payment directly (unsafe)

// Step 6: Worker starts job
// SECURITY: Backend derives worker identity from auth.uid().
export async function workerStartJob(bookingId: string) {
  const { data, error } = await supabase.rpc('worker_start_job', {
    p_booking_id: bookingId,
  });
  return { success: data, error };
}

// Step 7: Worker marks complete
// SECURITY: Backend derives worker identity from auth.uid().
export async function workerMarkComplete(bookingId: string) {
  const { data, error } = await supabase.rpc('worker_mark_complete', {
    p_booking_id: bookingId,
  });
  return { success: data, error };
}

// Step 7: Customer confirms completion
// SECURITY: Backend derives customer identity from auth.uid().
export async function customerConfirmCompletion(bookingId: string) {
  const { data, error } = await supabase.rpc('customer_confirm_completion', {
    p_booking_id: bookingId,
  });
  return { success: data, error };
}

// Step 8: Customer raises dispute
// SECURITY: Backend derives customer identity from auth.uid().
export async function customerRaiseDispute(bookingId: string, reason: string) {
  const { data, error } = await supabase.rpc('customer_raise_dispute', {
    p_booking_id: bookingId,
    p_reason: reason,
  });
  return { success: data, error };
}

// Cancel booking (either party, before payment)
// SECURITY: Backend derives canceller identity from auth.uid().
export async function cancelBooking(bookingId: string, reason: string) {
  const { data, error } = await supabase.rpc('cancel_booking', {
    p_booking_id: bookingId,
    p_reason: reason,
  });
  return { success: data, error };
}

// Get single booking details
export async function getBookingDetails(bookingId: string) {
  // Direct query with customer profile
  const { data: booking, error } = await supabase
    .from('worker_bookings')
    .select(`
      id, booking_code, status, service_type, description, address,
      negotiated_amount, scheduled_date, created_at, updated_at,
      user_id, worker_id
    `)
    .eq('id', bookingId)
    .single();

  if (error || !booking) return { booking: null, error };

  // Get customer profile
  const { data: customer } = await supabase
    .from('profiles')
    .select('user_id, username, full_name, avatar_url, phone')
    .eq('user_id', booking.user_id)
    .single();

  // Get worker profile
  const { data: worker } = await supabase
    .from('profiles')
    .select('user_id, username, full_name, avatar_url')
    .eq('user_id', booking.worker_id)
    .single();

  return {
    booking: {
      ...booking,
      user_name: customer?.full_name || customer?.username || 'Customer',
      customer_username: customer?.username || '',
      customer_phone: customer?.phone || '',
      worker_name: worker?.full_name || worker?.username || 'Worker',
    },
    error: null,
  };
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

// Upload image to booking chat
// Returns the stored path + a short-lived signed URL for display.
// The path is stored in DB; signed URLs are generated on demand.
export async function uploadBookingChatImage(file: File, conversationId: string) {
  try {
    const compressed = await compressImageFile(file, 1920, 0.85);
    const fileName = `${conversationId}/${Date.now()}.jpg`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('chat-files')
      .upload(fileName, compressed, { contentType: 'image/jpeg' });
    if (uploadError) {
      if (uploadError.message?.includes('bucket') || uploadError.message?.includes('Bucket')) {
        return { path: null, signedUrl: null, error: { message: 'Storage not configured. Ask admin to run storage setup SQL.' } as any };
      }
      return { path: null, signedUrl: null, error: uploadError };
    }
    // Short-lived signed URL for immediate display (1 hour)
    const { data: signedData, error: signedError } = await supabase.storage
      .from('chat-files')
      .createSignedUrl(uploadData.path, 60 * 60);
    if (signedError) return { path: uploadData.path, signedUrl: null, error: signedError };
    return { path: uploadData.path, signedUrl: signedData.signedUrl, error: null };
  } catch (e: any) {
    return { path: null, signedUrl: null, error: { message: e.message || 'Upload failed' } as any };
  }
}

// Send booking message with image (sends storage path as content)
// SECURITY: Backend derives sender from auth.uid().
export async function sendBookingImageMessage(conversationId: string, imagePath: string) {
  const { data, error } = await supabase.rpc('send_booking_message', {
    p_conversation_id: conversationId,
    p_content: imagePath,
  });
  return { messageId: data, error };
}

// Cancel booking (updates status to 'cancelled' — worker_bookings has no deleted_at column)
export async function deleteBooking(bookingId: string, userId: string) {
  // Only allow if user is the customer or worker for this booking
  const { data: booking, error: fetchErr } = await supabase
    .from('worker_bookings')
    .select('user_id, worker_id')
    .eq('id', bookingId)
    .single();
  if (fetchErr) return { success: false, error: fetchErr };
  if (booking.user_id !== userId && booking.worker_id !== userId) {
    return { success: false, error: { message: 'Not authorized to cancel this booking' } as any };
  }
  const { error } = await supabase
    .from('worker_bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', bookingId);
  return { success: !error, error };
}

// Get user's active bookings (for "already booked" check)
export async function getUserActiveBookings(userId: string) {
  const { data, error } = await supabase
    .from('worker_bookings')
    .select('id, worker_id, status')
    .eq('user_id', userId)
    .not('status', 'in', '(cancelled,refunded,approved_released)');
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
