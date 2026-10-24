// Staff dashboard selection follows active workspace grants, like server authority.
import { supabase } from './client';
import { withTimeout } from '@/lib/withTimeout';
import type { StaffPermission } from '@/types';
import type { PostgrestError } from '@supabase/supabase-js';

// The database stores canonical operational domains. The UI keeps the existing
// StaffPermission identifiers so old and new assignments resolve to the same
// one workspace instead of leaving a Staff account with "no work area".
export function normalizeStaffPermission(value: string | null | undefined): StaffPermission | null {
  const key = String(value || '').trim().toLowerCase();
  const map: Record<string, StaffPermission> = {
    operations: 'operations',
    property_operations: 'operations',
    finance: 'finance',
    finance_operations: 'finance',
    support: 'support',
    security: 'security',
    security_operations: 'security',
    worker_review: 'worker_operations',
    verification: 'worker_operations',
    worker_verification: 'worker_operations',
    worker_operations: 'worker_operations',
    field_officer: 'field_officer',
    field_operation: 'field_officer',
    field_operations: 'field_officer',
    admin: 'admin',
  };
  return map[key] || null;
}

export async function getStaffPermissions(staffId: string): Promise<{
  permissions: StaffPermission[];
  error: PostgrestError | Error | null;
}> {
  try {
    const { data, error } = await withTimeout(supabase
      .from('workspace_role_assignments')
      .select('workspace_role')
      .eq('user_id', staffId)
      .eq('status', 'active')
      .is('revoked_at', null)
      .in('workspace_role', ['staff','property_operations','field_operations','worker_operations','finance_operations','security_operations','support']),
      15000, 'Your work area could not be confirmed. Try again.');
    if (error) return { permissions: [], error };
    if (!Array.isArray(data) || data.some(row => !row || typeof row.workspace_role !== 'string')) {
      return { permissions: [], error: new Error('Your work area could not be confirmed. Try again.') };
    }
    if (!data.some(row => row.workspace_role === 'staff')) return { permissions: [], error: null };
    const permissions = data
      .map(row => normalizeStaffPermission(row.workspace_role))
      .filter((permission): permission is StaffPermission => permission !== null);
    return { permissions: [...new Set(permissions)], error: null };
  } catch (cause) {
    return { permissions: [], error: cause instanceof Error ? cause : new Error('Your work area could not be confirmed. Try again.') };
  }
}
