import { supabase } from './client';
import type { AdminAuditLog, Listing, Profile, SystemSetting } from '@/types';

// ─── ADMIN HELPERS ─────────────────────────────────

// ── USERS (with soft-delete filtering) ─────────────

export async function getAllUsers() {
  // Use RPC to bypass RLS — creator needs to see ALL users
  const { data, error } = await supabase.rpc('admin_get_all_users');
  return { users: data as Profile[] | null, error };
}

export async function getUserCount(callerRole: 'admin' | 'creator' = 'admin') {
  // Use getAllUsers() which uses RPC (bypasses RLS) — counts from array are reliable
  const { users, error } = await getAllUsers();
  if (error || !users) {
    return { total: 0, today: 0, error };
  }

  const activeUsers = users.filter((u: any) => !u.deleted);

  // Admin: exclude creator. Creator: see all.
  const filtered = callerRole === 'admin'
    ? activeUsers.filter((u: any) => u.role !== 'creator')
    : activeUsers;

  // Count today's signups
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = filtered.filter((u: any) => {
    const created = new Date(u.created_at);
    return created >= todayStart;
  }).length;

  return { total: filtered.length, today: todayCount, error: null };
}

// ═══════════════════════════════════════════════════════════════
// COMPREHENSIVE CREATOR DASHBOARD STATS — Direct Queries
// ═══════════════════════════════════════════════════════════════

export interface CreatorDashboardStats {
  totalUsers: number;
  totalWorkers: number;
  totalPartners: number;
  totalStaff: number;
  totalAdmins: number;
  totalListings: number;
  pendingInspections: number;
  pendingVerifications: number;
  activeWorkerBookings: number;
  totalRevenue: number;
  pendingPayouts: number;
  escrowBalance: number;
  todaySignups: number;
}

