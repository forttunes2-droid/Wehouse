export type WorkspaceName =
  | "personal"
  | "worker"
  | "property_partner"
  | "staff"
  | "admin"
  | "creator"
  | "hotel";

const WORKSPACE_LABELS: Record<WorkspaceName, string> = {
  personal: "Personal",
  worker: "Service Worker",
  property_partner: "Property Partner",
  staff: "WeHouse Team",
  admin: "WeHouse Team",
  creator: "Creator",
  hotel: "Hotel Team",
};

export function workspaceLabel(workspace: WorkspaceName) {
  return WORKSPACE_LABELS[workspace];
}

export const WORKSPACE_GROUPS = ["Your professional profiles", "Hotel Team", "WeHouse Team"] as const;

export function workspaceGroup(workspace: WorkspaceName): typeof WORKSPACE_GROUPS[number] | "Personal" {
  if (workspace === "personal") return "Personal";
  if (workspace === "worker" || workspace === "property_partner") return "Your professional profiles";
  if (workspace === "hotel") return "Hotel Team";
  return "WeHouse Team";
}
