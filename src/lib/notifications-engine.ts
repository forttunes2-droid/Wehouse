// ═══════════════════════════════════════════════════════════
// PART 4 — NOTIFICATION ENGINE
// Creates role-specific notifications on every important action
// Per Constitution: "Every important action creates: Database update + Notification + Conversation (when required)"
// ═══════════════════════════════════════════════════════════

import { supabase } from './supabase/client';

// ─── NOTIFICATION TYPES ───────────────────────────────────
export type NotificationType =
  | 'reservation_confirmed'
  | 'inspection_scheduled'
  | 'inspection_completed'
  | 'booking_confirmed'
  | 'payment_successful'
  | 'refund_completed'
  | 'worker_replied'
  | 'roommate_message'
  | 'support_reply'
  | 'announcement'
  | 'new_booking'
  | 'customer_message'
  | 'payment_received'
  | 'withdrawal_successful'
  | 'verification_approved'
  | 'review_received'
  | 'listing_approved'
  | 'listing_rejected'
  | 'booking_received'
  | 'booking_cancelled'
  | 'inspection_assigned'
  | 'support_ticket'
  | 'finance_issue'
  | 'verification_issue'
  | 'operations_issue'
  | 'rent_paid'
  | 'system';

// ─── CREATE NOTIFICATION ──────────────────────────────────
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  metadata?: Record<string, any>
) {
  const { data, error } = await supabase.from('notifications').insert({
    user_id: userId,
    type,
    title,
    body,
    metadata: metadata || {},
    is_read: false,
  }).select().maybeSingle();

  if (error) {
    console.error('[NotificationEngine] Failed to create notification:', error);
  }

  return { notification: data, error };
}

// ═══════════════════════════════════════════════════════════
// USER NOTIFICATIONS (Constitution Part 4)
// ═══════════════════════════════════════════════════════════

/** Reservation confirmed — user paid reservation fee */
export async function notifyUserReservationConfirmed(userId: string, listingTitle: string) {
  return createNotification(
    userId,
    'reservation_confirmed',
    'Reservation Confirmed',
    `Your reservation for "${listingTitle}" has been confirmed. You can now proceed with rent or request an inspection.`,
    { action_required: true, next_steps: ['proceed_rent', 'request_inspection'] }
  );
}

/** Inspection scheduled — field officer assigned */
export async function notifyUserInspectionScheduled(userId: string, listingTitle: string, date?: string) {
  return createNotification(
    userId,
    'inspection_scheduled',
    'Inspection Scheduled',
    `Your inspection request for "${listingTitle}" has been scheduled${date ? ` for ${date}` : ''}. A field officer will contact you.`,
    { listing_title: listingTitle, scheduled_date: date }
  );
}

/** Inspection completed — user decides next step */
export async function notifyUserInspectionCompleted(userId: string, listingTitle: string) {
  return createNotification(
    userId,
    'inspection_completed',
    'Inspection Completed',
    `The inspection for "${listingTitle}" is complete. View the report and decide: proceed with rent or cancel.`,
    { action_required: true, next_steps: ['proceed_rent', 'cancel'] }
  );
}

/** Booking confirmed — payment successful */
export async function notifyUserBookingConfirmed(userId: string, bookingTitle: string) {
  return createNotification(
    userId,
    'booking_confirmed',
    'Booking Confirmed',
    `Your booking for "${bookingTitle}" has been confirmed. Check-in instructions will be sent by We House.`,
    { booking_title: bookingTitle }
  );
}

/** Payment successful — generic payment */
export async function notifyUserPaymentSuccessful(userId: string, amount: number, description: string) {
  return createNotification(
    userId,
    'payment_successful',
    'Payment Successful',
    `Your payment of N${amount.toLocaleString()} for ${description} was successful.`,
    { amount, description }
  );
}

/** Refund completed */
export async function notifyUserRefundCompleted(userId: string, amount: number, description: string) {
  return createNotification(
    userId,
    'refund_completed',
    'Refund Completed',
    `Your refund of N${amount.toLocaleString()} for ${description} has been processed.`,
    { amount, description }
  );
}

/** Worker replied to user's message */
export async function notifyUserWorkerReply(userId: string, workerName: string) {
  return createNotification(
    userId,
    'worker_replied',
    'New Message',
    `${workerName} has sent you a message.`,
    { worker_name: workerName }
  );
}

