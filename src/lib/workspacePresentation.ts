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
  worker: "Service Provider",
  property_partner: "Property Partner",
  staff: "WeHouse Team",
  admin: "WeHouse Team",
  creator: "Creator",
  hotel: "Hotel Team",
};

export function workspaceLabel(workspace: WorkspaceName) {
  return WORKSPACE_LABELS[workspace];
}
