import { supabase } from "./client";
import {
  propertyBookingStatusLabel,
  type PropertyJourneyAudience,
} from "@/lib/propertyBookingLifecycle";

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

export type SupportCaseEvent = {
  id: string;
  event_type: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
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

export function supportContextType(
  value:
    | Pick<SupportThread, "context_type" | "context_snapshot">
    | SupportOpenContext,
) {
  const stored =
    "context_type" in value
      ? value.context_type
      : value.contextType || "general";
  const snapshot =
    ("context_snapshot" in value
      ? value.context_snapshot
      : value.contextSnapshot) || {};
  const source = String(snapshot.source_type || "");
  if (stored === "support_case" && source) return source;
  if (stored === "listing") return "property_listing";
  return stored;
}

export function conversationPresentation(
  value:
    | Pick<
        SupportThread,
        "subject" | "context_type" | "context_snapshot" | "status"
      >
    | SupportOpenContext,
  audience: PropertyJourneyAudience = "customer",
): ConversationPresentation {
  const snapshot =
    ("context_snapshot" in value
      ? value.context_snapshot
      : value.contextSnapshot) || {};
  const contextType = supportContextType(value);
  const rawSubject = String(
    "subject" in value ? value.subject || "" : value.subject || "",
  ).trim();
  const threadStatus = "status" in value ? value.status : "";
  const status = String(snapshot.status || threadStatus || "").replace(
    /_/g,
    " ",
  );
  const code = String(
    snapshot.booking_code || snapshot.reference || snapshot.request_code || "",
  ).trim();
  const reservation = [
    "apartment_reservation",
    "apartment_payment",
    "reservation",
    "hotel_booking",
  ].includes(contextType);
  if (reservation) {
    const stay = snapshot.stay_type === "short_let" ? "Short Let" : "Long Let";
    const lifecycleStatus = propertyBookingStatusLabel(
      {
        status,
        stay_type: snapshot.stay_type,
        rent_payment_status:
          snapshot.rent_payment_status || snapshot.payment_status,
        requested_move_in_at: snapshot.requested_move_in_at,
      },
      audience,
    );
    const place = String(
      snapshot.listing_title || snapshot.hotel_name || "",
    ).trim();
    const safeSubject = /^(wehouse support|reservation help)$/i.test(rawSubject)
      ? ""
      : rawSubject.replace(/\s*·\s*Reservation Desk$/i, "");
    return {
      kind: "reservation",
      title:
        place ||
        safeSubject ||
        (contextType === "hotel_booking" ? "Hotel stay" : stay),
      operator: "WeHouse Support",
      meta: [
        contextType === "hotel_booking"
          ? "Hotel booking"
          : "Property reservation",
        audience === "customer" ? "" : code,
        lifecycleStatus === "Status unavailable"
          ? reservationStatusLabel(status, contextType)
          : lifecycleStatus,
      ]
        .filter(Boolean)
        .join(" · "),
      operational: true,
    };
  }
  if (
    [
      "property_listing",
      "property_inspection",
      "hotel_property",
      "hotel_operations",
    ].includes(contextType)
  )
    return {
      kind: "property_operations",
      title: String(
        snapshot.listing_title ||
          snapshot.hotel_name ||
          rawSubject ||
          "Property",
      ).replace(/^(question about|inspection help)\s*·\s*/i, ""),
      operator: "WeHouse Support",
      meta: [
        contextType === "property_inspection"
          ? "Property inspection"
          : contextType.startsWith("hotel_")
            ? "Hotel operations"
            : "Property enquiry",
        audience === "customer" ? "" : code,
        status,
      ]
        .filter(Boolean)
        .join(" · "),
      operational: true,
    };
  if (contextType === "worker_booking")
    return {
      kind: "service_help",
      title: rawSubject || String(snapshot.service_type || "Service booking"),
      operator: "WeHouse Service Support",
      meta: ["Service booking", code, status].filter(Boolean).join(" · "),
      operational: true,
    };
  return {
    kind: "support",
    title:
      rawSubject && !/^wehouse support$/i.test(rawSubject)
        ? rawSubject
        : "WeHouse",
    operator: "WeHouse Support",
    meta: ["Help", status].filter(Boolean).join(" · "),
    operational: false,
  };
}

function reservationStatusLabel(status: string, contextType: string) {
  const value = status.toLowerCase();
  if (value === "occupied") return "Tenancy active";
  if (value === "checked in" || value === "checked_in") return "Checked in";
  if (value === "checked out" || value === "checked_out") return "Checked out";
  if (value === "confirmed")
    return contextType === "hotel_booking"
      ? "Stay confirmed"
      : "Booking confirmed";
  return value ? value[0].toUpperCase() + value.slice(1) : "";
}

export async function createSupportConversation(
  input: SupportOpenContext = {},
) {
  const canonicalContextType = ["reservation", "apartment_payment"].includes(
    input.contextType || "",
  )
    ? "apartment_reservation"
    : input.contextType;
  if (
    ["apartment_reservation", "hotel_booking"].includes(
      canonicalContextType || "",
    )
  ) {
    const { data, error } = await supabase.rpc(
      "open_my_reservation_conversation",
      {
        p_context_type: canonicalContextType,
        p_context_id: input.contextId,
      },
    );
    return { conversationId: data as string | null, error };
  }
  const snapshot = input.contextSnapshot || {};
  const { data, error } = await supabase.rpc("create_my_support_case", {
    p_subject: input.subject || "WeHouse",
    p_category: input.category || "general",
    p_source_type: String(
      snapshot.source_type || input.contextType || "general",
    ),
    p_source_id: String(snapshot.source_id || input.contextId || "") || null,
    p_source_snapshot: snapshot,
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

export async function getSupportCaseEvents(conversationId: string) {
  const { data, error } = await supabase.rpc("get_my_support_case_events", {
    p_conversation_id: conversationId,
  });
  return { events: (data || []) as SupportCaseEvent[], error };
}

export async function claimCommunicationCase(conversationId: string) {
  const { error } = await supabase.rpc("claim_my_communication_case", {
    p_conversation_id: conversationId,
  });
  return { error };
}

export async function transitionSupportCase(
  conversationId: string,
  action: "start" | "request_info" | "escalate" | "resolve" | "close",
  note?: string,
) {
  const { data, error } = await supabase.rpc("transition_my_support_case", {
    p_conversation_id: conversationId,
    p_action: action,
    p_note: note || null,
  });
  return { conversation: data, error };
}

export async function completeSupportCase(conversationId: string) {
  const { data, error } = await supabase.rpc("complete_my_support_case", {
    p_conversation_id: conversationId,
  });
  return { conversation: data, error };
}

export async function reopenSupportCase(
  conversationId: string,
  note?: string,
) {
  const { data, error } = await supabase.rpc("reopen_my_support_case", {
    p_conversation_id: conversationId,
    p_note: note || null,
  });
  return { conversation: data, error };
}

export function supportStatusLabel(
  value?: string | null,
  perspective: "requester" | "staff" = "requester",
) {
  const labels: Record<string, string> = {
    open: "Open",
    assigned: "Open",
    in_progress: "In progress",
    waiting_for_user:
      perspective === "staff" ? "Waiting for requester" : "Waiting for you",
    escalated: "Escalated",
    resolved: "Resolved",
    closed: "Closed",
  };
  return labels[String(value || "")] || "Open";
}

export function supportNextStep(
  status?: string | null,
  assignedStaffName?: string | null,
) {
  switch (status) {
    case "open":
      return {
        actor: "WeHouse",
        text: "The correct WeHouse team will review and assign your request.",
      };
    case "assigned":
      return {
        actor: "WeHouse",
        text: `${assignedStaffName || "A team member"} will begin reviewing your request.`,
      };
    case "in_progress":
      return {
        actor: "WeHouse",
        text: `${assignedStaffName || "The assigned team"} is working on your request and will update you here.`,
      };
    case "waiting_for_user":
      return {
        actor: "You",
        text: "Reply with the information WeHouse requested so work can continue.",
      };
    case "escalated":
      return {
        actor: "WeHouse",
        text: "A senior WeHouse reviewer is checking this request. You will receive the outcome here.",
      };
    case "resolved":
      return {
        actor: "You",
        text: "Review the outcome, then confirm it is solved or tell WeHouse you still need help.",
      };
    case "closed":
      return {
        actor: "No action",
        text: "This request is closed. Reopen it if the same issue is not actually solved.",
      };
    default:
      return {
        actor: "WeHouse",
        text: "WeHouse will review this request after you send it.",
      };
  }
}

export async function sendSupportMessage(
  conversationId: string,
  content: string,
  attachments: string[] = [],
  attachmentTypes: string[] = [],
  context?: SupportOpenContext | null,
  visibility: "customer" | "internal" = "customer",
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
    p_visibility: visibility,
  });
  return { messageId: data as string | null, error };
}

export async function markSupportMessagesRead(conversationId: string) {
  const { error } = await supabase.rpc("mark_support_messages_read", {
    p_conversation_id: conversationId,
  });
  if (!error && typeof window !== "undefined")
    window.dispatchEvent(new Event("wehouse:unread-changed"));
  return { error };
}

export async function getSupportInbox(
  queue:
    | "all"
    | "support"
    | "operations"
    | "property_operations"
    | "reservation_operations"
    | "field_operations" = "support",
) {
  const { data, error } = await supabase.rpc("support_inbox", {
    p_queue: queue,
  });
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
