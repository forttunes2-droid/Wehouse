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

export type ConversationPresentation = {
  kind: "reservation" | "service_help" | "property_operations" | "support";
  title: string;
  operator: string;
  meta: string;
  operational: boolean;
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

export function conversationPresentation(
  value: Pick<SupportThread, "subject" | "context_type" | "context_snapshot" | "status"> | SupportOpenContext,
): ConversationPresentation {
  const contextType = "context_type" in value ? value.context_type : value.contextType || "general";
  const snapshot = ("context_snapshot" in value ? value.context_snapshot : value.contextSnapshot) || {};
  const rawSubject = String("subject" in value ? value.subject || "" : value.subject || "").trim();
  const status = String(("status" in value ? value.status : snapshot.status) || "").replace(/_/g, " ");
  const code = String(snapshot.booking_code || snapshot.reference || snapshot.request_code || "").trim();
  const reservation = ["apartment_reservation", "reservation", "hotel_booking"].includes(contextType);
  if (reservation) {
    const stay = snapshot.stay_type === "short_let" ? "Short Let" : "Long Stay";
    const place = String(snapshot.listing_title || snapshot.hotel_name || "").trim();
    const safeSubject = /^(wehouse support|reservation help)$/i.test(rawSubject) ? "" : rawSubject.replace(/\s*·\s*Reservation Desk$/i, "");
    return {
      kind: "reservation",
      title: place || safeSubject || (contextType === "hotel_booking" ? "Hotel stay" : stay),
      operator: "Reservation Desk",
      meta: [code, status].filter(Boolean).join(" · "),
      operational: true,
    };
  }
  if (contextType === "property_inspection") return {
    kind: "property_operations",
    title: rawSubject || "Property submission",
    operator: "Property Operations",
    meta: [code, status].filter(Boolean).join(" · "),
    operational: true,
  };
  if (contextType === "worker_booking") return {
    kind: "service_help",
    title: rawSubject || String(snapshot.service_type || "Service booking"),
    operator: "Service Help",
    meta: [code, status].filter(Boolean).join(" · "),
    operational: false,
  };
  return {
    kind: "support",
    title: rawSubject && !/^wehouse support$/i.test(rawSubject) ? rawSubject : "WeHouse Support",
    operator: "Support Case",
    meta: status,
    operational: false,
  };
}

export async function createSupportConversation(
  input: SupportOpenContext = {},
) {
  if (["apartment_reservation", "reservation", "hotel_booking"].includes(input.contextType || "")) {
    const { data, error } = await supabase.rpc("open_my_reservation_conversation", {
      p_context_type: input.contextType,
      p_context_id: input.contextId,
    });
    return { conversationId: data as string | null, error };
  }
  if ((input.contextType || "general") !== "property_inspection") {
    const snapshot = input.contextSnapshot || {};
    const { data, error } = await supabase.rpc("create_my_support_case", {
      p_subject: input.subject || "WeHouse Support",
      p_category: input.category || "general",
      p_source_type: String(snapshot.source_type || input.contextType || "general"),
      p_source_id: String(snapshot.source_id || input.contextId || "") || null,
      p_source_snapshot: snapshot,
      p_priority: input.priority || "normal",
    });
    return { conversationId: data as string | null, error };
  }
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
