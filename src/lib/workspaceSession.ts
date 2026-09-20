import type { WorkspaceAccess, WorkspaceChoice } from '@/pages/AccountCenter';

export function workspaceStorageKey(userId: string) {
  return `wh_workspace_${userId}`;
}

export function workspaceNavigationKey(userId: string, workspace: WorkspaceChoice) {
  return `wh_navigation_${userId}:${workspace}`;
}

export function resolveWorkspace(access: WorkspaceAccess, userId: string, preferred: string | null): WorkspaceChoice | null {
  if (access.identity?.user_id !== userId || !access.personal_workspace) return null;
  const allowed = new Set<WorkspaceChoice>(['personal', ...(access.privileged_workspaces || []).map(item => item.role)]);
  return preferred && allowed.has(preferred as WorkspaceChoice) ? preferred as WorkspaceChoice : 'personal';
}
