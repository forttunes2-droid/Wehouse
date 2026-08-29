import { supabase } from "./client";

export type SupportThread = {
  conversation_id: string;
  subject: string;
  status: string;
  category: string;
  context_type: string;
  context_id: string | null;
  context_snapshot: Record<string, unknown>;
  priority: string;
  assigned_staff_name: string | null;
  last_message: string | null;
  last_message_time: string | null;
  unread_count: number;
  created_at: string;
};

export type SupportOpenContext = {
  conversationId?: string;
  subject?: string;
  category?: string;
  contextType?: string;
  contextId?: string | null;
  contextSnapshot?: Record<string, unknown>;
  priority?: string;
};

export async function createSupportConversation(
  input: SupportOpenContext = {},
) {
  const { data, error } = await supabase.rpc("create_support_conversation", {
    p_subject: input.subject || "WeHouse Support",
    p_category: input.category || "general",
    p_context_type: input.contextType || "general",
    p_context_id: input.contextId || null,
    p_context_snapshot: input.contextSnapshot || {},
    p_priority: input.priority || "normal",
  });
  return { conversationId: data as string | null, error };
}

export const ensureSupportConversation = createSupportConversation;

export async function getMySupportConversations() {
  const { data, error } = await supabase.rpc("get_my_support_conversations");
  return { conversations: (data || []) as SupportThread[], error };
}

export async function getSupportMessages(conversationId: string) {
  const { data, error } = await supabase.rpc("get_support_messages", {
    p_conversation_id: conversationId,
  });
  return { messages: data || [], error };
}

export async function sendSupportMessage(
  conversationId: string,
  content: string,
  attachments: string[] = [],
  attachmentTypes: string[] = [],
  context?: SupportOpenContext | null,
) {
  // Context belongs in metadata. The message action remains a normal message;
  // reservation and booking names are not workflow actions in the database.
  const actionType = context ? "message" : null;
  const actionMetadata = context
    ? {
        category: context.category || "general",
        context_type: context.contextType || "general",
        context_id: context.contextId || null,
        context_snapshot: context.contextSnapshot || {},
        subject: context.subject || null,
      }
    : {};
  const { data, error } = await supabase.rpc("send_support_message", {
    p_conversation_id: conversationId,
    p_content: content,
    p_attachments: attachments,
    p_attachment_types: attachmentTypes,
    p_action_type: actionType,
    p_action_metadata: actionMetadata,
  });
  return { messageId: data as string | null, error };
}

export async function markSupportMessagesRead(conversationId: string) {
  const { error } = await supabase.rpc("mark_support_messages_read", {
    p_conversation_id: conversationId,
  });
  return { error };
}

export async function getSupportInbox() {
  const { data, error } = await supabase.rpc("support_inbox");
  return { conversations: data || [], error };
}

export async function uploadSupportAttachment(
  conversationId: string,
  file: File,
) {
  const safeName =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "attachment";
  const path = `${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
  const { error } = await supabase.storage
    .from("support-files")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
  return { path: error ? null : path, error };
}

export async function getSupportAttachmentUrl(path: string, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from("support-files")
    .createSignedUrl(path, expiresIn);
  return { url: data?.signedUrl || null, error };
}

export async function deleteSupportAttachment(path: string) {
  const { error } = await supabase.storage.from("support-files").remove([path]);
  return { error };
}