/** Support reply */
export async function notifyUserSupportReply(userId: string, ticketId?: string) {
  return createNotification(
    userId,
    'support_reply',
    'Support Reply',
    'We House Support has replied to your request.',
    { ticket_id: ticketId }
  );
}

// ═══════════════════════════════════════════════════════════
// WORKER NOTIFICATIONS (Constitution Part 4)
// ═══════════════════════════════════════════════════════════

/** New booking — user booked the worker */
export async function notifyWorkerNewBooking(workerId: string, customerName: string, service: string) {
  return createNotification(
    workerId,
    'new_booking',
    'New Booking',
    `${customerName} has booked your ${service} service.`,
    { customer_name: customerName, service }
  );
}

/** Payment received for a booking */
export async function notifyWorkerPaymentReceived(workerId: string, amount: number, service: string) {
  return createNotification(
    workerId,
    'payment_received',
    'Payment Received',
    `You received N${amount.toLocaleString()} for ${service}.`,
    { amount, service }
  );
}

/** Verification approved — worker gets blue tick */
export async function notifyWorkerVerificationApproved(workerId: string) {
  return createNotification(
    workerId,
    'verification_approved',
    'Verification Approved',
    'Congratulations! Your worker verification has been approved. You now have a verified badge.',
    { verified: true }
  );
}

/** Review received */
export async function notifyWorkerReviewReceived(workerId: string, customerName: string, rating: number) {
  return createNotification(
    workerId,
    'review_received',
    'New Review',
    `${customerName} rated you ${rating} stars.`,
    { customer_name: customerName, rating }
  );
}

/** Withdrawal successful */
export async function notifyWorkerWithdrawalSuccessful(workerId: string, amount: number) {
  return createNotification(
    workerId,
    'withdrawal_successful',
    'Withdrawal Successful',
    `Your withdrawal of N${amount.toLocaleString()} has been processed.`,
    { amount }
  );
}

// ═══════════════════════════════════════════════════════════
// PROPERTY PARTNER NOTIFICATIONS (Constitution Part 4)
// ═══════════════════════════════════════════════════════════

/** Inspection assigned to their property */
export async function notifyPartnerInspectionAssigned(partnerId: string, propertyTitle: string) {
  return createNotification(
    partnerId,
    'inspection_assigned',
    'Inspection Assigned',
    `An inspection has been scheduled for "${propertyTitle}".`,
    { property_title: propertyTitle }
  );
}

/** Inspection completed for their property */
export async function notifyPartnerInspectionCompleted(partnerId: string, propertyTitle: string) {
  return createNotification(
    partnerId,
    'inspection_completed',
    'Inspection Completed',
    `The inspection for "${propertyTitle}" is complete. View the report.`,
    { property_title: propertyTitle }
  );
}

/** Listing approved */
export async function notifyPartnerListingApproved(partnerId: string, listingTitle: string) {
  return createNotification(
    partnerId,
    'listing_approved',
    'Listing Approved',
    `Your listing "${listingTitle}" has been approved and is now live.`,
    { listing_title: listingTitle }
  );
}

/** Listing rejected */
export async function notifyPartnerListingRejected(partnerId: string, listingTitle: string, reason: string) {
  return createNotification(
    partnerId,
    'listing_rejected',
    'Listing Rejected',
    `Your listing "${listingTitle}" was not approved. Reason: ${reason}`,
    { listing_title: listingTitle, reason }
  );
}

/** Booking received for their property */
export async function notifyPartnerBookingReceived(partnerId: string, propertyTitle: string) {
  return createNotification(
    partnerId,
    'booking_received',
    'New Booking',
    `A new booking has been received for "${propertyTitle}".`,
    { property_title: propertyTitle }
  );
}

/** Booking cancelled */
export async function notifyPartnerBookingCancelled(partnerId: string, propertyTitle: string) {
  return createNotification(
    partnerId,
    'booking_cancelled',
    'Booking Cancelled',
    `A booking for "${propertyTitle}" has been cancelled.`,
    { property_title: propertyTitle }
  );
}

/** Wallet credited (rent payment received) */
export async function notifyPartnerWalletCredited(partnerId: string, amount: number, propertyTitle: string) {
  return createNotification(
    partnerId,
    'payment_received',
    'Wallet Credited',
    `N${amount.toLocaleString()} has been credited to your wallet for "${propertyTitle}".`,
    { amount, property_title: propertyTitle }
  );
}

