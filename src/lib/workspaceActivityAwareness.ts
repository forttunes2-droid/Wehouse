import type { WorkspaceChoice, WorkspaceAccess } from '@/pages/AccountCenter';

/** A notification can point to a workspace only while this identity still has its grant. */
export function workspaceForActivity(
  audience: string,
  userId: string,
  access: WorkspaceAccess | null | undefined,
): WorkspaceChoice | null {
  if (!access || access.identity?.user_id !== userId) return null;
  const target: WorkspaceChoice | null = audience === 'partner' || audience === 'property_partner' ? 'property_partner'
    : audience === 'hotel' || audience === 'hotel_staff' ? 'hotel'
    : ['staff', 'property_operations', 'field_operations', 'worker_operations', 'finance_operations', 'security_operations', 'support'].includes(audience) ? 'staff'
    : audience === 'worker' || audience === 'admin' || audience === 'creator' ? audience
    : null;
  return target && access.privileged_workspaces?.some(item => item.role === target) ? target : null;
}