export async function getCreatorDashboardStats(): Promise<{ stats: CreatorDashboardStats; error: any }> {
  const ZERO_STATS: CreatorDashboardStats = {
    totalUsers: 0, totalWorkers: 0, totalPartners: 0, totalStaff: 0, totalAdmins: 0,
    totalListings: 0, pendingInspections: 0, pendingVerifications: 0,
    activeWorkerBookings: 0, totalRevenue: 0, pendingPayouts: 0, escrowBalance: 0, todaySignups: 0,
  };

  // Use getAllUsers() which uses RPC (bypasses RLS)
  const { users, error: usersErr } = await getAllUsers();

  if (usersErr || !users) {
    // RPC failed — return zero stats with the error so UI can show it
    return { stats: ZERO_STATS, error: usersErr };
  }

  // Count from the array (reliable, bypasses RLS)
  const activeUsers = users.filter((u: any) => !u.deleted && !u.deleted_at);
  const totalUsers = activeUsers.length;
  const totalWorkers = activeUsers.filter((u: any) => u.role === 'worker').length;
  const totalPartners = activeUsers.filter((u: any) => u.role === 'property_partner').length;
  const totalStaff = activeUsers.filter((u: any) => u.role === 'staff').length;
  const totalAdmins = activeUsers.filter((u: any) => u.role === 'admin').length;
  const pendingVerifications = activeUsers.filter((u: any) => u.role === 'worker' && u.worker_status === 'pending').length;

  // Today's signups
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySignups = activeUsers.filter((u: any) => {
    const created = new Date(u.created_at);
    return created >= todayStart;
  }).length;

  // Direct queries for other tables (RLS may block some)
  const [{ count: listingsCount }, { count: inspectionsCount }, { count: bookingsCount }] = await Promise.all([
    supabase.from('listings').select('*', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('inspection_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('worker_bookings').select('*', { count: 'exact', head: true }).in('status', ['booking_requested', 'negotiating', 'confirmed', 'in_progress']),
  ]);

  return {
    stats: {
      totalUsers, totalWorkers, totalPartners, totalStaff, totalAdmins,
      totalListings: listingsCount || 0,
      pendingInspections: inspectionsCount || 0,
      pendingVerifications,
      activeWorkerBookings: bookingsCount || 0,
      totalRevenue: 0, pendingPayouts: 0, escrowBalance: 0, todaySignups,
    },
    error: null,
  };
}

// ── ROLE MANAGEMENT ────────────────────────────────

// ═══════════════════════════════════════════════════════════════
// ROLE HIERARCHY — ENFORCED THROUGHOUT PLATFORM
// Creator > Admin > Staff > Property Partner > Worker > User
// ═══════════════════════════════════════════════════════════════

// Base transitions (Creator can do ALL of these + admin promotions)
const BASE_TRANSITIONS: Record<string, string[]> = {
  user: ['staff'],           // User can become Staff
  staff: ['user'],           // Staff can be demoted to User
  admin: ['user', 'staff'],  // Admin can be demoted
  property_partner: [],      // Partners sign up as partners — fixed
  worker: [],                // Workers sign up as workers — fixed
  creator: [],               // Creator never changes
};

/**
 * Check if a role change is allowed.
 * @param currentRole — the user's current role
 * @param newRole — the desired new role
 * @param changerRole — who is making the change ('creator' | 'admin' | 'staff')
 */
export function canChangeRole(
  currentRole: string,
  newRole: string,
  changerRole: 'creator' | 'admin' | 'staff' = 'creator'
): { allowed: boolean; reason?: string } {
  // Nobody can change a Creator (not even another Creator)
  if (currentRole === 'creator') return { allowed: false, reason: 'Creator role is immutable.' };
  // Nobody can assign Creator role
  if (newRole === 'creator') return { allowed: false, reason: 'Creator role cannot be assigned.' };
  // Workers and Partners have fixed roles from signup
  if (currentRole === 'worker') return { allowed: false, reason: 'Workers signed up as workers. Role cannot be changed.' };
  if (currentRole === 'property_partner') return { allowed: false, reason: 'Property partners signed up as partners. Role cannot be changed.' };
  if (newRole === 'worker') return { allowed: false, reason: 'Workers must sign up via worker registration.' };
  if (newRole === 'property_partner') return { allowed: false, reason: 'Partners must sign up via partner registration.' };

  // Admin promotion: ONLY Creator can promote someone TO admin
  // Admin demotion: Creator can demote admin → user/staff
  if (newRole === 'admin') {
    if (changerRole !== 'creator') {
      return { allowed: false, reason: 'Only the Creator can create Admins.' };
    }
    // Creator can promote User or Staff to Admin
    if (currentRole === 'user' || currentRole === 'staff') {
      return { allowed: true };
    }
    return { allowed: false, reason: `Cannot promote ${currentRole} directly to Admin.` };
  }

  // Admin making changes: can only manage users and staff (not other admins)
  if (changerRole === 'admin') {
    if (currentRole === 'admin') {
      return { allowed: false, reason: 'Admins cannot modify other Admins. Contact Creator.' };
    }
    // Admin can: user ↔ staff
    const allowed = BASE_TRANSITIONS[currentRole] || [];
    if (!allowed.includes(newRole)) {
      return { allowed: false, reason: `As Admin, you cannot change ${currentRole} to ${newRole}.` };
    }
    return { allowed: true };
  }

  // Creator can do any valid base transition + admin promotions
  const allowed = changerRole === 'creator'
    ? [...(BASE_TRANSITIONS[currentRole] || []), 'admin'] // Creator gets admin too
    : (BASE_TRANSITIONS[currentRole] || []);

  if (!allowed.includes(newRole)) {
    return { allowed: false, reason: `Cannot change ${currentRole} to ${newRole}.` };
  }
  return { allowed: true };
}

export async function updateUserRole(
  userId: string,
  newRole: string,
  currentRole: string,
  changedBy: string,
  changedByEmail: string,
  userEmail: string,
  changerRole: 'creator' | 'admin' | 'staff' = 'creator'
) {
  // 1. Validate transition with role hierarchy
  const validation = canChangeRole(currentRole, newRole, changerRole);
  if (!validation.allowed) return { error: { message: validation.reason } as any };

  // 2. Update role via RPC (bypasses RLS)
  const { error } = await supabase.rpc('admin_update_role', {
    target_user_id: userId,
    new_role: newRole,
  });
  if (error) return { error };

  // 3. Log to role_change_history
  await supabase.from('role_change_history').insert({
    user_id: userId,
    user_email: userEmail,
    old_role: currentRole,
    new_role: newRole,
    changed_by: changedBy,
    changed_by_email: changedByEmail,
  });

  return { error: null };
}

export async function getRoleChangeHistory(userId?: string) {
  let query = supabase.from('role_change_history').select('*').order('created_at', { ascending: false });
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  return { history: data as any[] | null, error };
}

// ── SOFT DELETE ────────────────────────────────────

export async function deleteUser(userId: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ deleted: true, deleted_at: new Date().toISOString() })
    .eq('user_id', userId);
  return { error };
}

export async function deleteOwnAccount(userId: string, _authId: string) {
  return await deleteUser(userId);
}

export async function restoreUser(userId: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ deleted: false, deleted_at: null })
    .eq('user_id', userId);
  return { error };
}

// Toggle maintenance exemption (creator can whitelist accounts for testing during upgrades)
export async function toggleMaintenanceExempt(userId: string, exempt: boolean) {
  const { error } = await supabase.rpc('admin_toggle_exempt', {
    target_user_id: userId,
    exempt: exempt,
  });
  return { error };
}

