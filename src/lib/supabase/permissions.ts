// ─── PERMISSIONS MODULE ────────────────────────────
// Staff permission management — reads from staff_modules table
// StaffListTab writes to staff_modules, StaffDashboard reads permissions here
// ═══════════════════════════════════════════════════

import { supabase } from './client';
import type { StaffPermission } from '@/types';

// ─── GET PERMISSIONS ───────────────────────────────
// Reads from staff_modules table (where StaffListTab assigns modules)

export async function getStaffPermissions(staffId: string): Promise<{
  permissions: StaffPermission[];
  error: any;
}> {
  // Read from staff_modules table — this is where StaffListTab writes
  const { data, error } = await supabase
    .from('staff_modules')
    .select('module')
    .eq('staff_id', staffId)
    .is('revoked_at', null);

  if (error) return { permissions: [], error };

  // Map module names to StaffPermission type
  const moduleToPermission: Record<string, StaffPermission> = {
    operations: 'operations',
    finance: 'finance',
    support: 'support',
    verification: 'verification',
    field_officer: 'field_officer',
  };

  const permissions = (data || [])
    .map((r: any) => moduleToPermission[r.module])
    .filter(Boolean) as StaffPermission[];

  return { permissions, error: null };
}

// ─── GRANT PERMISSION ──────────────────────────────
// Also writes to staff_modules to keep both tables in sync

export async function grantPermission(
  staffId: string,
  permission: StaffPermission,
  _grantedBy: string
): Promise<{ success: boolean; error: any }> {
  const { error } = await supabase
    .from('staff_modules')
    .upsert(
      { staff_id: staffId, module: permission },
      { onConflict: 'staff_id,module' }
    );

  if (error) return { success: false, error };

  return { success: true, error: null };
}

// ─── REVOKE PERMISSION ─────────────────────────────

export async function revokePermission(
  staffId: string,
  permission: StaffPermission
): Promise<{ success: boolean; error: any }> {
  const { error } = await supabase
    .from('staff_modules')
    .update({ revoked_at: new Date().toISOString() })
    .eq('staff_id', staffId)
    .eq('module', permission)
    .is('revoked_at', null);

  if (error) return { success: false, error };

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
    .select('user_id, email, username, full_name, role')
    .eq('role', 'staff')
    .is('deleted_at', null);

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
    .from('staff_modules')
    .select('staff_id')
    .eq('module', permission)
    .is('revoked_at', null);

  if (error || !data?.length) return { staff: [], error };

  const staffIds = data.map((d: any) => d.staff_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, email, username')
    .in('user_id', staffIds);

  return { staff: profiles || [], error: null };
}
