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
  worker: "Worker",
  property_partner: "Property Partner",
  staff: "WeHouse Team",
  admin: "Admin",
  creator: "Creator",
  hotel: "Hotel Team",
};

export function workspaceLabel(workspace: WorkspaceName) {
  return WORKSPACE_LABELS[workspace];
}
