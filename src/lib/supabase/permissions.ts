// ─── PERMISSIONS MODULE ────────────────────────────
// Staff permission management — Creator assigns, staff dashboard reads.
// This is the CORE of the permission-driven architecture.

import { supabase } from './client';
import type { StaffPermission, StaffPermissionRecord } from '@/types';

// ─── GET PERMISSIONS ───────────────────────────────

export async function getStaffPermissions(staffId: string): Promise<{
  permissions: StaffPermission[];
  records: StaffPermissionRecord[];
  error: any;
}> {
  const { data, error } = await supabase
    .from('staff_permissions')
    .select('*')
    .eq('staff_id', staffId)
    .eq('is_active', true);

  if (error) return { permissions: [], records: [], error };

  const records = (data || []) as StaffPermissionRecord[];
  const permissions = records.map(r => r.permission as StaffPermission);
  return { permissions, records, error: null };
}

// ─── GRANT PERMISSION ──────────────────────────────

export async function grantPermission(
  staffId: string,
  permission: StaffPermission,
  grantedBy: string
): Promise<{ success: boolean; error: any }> {
  const { error } = await supabase
    .from('staff_permissions')
    .upsert(
      { staff_id: staffId, permission, granted_by: grantedBy, is_active: true, granted_at: new Date().toISOString() },
      { onConflict: 'staff_id,permission' }
    );

  if (error) return { success: false, error };

  // Also update the quick-check array on profiles
  await _refreshProfilePermissions(staffId);
  return { success: true, error: null };
}

// ─── REVOKE PERMISSION ─────────────────────────────

export async function revokePermission(
  staffId: string,
  permission: StaffPermission
): Promise<{ success: boolean; error: any }> {
  const { error } = await supabase
    .from('staff_permissions')
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq('staff_id', staffId)
    .eq('permission', permission);

  if (error) return { success: false, error };

  await _refreshProfilePermissions(staffId);
  return { success: true, error: null };
}

// ─── CHECK PERMISSION ──────────────────────────────

export async function hasPermission(
  staffId: string,
  permission: StaffPermission
): Promise<boolean> {
  const { permissions } = await getStaffPermissions(staffId);
  return permissions.includes(permission);
}

export async function hasAnyPermission(
  staffId: string,
  permissions: StaffPermission[]
): Promise<boolean> {
  const { permissions: userPerms } = await getStaffPermissions(staffId);
  return permissions.some(p => userPerms.includes(p));
}

// ─── GET ALL STAFF WITH PERMISSIONS ────────────────

export async function getAllStaffWithPermissions(): Promise<{
  staff: Array<{
    user_id: string;
    email: string;
    username: string | null;
    full_name: string | null;
    role: string;
    permissions: StaffPermission[];
  }>;
  error: any;
}> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, email, username, full_name, role, staff_permissions')
    .eq('role', 'staff')
    .eq('deleted', false);

  if (error) return { staff: [], error };

  const staff = await Promise.all(
    (data || []).map(async (s: any) => {
      const { permissions } = await getStaffPermissions(s.user_id);
      return {
        user_id: s.user_id,
        email: s.email,
        username: s.username,
        full_name: s.full_name,
        role: s.role,
        permissions,
      };
    })
  );

  return { staff, error: null };
}

// ─── GET STAFF BY PERMISSION ───────────────────────

export async function getStaffByPermission(
  permission: StaffPermission
): Promise<{ staff: Array<{ user_id: string; email: string; username: string | null }>; error: any }> {
  const { data, error } = await supabase
    .from('staff_permissions')
    .select('staff_id')
    .eq('permission', permission)
    .eq('is_active', true);

  if (error || !data?.length) return { staff: [], error };

  const staffIds = data.map(d => d.staff_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, email, username')
    .in('user_id', staffIds);

  return { staff: profiles || [], error: null };
}

// ─── INTERNAL: REFRESH PROFILE PERMISSIONS CACHE ───

async function _refreshProfilePermissions(staffId: string) {
  const { permissions } = await getStaffPermissions(staffId);
  await supabase
    .from('profiles')
    .update({ staff_permissions: permissions })
    .eq('user_id', staffId);
}
