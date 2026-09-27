import { validateChatUpload, normaliseChatMediaType } from "@/lib/chatMediaPolicy";
import { parseHotelConversationBundle, type HotelChatMessage, type HotelConversationContext } from "@/lib/hotelConversationContext";
import { prepareChatImageFile } from "./utils";
import { supabase } from "./client";

export type HotelConversation = {
  conversation_id: string;
  booking_id: number;
  hotel_id: number;
  hotel_name: string;
  hotel_image: string | null;
  booking_code: string | null;
  booking_status: string;
  payment_status: string;
  check_in: string;
  check_out: string;
  room_name: string;
  guest_user_id: string;
  guest_name: string;
  other_party_label: string;
  last_message: string | null;
  last_message_time: string | null;
  unread_count: number;
  updated_at: string;
};

export type HotelMessage = HotelChatMessage;

export async function openHotelBookingConversation(bookingId: number) {
  const { data, error } = await supabase.rpc("open_my_hotel_booking_conversation", {
    p_booking_id: bookingId,
  });
  return { conversationId: data as string | null, error };
}

export async function getMyHotelConversations(workspace: "personal" | "property_partner" | "hotel" = "personal") {
  const { data, error } = await supabase.rpc("get_my_workspace_inbox", { p_workspace: workspace, p_kind: "hotel" });
  return {
    conversations: ((data || []) as HotelConversation[]).map((row) => ({
      ...row,
      unread_count: Number(row.unread_count || 0),
    })),
    error,
  };
}

export async function getHotelMessages(conversationId: string, bookingId: number, onTextReady?: (messages: HotelMessage[], context: HotelConversationContext) => void) {
  const { data, error } = await supabase.rpc("get_my_hotel_conversation_bundle", { p_conversation_id: conversationId, p_booking_id: bookingId });
  if (error) return { context: null, messages: [] as HotelMessage[], error };
  const {context, messages: rows} = parseHotelConversationBundle(data, conversationId, bookingId);
  onTextReady?.(rows.map(message => ({ ...message, attachments: [], attachment_types: [], media_loading: Boolean(message.attachments?.length) })), context);
  const messages = await Promise.all(rows.map(async message => {
    const files = await Promise.all((message.attachments || []).map(async (path, index) => {
      try {
        const { data: signed, error } = await supabase.storage.from("hotel-chat-files").createSignedUrl(path, 300);
        return error || !signed?.signedUrl ? null : { url: signed.signedUrl, type: message.attachment_types?.[index] || '' };
      } catch { return null; }
    }));
    const available = files.filter((file): file is {url: string; type: string} => Boolean(file));
    return { ...message, attachments: available.map(file => file.url), attachment_types: available.map(file => file.type), media_loading: false, media_error: available.length !== files.length };
  }));
  return { context, messages, error: null };
}

export async function sendHotelMessage(
  conversationId: string,
  content: string,
  attachments: string[] = [],
  attachmentTypes: string[] = [],
  replyToId: string | null = null,
) {
  const { data, error } = await supabase.rpc("send_hotel_booking_message", {
    p_conversation_id: conversationId,
    p_content: content,
    p_attachments: attachments,
    p_attachment_types: attachmentTypes,
    p_reply_to_id: replyToId,
  });
  return { messageId: data as string | null, error };
}

export async function markHotelMessagesRead(conversationId: string) {
  const { error } = await supabase.rpc("mark_hotel_booking_messages_read", {
    p_conversation_id: conversationId,
  });
  if (!error && typeof window !== "undefined")
    window.dispatchEvent(new Event("wehouse:unread-changed"));
  return { error };
}

export async function reactToHotelMessage(
  conversationId: string,
  messageId: string,
  emoji: string | null,
) {
  const { data, error } = await supabase.rpc("set_hotel_booking_message_reaction", {
    p_conversation_id: conversationId,
    p_message_id: messageId,
    p_emoji: emoji,
  });
  return { reactions: (data || {}) as Record<string, string>, error };
}

export async function removeHotelMessageForMe(
  conversationId: string,
  messageId: string,
) {
  const { data, error } = await supabase.rpc(
    "remove_hotel_booking_message_for_me",
    {
      p_conversation_id: conversationId,
      p_message_id: messageId,
    },
  );
  return { removed: Boolean(data), error };
}

export async function uploadHotelChatAttachment(
  conversationId: string,
  userId: string,
  file: File,
) {
  try { await validateChatUpload(file); } catch (error) { return { path: null, type: null, error: { message: error instanceof Error ? error.message : "Choose a photo or video." } }; }
  let upload: Blob | File = file;
  let contentType = normaliseChatMediaType(file.type);
  let extension = (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (file.type.startsWith("image/")) {
    const prepared = await prepareChatImageFile(file);
    upload = prepared.body;
    contentType = prepared.contentType;
    extension = prepared.extension;
  }
  const path = `${conversationId}/${userId}/${Date.now()}-${crypto.randomUUID()}.${extension || "bin"}`;
  const { error } = await supabase.storage.from("hotel-chat-files").upload(path, upload, {
    contentType,
    cacheControl: "3600",
    upsert: false,
  });
  return { path: error ? null : path, type: contentType, error };
}

export async function deleteHotelChatAttachment(path: string) {
  const { error } = await supabase.storage.from("hotel-chat-files").remove([path]);
  return { error };
}