export async function getAllListingsAdmin() {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

export async function getReports() {
  const { data, error } = await supabase.from('listing_reports').select('*').order('created_at', { ascending: false });
  return { reports: data as any[] | null, error };
}

export async function createReport(reporterId: string, reason: string, listingId?: string, reportedUserId?: string) {
  const { data, error } = await supabase.from('listing_reports').insert({
    reporter_id: reporterId,
    listing_id: listingId || null,
    reported_user_id: reportedUserId || null,
    reason,
    status: 'active',
  }).select();
  return { report: data?.[0] || null, error };
}

export async function resolveReport(reportId: string, adminId: string) {
  const { error } = await supabase.from('listing_reports').update({ status: 'resolved', resolved_by: adminId, resolved_at: new Date().toISOString() }).eq('id', reportId);
  return { error };
}

export async function dismissReport(reportId: string, adminId: string) {
  const { error } = await supabase.from('listing_reports').update({ status: 'dismissed', resolved_by: adminId, resolved_at: new Date().toISOString() }).eq('id', reportId);
  return { error };
}

export async function suspendUser(userId: string) {
  const { error } = await supabase.rpc('admin_suspend_user', { target_user_id: userId });
  return { error };
}

export async function reactivateUser(userId: string) {
  const { error } = await supabase.rpc('admin_reactivate_user', { target_user_id: userId });
  return { error };
}

export async function freezeUser(userId: string) {
  // Freeze is same as suspend
  const { error } = await supabase.rpc('admin_suspend_user', { target_user_id: userId });
  return { error };
}

export async function banUser(userId: string) {
  const { error } = await supabase.rpc('admin_ban_user', { target_user_id: userId });
  return { error };
}

export async function getAuditLogs() {
  const { data, error } = await supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false });
  return { logs: data as AdminAuditLog[] | null, error };
}

export async function logAuditAction(adminId: string, email: string, action: string, targetType: string, targetId: string, details: string) {
  const { error } = await supabase.from('admin_audit_log').insert({
    admin_id: adminId,
    admin_email: email,
    action,
    target_type: targetType,
    target_id: targetId,
    details,
  });
  return { error };
}

// Settings table: platform_settings
// Reads ALL rows from the DB and merges with defaults
const DEFAULT_SETTINGS: Record<string, string> = {
  platform_name: 'WeHouse',
  listing_approval_required: 'false',
  default_user_role: 'user',
  maintenance_mode: 'false',
  registration_open: 'true',
  max_listings_per_user: '5',
  support_whatsapp: '',
  support_telegram: '',
  support_email: '',
  openai_api_key: '',
};

export async function getSystemSettings() {
  const { data, error } = await supabase.from('platform_settings').select('*');
  // Start with ALL database rows
  const merged: SystemSetting[] = (data || []).map((dbRow: any) => ({
    id: dbRow.id,
    key: dbRow.key,
    value: dbRow.value ?? DEFAULT_SETTINGS[dbRow.key] ?? '',
    updated_by: dbRow.updated_by || null,
    updated_at: dbRow.updated_at || new Date().toISOString(),
  }));
  // Add any missing defaults that aren't in the DB yet
  Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
    if (!merged.find((m) => m.key === key)) {
      merged.push({
        id: key,
        key,
        value,
        updated_by: null,
        updated_at: new Date().toISOString(),
      });
    }
  });
  return { settings: merged, error };
}

export async function updateSystemSetting(key: string, value: string, updatedBy: string) {
  // Try upsert — insert if not exists, update if exists
  const { error } = await supabase
    .from('platform_settings')
    .upsert(
      { key, value, updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  return { error };
}

// ─── STAFF REVIEWS ─────────────────────────────────

export async function submitStaffReview(reviewerId: string, staffId: string, rating: number, comment?: string, bookingId?: number) {
  const { data, error } = await supabase
    .from('staff_reviews')
    .insert({
      reviewer_id: reviewerId,
      staff_id: staffId,
      booking_id: bookingId || null,
      rating,
      comment: comment || null,
    })
    .select()
    .maybeSingle();
  return { review: data, error };
}

export async function getStaffReviews(staffId: string) {
  const { data, error } = await supabase
    .from('staff_reviews')
    .select('*, profiles!staff_reviews_reviewer_id_fkey(username, avatar_url)')
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false });
  return { reviews: data, error };
}

export async function getStaffRatingSummary(staffId: string) {
  const { data, error } = await supabase.rpc('get_staff_rating', { staff_user_id: staffId });
  return { summary: data?.[0] || { avg_rating: 0, review_count: 0 }, error };
}

// force deploy Fri May 29 09:06:48 CST 2026
// deploy trigger 1780037607