/** Withdrawal completed */
export async function notifyPartnerWithdrawalCompleted(partnerId: string, amount: number) {
  return createNotification(
    partnerId,
    'withdrawal_successful',
    'Withdrawal Completed',
    `Your withdrawal of N${amount.toLocaleString()} has been processed.`,
    { amount }
  );
}

// ═══════════════════════════════════════════════════════════
// STAFF NOTIFICATIONS (Constitution Part 4)
// ═══════════════════════════════════════════════════════════

/** Inspection assigned to field officer */
export async function notifyStaffInspectionAssigned(staffId: string, propertyTitle: string, date?: string) {
  return createNotification(
    staffId,
    'inspection_assigned',
    'Inspection Assigned',
    `You have been assigned to inspect "${propertyTitle}"${date ? ` on ${date}` : ''}.`,
    { property_title: propertyTitle, scheduled_date: date }
  );
}

/** Support ticket assigned */
export async function notifyStaffSupportTicket(staffId: string, ticketTitle: string) {
  return createNotification(
    staffId,
    'support_ticket',
    'New Support Ticket',
    `A new support ticket has been assigned to you: "${ticketTitle}".`,
    { ticket_title: ticketTitle }
  );
}

/** Operations issue */
export async function notifyStaffOperationsIssue(staffId: string, issue: string) {
  return createNotification(
    staffId,
    'operations_issue',
    'Operations Issue',
    issue,
    { issue }
  );
}

/** Finance issue */
export async function notifyStaffFinanceIssue(staffId: string, issue: string) {
  return createNotification(
    staffId,
    'finance_issue',
    'Finance Issue',
    issue,
    { issue }
  );
}

/** Verification issue */
export async function notifyStaffVerificationIssue(staffId: string, issue: string) {
  return createNotification(
    staffId,
    'verification_issue',
    'Verification Issue',
    issue,
    { issue }
  );
}

// ═══════════════════════════════════════════════════════════
// CREATOR NOTIFICATIONS (Constitution Part 4)
// "Creator receives every important system notification"
// ═══════════════════════════════════════════════════════════

/** System notification — creator gets EVERYTHING important */
export async function notifyCreatorSystem(creatorId: string, title: string, body: string, metadata?: Record<string, any>) {
  return createNotification(
    creatorId,
    'system',
    title,
    body,
    metadata
  );
}

/** Rent paid — wallet + finance + analytics updated */
export async function notifyCreatorRentPaid(creatorId: string, amount: number, propertyTitle: string) {
  return createNotification(
    creatorId,
    'rent_paid',
    'Rent Payment Received',
    `N${amount.toLocaleString()} rent payment received for "${propertyTitle}". Wallet, Finance, and Analytics updated.`,
    { amount, property_title: propertyTitle }
  );
}

// ═══════════════════════════════════════════════════════════
// BULK NOTIFICATION HELPERS
// ═══════════════════════════════════════════════════════════

/** Notify multiple users at once (e.g., all staff for an inspection) */
export async function notifyMultiple(
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  metadata?: Record<string, any>
) {
  const inserts = userIds.map((userId) => ({
    user_id: userId,
    type,
    title,
    body,
    metadata: metadata || {},
    is_read: false,
  }));

  const { data, error } = await supabase.from('notifications').insert(inserts);
  return { notifications: data, error };
}

/** Get all admin/creator user IDs for system notifications */
export async function getAdminAndCreatorIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id')
    .in('role', ['admin', 'creator'])
    .is('deleted_at', null);

  if (error) {
    console.error('[NotificationEngine] Failed to get admin/creator IDs:', error);
    return [];
  }

  return (data || []).map((p: any) => p.user_id);
}

/** Get staff IDs by module (e.g., operations, finance, field_officer) */
export async function getStaffByModule(module: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('role', 'staff')
    .is('deleted_at', null);

  if (error) {
    console.error('[NotificationEngine] Failed to get staff IDs:', error);
    return [];
  }

  // Filter by module permissions
  const staffIds = (data || []).map((p: any) => p.user_id);

  // Get permissions for each staff
  const { data: perms } = await supabase
    .from('staff_modules')
    .select('staff_id')
    .eq('module', module)
    .is('revoked_at', null);

  const allowedStaffIds = (perms || []).map((p: any) => p.staff_id);

  return staffIds.filter((id) => allowedStaffIds.includes(id));
}
