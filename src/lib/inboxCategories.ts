export type InboxCategory = "all" | "private" | "wehouse";
export type InboxThreadKind = "roommate" | "worker" | "hotel" | "support";

// A navigation category, not an assertion about a conversation's encryption.
export function matchesInboxCategory(kind: InboxThreadKind, category: InboxCategory) {
  return category === "all" || (category === "wehouse" ? kind === "support" : kind !== "support");
}
