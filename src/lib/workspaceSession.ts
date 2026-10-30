import type { WorkspaceAccess, WorkspaceChoice } from '@/pages/AccountCenter';

export function workspaceStorageKey(userId: string) {
  return `wh_workspace_${userId}`;
}

export function workspaceNavigationKey(userId: string, workspace: WorkspaceChoice) {
  return `wh_navigation_${userId}:${workspace}`;
}

export function resolveWorkspace(access: WorkspaceAccess, userId: string, preferred: string | null): WorkspaceChoice | null {
  if (access.identity?.user_id !== userId) return null;
  const allowed = new Set<WorkspaceChoice>([...(access.personal_workspace ? ['personal' as const] : []), ...(access.privileged_workspaces || []).map(item => item.role)]);
  if (preferred && allowed.has(preferred as WorkspaceChoice)) return preferred as WorkspaceChoice;
  // Internal WeHouse identities should not be dumped into the consumer app on
  // a fresh browser. Marketplace workspaces still default to Personal unless
  // the person deliberately selected them before.
  for (const internal of ['creator', 'admin', 'staff'] as WorkspaceChoice[]) {
    if (allowed.has(internal)) return internal;
  }
  // With no permitted marketplace workspace, Personal is a recovery-only shell.
  return allowed.has('personal') ? 'personal' : allowed.values().next().value || 'personal';
}
