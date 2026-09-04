export type ActivityFeedRow = {
  id?: string;
  type?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  destination_route?: string | null;
  created_at: string;
  read?: boolean;
  source?: "event" | "announcement";
};

const FINANCIAL_ACTIVITY = /payment|payout|earning|dispute|refund/i;
const ACCOUNT_ACTIVITY = /security|password|verification/i;
const BOOKING_ACTIVITY = /booking|reservation|inspection|listing|property|hotel|job|worker|status/i;
const ROOMMATE_ACTIVITY = /roommate|match|invite|interest/i;
const MESSAGE_LIFECYCLE = /price|payment|accepted|declined|cancel|complete|scheduled|security|verification|match|invite|reservation|booking|payout|earning|status/i;

export function isOrdinaryMessageEvent(row: Pick<ActivityFeedRow, "type" | "source_type" | "destination_route">) {
  const type = String(row.type || "").toLowerCase();
  // Device verification and new-login alerts are security surfaces. They are
  // deliberately delivered outside the Activity feed.
  if (type === "device_confirmation_pending" || type === "new_device_login") return true;
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
  const type = String(row.type || "");
  const retentionDays = row.read
    ? FINANCIAL_ACTIVITY.test(type) ? 30 : ROOMMATE_ACTIVITY.test(type) ? 3 : 7
    : FINANCIAL_ACTIVITY.test(type) ? 90 : ACCOUNT_ACTIVITY.test(type) || BOOKING_ACTIVITY.test(type) ? 30 : ROOMMATE_ACTIVITY.test(type) ? 14 : row.source === "announcement" ? 30 : 14;
  return created >= now - retentionDays * 86_400_000;
}

export function currentActivityRows<T extends ActivityFeedRow>(rows: T[], now = Date.now()) {
  const seen = new Set<string>();
  return [...rows]
    .filter((row) => !isOrdinaryMessageEvent(row) && activityIsCurrent(row, now))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .filter((row) => {
      const type = String(row.type || "");
      const isLifecycle = FINANCIAL_ACTIVITY.test(type) || BOOKING_ACTIVITY.test(type) || ROOMMATE_ACTIVITY.test(type);
      const key = isLifecycle && row.source_type && row.source_id ? `${row.source_type}:${row.source_id}` : "";
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function longestActivityCutoff(now = Date.now()) {
  return new Date(now - 90 * 86_400_000).toISOString();
}
