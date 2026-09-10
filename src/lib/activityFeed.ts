export type ActivityFeedRow = {
  id?: string;
  type?: string | null;
  title?: string | null;
  message?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  destination_route?: string | null;
  destination_params?: Record<string, unknown> | null;
  created_at: string;
  read?: boolean;
  source?: "event" | "announcement";
};

const FINANCIAL_ACTIVITY = /payment|payout|earning|dispute|refund/i;
const ACCOUNT_ACTIVITY = /security|password|verification/i;
const BOOKING_ACTIVITY = /booking|reservation|inspection|listing|property|hotel|job|worker|status/i;
const ROOMMATE_ACTIVITY = /roommate|match|invite|interest/i;
const ACTIONABLE_ACTIVITY = /action_required|payment_conflict|dispute|changes_requested|escalat|verification_required|refund_due|failed|service_price_ready|service_completion_review_required|service_request_received|service_payment_confirmed|work_post_confirmation_requested|roommate_interest|property_move_in_requested|waiting_payment|payment_required|approval_required/i;
const ACTIONABLE_COPY = /needs? (?:your|my) action|price ready for approval|review completed work|waiting for (?:your|my) (?:approval|payment|response)|requires? (?:your|my) (?:approval|payment|response)|new roommate interest|new service request|needs verification/i;
const MESSAGE_LIFECYCLE = /price|payment|accepted|declined|cancel|complete|scheduled|security|verification|match|invite|reservation|booking|payout|earning|status/i;
const TRANSIENT_ACTIVITY = /device_confirmation_pending|typing|message_seen|message_viewed|reaction|draft_saved|sync_(started|finished)/i;

export function isTransientActivityEvent(row: Pick<ActivityFeedRow, "type">) {
  return TRANSIENT_ACTIVITY.test(String(row.type || ""));
}

export function isOrdinaryMessageEvent(row: Pick<ActivityFeedRow, "type" | "source_type" | "destination_route">) {
  const type = String(row.type || "").toLowerCase();
  if (type === "missed_call") return true;
  if (MESSAGE_LIFECYCLE.test(type)) return false;
  if (/(^|_)(message|reply|replied|chat)(_|$)/.test(type)) return true;
  return row.destination_route === "conversation" && /conversation|message|chat/.test(String(row.source_type || "").toLowerCase());
}

export function activityNeedsAction(
  row: Pick<ActivityFeedRow, "type" | "title" | "message" | "source_type" | "destination_route">,
) {
  const value = [
    row.type,
    row.title,
    row.message,
    row.source_type,
    row.destination_route,
  ]
    .filter(Boolean)
    .join(" ");
  return ACTIONABLE_ACTIVITY.test(value) || ACTIONABLE_COPY.test(value);
}

export type ActivityDestination = {
  route: string;
  id?: string;
};

function value(params: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = params[key];
    if (candidate !== null && candidate !== undefined && String(candidate).trim())
      return String(candidate);
  }
  return undefined;
}

function legacyActivityRoute(type: string, sourceType: string) {
  const event = `${type} ${sourceType}`.toLowerCase();
  if (/roommate|shared_home_invite|shared_home_response/.test(event))
    return "roommate";
  if (/security|device|password|login/.test(event)) return "devices";
  if (/property|listing|inspection|access_evidence/.test(event))
    return "my_reservations";
  if (/booking|reservation|payment|shared_home/.test(event))
    return "my_reservations";
  if (/worker|service|job/.test(event)) return "worker_dashboard";
  return "";
}

function normalizeRoute(route: string) {
  const value = route.trim().toLowerCase().replace(/-/g, "_");
  if (/^(conversations?|messages?|chat)$/.test(value)) return "conversation";
  if (value === "my_bookings") return "my_reservations";
  if (value === "listing_detail") return "detail";
  if (value === "worker_dashboard") return "worker_dashboard";
  return value;
}

/**
 * Resolves an Activity item to its authoritative record. The destination is
 * deliberately route-aware: a notification can contain both a conversation
 * ID and a booking/property ID, and choosing the first arbitrary ID opens the
 * wrong screen.
 */
