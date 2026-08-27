// ─── PERMISSIONS MODULE ────────────────────────────
// Staff permission reads use RLS. Mutations use the audited, LGA-scoped RPC.

import { supabase } from './client';
import type { StaffPermission } from '@/types';
import type { PostgrestError } from '@supabase/supabase-js';

type PermissionRow = { permission: StaffPermission | null };
type StaffProfileRow = {
  user_id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  role: string;
};
type StaffSummary = Pick<StaffProfileRow, 'user_id' | 'email' | 'username'>;

export async function getStaffPermissions(staffId: string): Promise<{
  permissions: StaffPermission[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase
    .from('staff_permissions')
    .select('permission')
    .eq('staff_id', staffId)
    .eq('is_active', true);

  if (error) return { permissions: [], error };
  return {
    permissions: ((data || []) as PermissionRow[])
      .map((row) => row.permission)
      .filter((permission): permission is StaffPermission => permission !== null),
    error: null,
  };
}

export async function grantPermission(
  staffId: string,
  permission: StaffPermission,
  grantedBy: string
): Promise<{ success: boolean; error: PostgrestError | null }> {
  void grantedBy;
  const { error } = await supabase.rpc('manage_staff_permission', {
    p_staff_id: staffId,
    p_permission: permission,
    p_enabled: true,
  });
  return { success: !error, error };
}

export async function revokePermission(
  staffId: string,
  permission: StaffPermission
): Promise<{ success: boolean; error: PostgrestError | null }> {
  const { error } = await supabase.rpc('manage_staff_permission', {
    p_staff_id: staffId,
    p_permission: permission,
    p_enabled: false,
  });
  return { success: !error, error };
}

export async function hasPermission(staffId: string, permission: StaffPermission): Promise<boolean> {
  const { permissions } = await getStaffPermissions(staffId);
  return permissions.includes(permission);
}

export async function hasAnyPermission(staffId: string, permissions: StaffPermission[]): Promise<boolean> {
  const { permissions: userPerms } = await getStaffPermissions(staffId);
  return permissions.some((p) => userPerms.includes(p));
}

export async function getAllStaffWithPermissions(): Promise<{
  staff: Array<{
    user_id: string;
    email: string;
    username: string | null;
    full_name: string | null;
    role: string;
    permissions: StaffPermission[];
  }>;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, email, username, full_name, role')
    .eq('role', 'staff')
    .eq('deleted', false);

  if (error) return { staff: [], error };
  const staff = await Promise.all(((data || []) as StaffProfileRow[]).map(async (profile) => {
    const { permissions } = await getStaffPermissions(profile.user_id);
    return { ...profile, permissions };
  }));
  return { staff, error: null };
}

export async function getStaffByPermission(
  permission: StaffPermission
): Promise<{ staff: StaffSummary[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('staff_permissions')
    .select('staff_id')
    .eq('permission', permission)
    .eq('is_active', true);
  if (error || !data?.length) return { staff: [], error };

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, email, username')
    .in('user_id', data.map((row) => row.staff_id));
  return { staff: (profiles || []) as StaffSummary[], error: profileError };
}
