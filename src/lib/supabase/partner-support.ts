import { supabase } from './client';

// ═══════════════════════════════════════════════════════════════
// PROPERTY PARTNER SUPPORT CONVERSATION API
// ═══════════════════════════════════════════════════════════════

// Create support conversation from inspection request
export async function createPartnerSupportConversation(
  partnerId: string,
  subject: string,
  propertyName: string,
  propertyAddress: string,
  propertyCity: string,
  propertyState: string,
  propertyType: string = 'house',
  rentalMode: string = 'long_stay'
) {
  const { data, error } = await supabase.rpc('create_partner_support_conversation', {
    p_partner_id: partnerId,
    p_subject: subject,
    p_property_name: propertyName,
    p_property_address: propertyAddress,
    p_property_city: propertyCity,
    p_property_state: propertyState,
    p_property_type: propertyType,
    p_rental_mode: rentalMode,
  });
  return { conversationId: data, error };
}

// Get partner's conversations
export async function getPartnerConversations(partnerId: string) {
  const { data, error } = await supabase.rpc('get_partner_conversations', {
    p_partner_id: partnerId,
  });
  return { conversations: data || [], error };
}

// Get staff support conversations (for support/creator staff)
export async function getStaffSupportConversations(staffId: string) {
  const { data, error } = await supabase.rpc('get_staff_support_conversations', {
    p_staff_id: staffId,
  });
  return { conversations: data || [], error };
}

// Get support messages
export async function getPartnerSupportMessages(conversationId: string) {
  const { data, error } = await supabase.rpc('get_partner_support_messages', {
    p_conversation_id: conversationId,
  });
  return { messages: data || [], error };
}

// Send support message
export async function sendPartnerSupportMessage(
  conversationId: string,
  senderId: string,
  content: string,
  senderRole: 'partner' | 'staff' | 'field_officer' | 'creator' = 'partner'
) {
  const { data, error } = await supabase.rpc('send_partner_support_message', {
    p_conversation_id: conversationId,
    p_sender_id: senderId,
    p_content: content,
    p_sender_role: senderRole,
  });
  return { messageId: data, error };
}

// Add system action (for workflow timeline)
export async function addConversationAction(
  conversationId: string,
  actionType: string,
  content: string,
  metadata: Record<string, any> = {}
) {
  const { data, error } = await supabase.rpc('add_conversation_action', {
    p_conversation_id: conversationId,
    p_action_type: actionType,
    p_content: content,
    p_metadata: metadata,
  });
  return { messageId: data, error };
}

// Assign field officer
export async function assignFieldOfficerToConversation(
  conversationId: string,
  staffId: string,
  officerId: string
) {
  const { data, error } = await supabase.rpc('assign_field_officer', {
    p_conversation_id: conversationId,
    p_staff_id: staffId,
    p_officer_id: officerId,
  });
  return { success: data, error };
}

// Mark messages as read
export async function markPartnerMessagesRead(conversationId: string, readerRole: string) {
  await supabase.rpc('mark_partner_messages_read', {
    p_conversation_id: conversationId,
    p_reader_role: readerRole,
  });
}

// Action type labels for display
export const ACTION_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  message: { label: 'Message', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z', color: 'text-[#5C5E72]' },
  inspection_requested: { label: 'Inspection Requested', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', color: 'text-amber-400' },
  request_received: { label: 'Request Received', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-blue-400' },
  field_officer_assigned: { label: 'Field Officer Assigned', icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z', color: 'text-violet-400' },
  inspection_scheduled: { label: 'Inspection Scheduled', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', color: 'text-cyan-400' },
  inspection_completed: { label: 'Inspection Completed', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-emerald-400' },
  listing_created: { label: 'Listing Created', icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z', color: 'text-green-400' },
  listing_published: { label: 'Listing Published', icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z', color: 'text-teal-400' },
  status_change: { label: 'Status Updated', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', color: 'text-orange-400' },
  attachment_added: { label: 'Attachment Added', icon: 'M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13', color: 'text-pink-400' },
  conversation_closed: { label: 'Conversation Closed', icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-gray-400' },
};

export const CONVERSATION_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: 'Open', color: 'bg-amber-500/10 text-amber-400' },
  assigned: { label: 'Assigned', color: 'bg-blue-500/10 text-blue-400' },
  in_progress: { label: 'In Progress', color: 'bg-violet-500/10 text-violet-400' },
  resolved: { label: 'Resolved', color: 'bg-emerald-500/10 text-emerald-400' },
  closed: { label: 'Closed', color: 'bg-gray-500/10 text-gray-400' },
};
