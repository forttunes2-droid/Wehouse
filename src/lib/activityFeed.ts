export type ActivityFeedRow = {
  type?: string | null;
  source_type?: string | null;
  destination_route?: string | null;
  created_at: string;
  source?: "event" | "announcement";
};

const IMPORTANT_ACTIVITY = /security|device_login|payment|payout|earning|dispute|refund/i;
const MESSAGE_LIFECYCLE = /price|payment|accepted|declined|cancel|complete|scheduled|security|verification|match|invite|reservation|booking|payout|earning|status/i;

export function isOrdinaryMessageEvent(row: Pick<ActivityFeedRow, "type" | "source_type" | "destination_route">) {
  const type = String(row.type || "").toLowerCase();
  if (type === "device_confirmation_pending") return true;
  if (type === "missed_call") return true;
  if (MESSAGE_LIFECYCLE.test(type)) return false;
  if (/(^|_)(message|reply|replied|chat)(_|$)/.test(type)) return true;
  return row.destination_route === "conversation" && /conversation|message|chat/.test(String(row.source_type || "").toLowerCase());
}

export function isConversationDestination(row: Pick<ActivityFeedRow, "source_type" | "destination_route">) {
  const route = String(row.destination_route || "").toLowerCase();
  const source = String(row.source_type || "").toLowerCase();
  return /^(conversation|conversations|message|messages|chat)$/.test(route) || /conversation|message|chat/.test(source);
}

export function activityIsCurrent(row: ActivityFeedRow, now = Date.now()) {
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  const retentionDays = row.source === "announcement" || IMPORTANT_ACTIVITY.test(String(row.type || "")) ? 90 : 30;
  return created >= now - retentionDays * 86_400_000;
}

export function longestActivityCutoff(now = Date.now()) {
  return new Date(now - 90 * 86_400_000).toISOString();
}
