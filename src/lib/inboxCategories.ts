export type InboxCategory = "all" | "people" | "bookings" | "wehouse";
export type InboxThreadKind = "roommate" | "worker" | "hotel" | "host" | "support";

export function matchesInboxCategory(kind: InboxThreadKind, category: InboxCategory) {
  if (category === "all") return true;
  if (category === "people") return kind === "roommate";
  if (category === "bookings") return kind === "worker" || kind === "hotel" || kind === "host";
  return kind === "support";
}