export function resolveActivityDestination(
  row: Pick<
    ActivityFeedRow,
    "type" | "source_type" | "source_id" | "destination_route" | "destination_params"
  >,
): ActivityDestination {
  const type = String(row.type || "").toLowerCase();
  const sourceType = String(row.source_type || "").toLowerCase();
  const params = row.destination_params || {};
  let route = normalizeRoute(
    String(row.destination_route || legacyActivityRoute(type, sourceType)),
  );

  if (route === "security" && /device|login|session/.test(`${type} ${sourceType}`))
    route = "devices";

  if (route === "operations_inbox") {
    const contextType = String(params.context_type || sourceType).toLowerCase();
    if (/property|listing|inspection|hotel_property|access_evidence/.test(contextType))
      route = "operations_properties";
    else if (/booking|reservation|payment|tenancy|hotel_booking/.test(contextType))
      route = "operations_bookings";
    else if (/worker|service|job/.test(contextType))
      route = "operations_workers";
  }

  const conversationId = value(params, ["conversation_id", "conversationId"]);
  const propertyId = value(params, [
    "inspection_id",
    "inspectionId",
    "listing_id",
    "listingId",
    "hotel_id",
    "hotelId",
    "context_id",
    "contextId",
  ]);
  const explicitBookingId = value(params, [
    "reservation_id",
    "reservationId",
    "booking_id",
    "bookingId",
    "shared_group_id",
    "sharedGroupId",
  ]);
  const bookingId = explicitBookingId || value(params, [
    "context_id",
    "contextId",
  ]);
  const workerId = value(params, [
    "worker_id",
    "workerId",
    "booking_id",
    "bookingId",
    "work_post_id",
    "workPostId",
    "context_id",
    "contextId",
  ]);
  const roommateId = value(params, [
    "interest_id",
    "interestId",
    "match_id",
    "matchId",
    "conversation_id",
    "conversationId",
    "shared_group_id",
    "sharedGroupId",
  ]);
  const securityId = value(params, ["session_id", "sessionId"]);
  const fallbackId = value(params, ["context_id", "contextId"]) || row.source_id || undefined;
  const lifecycleBookingId =
    explicitBookingId ||
    (/booking|reservation/.test(sourceType) ? row.source_id || undefined : undefined);

  // Booking events sometimes carry both the parent property and the exact
  // reservation. The reservation owns the action; the property is only its
  // container. Never discard the more specific target because an older event
  // happened to store a property-oriented destination route.
  if (
    lifecycleBookingId &&
    /booking|reservation|rent|move_in|handover|tenancy|stay/.test(
      `${type} ${sourceType}`,
    ) &&
    /propert|listing|inspection|hotel_detail/.test(route)
  ) {
    return {
      route: /hotel/.test(`${type} ${sourceType}`)
        ? "hotel_booking"
        : "reservation",
      id: String(lifecycleBookingId),
    };
  }

  if (route === "conversation") return { route, id: conversationId || fallbackId };
  if (/propert|listing|inspection|hotel_detail/.test(route))
    return { route, id: propertyId || fallbackId };
  if (/booking|reservation/.test(route))
    return { route, id: bookingId || fallbackId };
  if (/worker|service|job/.test(route))
    return { route, id: workerId || fallbackId };
  if (route === "roommate") return { route, id: roommateId || fallbackId };
  if (route === "devices" || route === "security")
    return { route, id: securityId || fallbackId };
  if (route === "operations_inbox")
    return { route, id: conversationId || fallbackId };
  return { route, id: fallbackId };
}

export function activityDestinationLabel(row: Parameters<typeof resolveActivityDestination>[0]) {
  const { route } = resolveActivityDestination(row);
  const type = String(row.type || "").toLowerCase();
  if (type === "property_move_in_requested") return "Prepare handover";
  if (type === "property_rent_confirmed") return "View reservation";
  if (type === "property_inspection_coordination_required")
    return "Open inspection request";
  if (route === "conversation") return "Open conversation";
  if (route === "devices" || route === "security") return "Review security activity";
  if (/propert|listing|inspection/.test(route)) return "Open property record";
  if (/booking|reservation/.test(route)) return "Open booking record";
  if (/worker|service|job/.test(route)) return "Open worker record";
  if (route === "roommate") return "Open roommate update";
  if (/finance|earning|payment|wallet/.test(route)) return "Open money record";
  return route ? "Open related record" : "View details";
}

export function isConversationDestination(row: Pick<ActivityFeedRow, "source_type" | "destination_route">) {
  const route = String(row.destination_route || "").toLowerCase();
  const source = String(row.source_type || "").toLowerCase();
  return /^(conversation|conversations|message|messages|chat)$/.test(route) || /conversation|message|chat/.test(source);
}

export function activityIsCurrent(row: ActivityFeedRow, now = Date.now()) {
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  const type = String(row.type || "");
  const retentionDays = activityNeedsAction(row)
    ? 180
    : row.read
      ? FINANCIAL_ACTIVITY.test(type) ? 90 : BOOKING_ACTIVITY.test(type) ? 30 : ROOMMATE_ACTIVITY.test(type) ? 14 : ACCOUNT_ACTIVITY.test(type) ? 30 : 14
      : FINANCIAL_ACTIVITY.test(type) ? 180 : ACCOUNT_ACTIVITY.test(type) || BOOKING_ACTIVITY.test(type) ? 90 : ROOMMATE_ACTIVITY.test(type) ? 30 : row.source === "announcement" ? 30 : 30;
  return created >= now - retentionDays * 86_400_000;
}

function activityLane(type: string) {
  if (FINANCIAL_ACTIVITY.test(type)) return "finance";
  if (/inspection|visit|access_evidence/i.test(type)) return "inspection";
  if (/hotel/i.test(type)) return "hotel";
  if (/reservation|booking|tenancy|move_in|handover|property|listing/i.test(type)) return "housing";
  if (/worker|job|service/i.test(type)) return "worker";
  if (ROOMMATE_ACTIVITY.test(type)) return "roommate";
  if (ACCOUNT_ACTIVITY.test(type)) return "account";
  return "general";
}

export function currentActivityRows<T extends ActivityFeedRow>(rows: T[], now = Date.now()) {
  const seen = new Set<string>();
  return [...rows]
    .filter((row) => !isTransientActivityEvent(row) && !isOrdinaryMessageEvent(row) && activityIsCurrent(row, now))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .filter((row) => {
      const type = String(row.type || "");
      const isLifecycle = FINANCIAL_ACTIVITY.test(type) || BOOKING_ACTIVITY.test(type) || ROOMMATE_ACTIVITY.test(type);
      // An action stays visible until the workflow records its resolution. Merely
      // reading it, or receiving a different lifecycle event, must not erase it.
      const key = isLifecycle && row.source_type && row.source_id
        ? `${row.source_type}:${row.source_id}:${activityLane(type)}`
        : "";
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function longestActivityCutoff(now = Date.now()) {
  return new Date(now - 180 * 86_400_000).toISOString();
}
