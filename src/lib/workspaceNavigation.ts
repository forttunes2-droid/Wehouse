import type { NavPage } from "@/types/nav";

/** Explicit workspace entry is not a restore of an Account subpage.
 * Ordinary refresh still restores navigation within the current workspace.
 * These are destinations only; server workspace grants remain authoritative.
 */
export function workspaceEntryPage(role: string): NavPage {
  const roots: Record<string, NavPage> = {
    creator: "creator", admin: "admin", staff: "staff_dashboard",
    worker: "worker_dashboard", property_partner: "property_partner",
    hosting: "hosting", hotel_staff: "hotel_operations", user: "search",
  };
  return roots[role] || "search";
}

export function accountBackPage(page: NavPage, workspaceRoot: NavPage): NavPage {
  if (page === "profile" || page === "account") return workspaceRoot;
  if (page === "hotel_detail" || page === "hotel_booking") return "hotels";
  return "profile";
}
