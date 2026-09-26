/** Booking context is server-authorised, never inferred from an account's highest role. */
export type HotelConversationContext = {
  conversation_id: string; booking_id: number; hotel_id: number;
  hotel_name: string; room_name: string; rate_plan_name: string | null;
  check_in: string; check_out: string; booking_status: string; payment_status: string;
  viewer_party: 'guest' | 'hotel'; other_party_label: string;
  request_visible: boolean; special_requests: string | null; can_reply: boolean;
};
export type HotelChatMessage = {
  id: string; sender_id: string; sender_name: string; sender_role: 'guest' | 'hotel';
  content: string; attachments: string[]; attachment_types: string[];
  reactions: Record<string, string>; is_read: boolean;
  reply_to_id?: string | null; created_at: string;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const text = (value: unknown): value is string => typeof value === 'string';
const date = (value: unknown): value is string => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));

export function parseHotelConversationBundle(value: unknown, conversationId: string, bookingId: number): {context: HotelConversationContext; messages: HotelChatMessage[]} {
  if (!object(value) || !object(value.context) || !Array.isArray(value.messages)) throw new Error('Hotel conversation response is unavailable.');
  const c = value.context;
  if (c.conversation_id !== conversationId || c.booking_id !== bookingId || !Number.isSafeInteger(c.hotel_id)
    || !text(c.hotel_name) || !text(c.room_name) || !text(c.other_party_label)
    || !date(c.check_in) || !date(c.check_out) || c.check_out <= c.check_in
    || !text(c.booking_status) || !text(c.payment_status)
    || !['guest', 'hotel'].includes(String(c.viewer_party)) || typeof c.request_visible !== 'boolean' || typeof c.can_reply !== 'boolean'
    || !(c.special_requests === null || text(c.special_requests)) || !(c.rate_plan_name === null || text(c.rate_plan_name))) {
    throw new Error('Hotel conversation context could not be verified.');
  }
  // Construct the allowlist rather than spreading private/unexpected fields.
  const context: HotelConversationContext = {
    conversation_id: conversationId, booking_id: bookingId, hotel_id: c.hotel_id as number,
    hotel_name: c.hotel_name, room_name: c.room_name, rate_plan_name: c.rate_plan_name,
    check_in: c.check_in, check_out: c.check_out, booking_status: c.booking_status, payment_status: c.payment_status,
    viewer_party: c.viewer_party as 'guest' | 'hotel', other_party_label: c.other_party_label,
    request_visible: c.request_visible, special_requests: c.request_visible ? c.special_requests : null,
    can_reply: c.can_reply && c.payment_status === 'paid' && ['confirmed', 'checked_in'].includes(c.booking_status),
  };
  const messages = value.messages.map((m): HotelChatMessage => {
    if (!object(m) || !text(m.id) || !text(m.sender_id) || !text(m.sender_name)
      || !['guest', 'hotel'].includes(String(m.sender_role)) || !text(m.content)
      || !strings(m.attachments) || !strings(m.attachment_types) || typeof m.is_read !== 'boolean'
      || !object(m.reactions) || !Object.values(m.reactions).every(text) || !text(m.created_at) || !Number.isFinite(Date.parse(m.created_at))
      || !(m.reply_to_id == null || text(m.reply_to_id))) throw new Error('Hotel messages could not be verified.');
    return {id:m.id, sender_id:m.sender_id, sender_name:m.sender_name, sender_role:m.sender_role as 'guest' | 'hotel', content:m.content,
      attachments:m.attachments, attachment_types:m.attachment_types, reactions:m.reactions as Record<string,string>, is_read:m.is_read,
      reply_to_id:m.reply_to_id as string|null|undefined, created_at:m.created_at};
  });
  return {context, messages};
}

/** All authorised receptionists speak on the hotel side; keep individual authors visible to their team. */
export function hotelMessagePresentation(message: Pick<HotelChatMessage, 'sender_id'|'sender_name'|'sender_role'>, viewerId: string, context: HotelConversationContext) {
  return {
    outgoing: message.sender_role === context.viewer_party,
    author: message.sender_id === viewerId ? 'You' : message.sender_role === 'hotel' && context.viewer_party === 'guest'
      ? context.hotel_name : message.sender_name || (message.sender_role === 'hotel' ? 'Hotel team' : 'Guest'),
    teammate: context.viewer_party === 'hotel' && message.sender_role === 'hotel' && message.sender_id !== viewerId,
  };
}
