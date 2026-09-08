import { compressImageFile } from "./utils";
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

export type HotelMessage = {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: "guest" | "hotel";
  content: string;
  attachments: string[];
  attachment_types: string[];
  reactions: Record<string, string>;
  is_read: boolean;
  created_at: string;
};

export async function openHotelBookingConversation(bookingId: number) {
  const { data, error } = await supabase.rpc("open_my_hotel_booking_conversation", {
    p_booking_id: bookingId,
  });
  return { conversationId: data as string | null, error };
}

export async function getMyHotelConversations() {
  const { data, error } = await supabase.rpc("get_my_hotel_booking_conversations");
  return {
    conversations: ((data || []) as HotelConversation[]).map((row) => ({
      ...row,
      unread_count: Number(row.unread_count || 0),
    })),
    error,
  };
}

export async function getHotelMessages(conversationId: string) {
  const { data, error } = await supabase.rpc("get_hotel_booking_messages", {
    p_conversation_id: conversationId,
  });
  if (error) return { messages: [] as HotelMessage[], error };
  const messages = await Promise.all(
    ((data || []) as HotelMessage[]).map(async (message) => {
      const attachments = await Promise.all(
        (message.attachments || []).map(async (path) => {
          const { data: signed } = await supabase.storage
            .from("hotel-chat-files")
            .createSignedUrl(path, 300);
          return signed?.signedUrl || "";
        }),
      );
      return { ...message, attachments: attachments.filter(Boolean) };
    }),
  );
  return { messages, error: null };
}

export async function sendHotelMessage(
  conversationId: string,
  content: string,
  attachments: string[] = [],
  attachmentTypes: string[] = [],
) {
  const { data, error } = await supabase.rpc("send_hotel_booking_message", {
    p_conversation_id: conversationId,
    p_content: content,
    p_attachments: attachments,
    p_attachment_types: attachmentTypes,
  });
  return { messageId: data as string | null, error };
}

export async function markHotelMessagesRead(conversationId: string) {
  const { error } = await supabase.rpc("mark_hotel_booking_messages_read", {
    p_conversation_id: conversationId,
  });
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
  let upload: Blob | File = file;
  let contentType = file.type || "application/octet-stream";
  let extension = (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (file.type.startsWith("image/")) {
    upload = await compressImageFile(file, 1920, 0.84);
    contentType = "image/jpeg";
    extension = "jpg";
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
