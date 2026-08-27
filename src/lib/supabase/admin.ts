import { supabase } from './client';
import type { AdminAuditLog, Listing, ListingReport, Profile, RoleChangeHistory, SystemSetting } from '@/types';

type ErrorLike = { message: string };
type UserCountRow = { total?: number | string | null; today?: number | string | null };

export async function getAllUsers() {
  // Server RPC is the authority. Never fall back to an unrestricted profile query.
  const { data, error } = await supabase.rpc('admin_get_all_users');
  return { users: error ? null : (data as Profile[] | null), error };
}

export async function getUserCount(callerRole: 'admin' | 'creator' = 'admin') {
  const { data, error } = await supabase.rpc('admin_get_user_count');
  if (error) return { total: 0, today: 0, error };
  const row = (Array.isArray(data) ? data[0] : data) as UserCountRow | null;
  // The server already applies Creator-global/Admin-branch scope.
  return {
    total: Number(row?.total || 0),
    today: Number(row?.today || 0),
    error: null,
    callerRole,
  };
}

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

export async function getCreatorDashboardStats(): Promise<{ stats: CreatorDashboardStats; error: ErrorLike | null }> {
  const ZERO_STATS: CreatorDashboardStats = {
    totalUsers: 0, totalWorkers: 0, totalPartners: 0, totalStaff: 0, totalAdmins: 0,
    totalListings: 0, pendingInspections: 0, pendingVerifications: 0,
    activeWorkerBookings: 0, totalRevenue: 0, pendingPayouts: 0, escrowBalance: 0, todaySignups: 0,
  };

  const { users, error: usersErr } = await getAllUsers();
  if (usersErr || !users) return { stats: ZERO_STATS, error: usersErr };

  const activeUsers = users.filter((user) => !user.deleted && !user.deleted_at);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [{ count: listingsCount }, { count: inspectionsCount }, { count: bookingsCount }] = await Promise.all([
    supabase.from('listings').select('*', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('inspection_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('worker_bookings').select('*', { count: 'exact', head: true }).in('status', ['booking_requested', 'negotiating', 'confirmed', 'in_progress']),
  ]);

  return {
    stats: {
      totalUsers: activeUsers.length,
      totalWorkers: activeUsers.filter((user) => user.role === 'worker').length,
      totalPartners: activeUsers.filter((user) => user.role === 'property_partner').length,
      totalStaff: activeUsers.filter((user) => user.role === 'staff').length,
      totalAdmins: activeUsers.filter((user) => user.role === 'admin').length,
      totalListings: listingsCount || 0,
      pendingInspections: inspectionsCount || 0,
      pendingVerifications: activeUsers.filter((user) => user.role === 'worker' && user.worker_status !== null && ['pending', 'verification_paid', 'profile_under_review'].includes(user.worker_status)).length,
      activeWorkerBookings: bookingsCount || 0,
      totalRevenue: 0,
      pendingPayouts: 0,
      escrowBalance: 0,
      todaySignups: activeUsers.filter((user) => new Date(user.created_at) >= todayStart).length,
    },
    error: null,
  };
}

const BASE_TRANSITIONS: Record<string, string[]> = {
  user: ['staff'],
  staff: ['user'],
  admin: ['user', 'staff'],
  property_partner: [],
  worker: [],
  creator: [],
};

export function canChangeRole(
  currentRole: string,
  newRole: string,
  changerRole: 'creator' | 'admin' | 'staff' = 'creator'
): { allowed: boolean; reason?: string } {
  if (currentRole === 'creator') return { allowed: false, reason: 'Creator role is immutable.' };
  if (newRole === 'creator') return { allowed: false, reason: 'Creator role cannot be assigned.' };
  if (currentRole === 'worker' || newRole === 'worker') return { allowed: false, reason: 'Worker role is managed through worker registration.' };
  if (currentRole === 'property_partner' || newRole === 'property_partner') return { allowed: false, reason: 'Property Partner role is managed through partner registration.' };

  if (changerRole === 'admin') {
    if (!['user', 'staff'].includes(currentRole) || !['user', 'staff'].includes(newRole)) {
      return { allowed: false, reason: 'Admin can manage only User and Staff roles in the assigned branch.' };
    }
    return { allowed: BASE_TRANSITIONS[currentRole]?.includes(newRole) || false, reason: BASE_TRANSITIONS[currentRole]?.includes(newRole) ? undefined : 'Invalid Admin role transition.' };
  }

  if (changerRole === 'creator') {
    if (!['user', 'staff', 'admin'].includes(currentRole) || !['user', 'staff', 'admin'].includes(newRole)) {
      return { allowed: false, reason: 'Creator Team management supports User, Staff and Admin roles only.' };
    }
    if (currentRole === newRole) return { allowed: false, reason: 'Account already has that role.' };
    return { allowed: true };
  }

  return { allowed: false, reason: 'Staff cannot change account roles.' };
}

/**
 * Admin-only User <-> Staff transition. The server enforces State + LGA scope and writes audit/history.
 * Creator role management must use creatorSetTeamRole because branch/module fields are mandatory.
 */
export async function updateUserRole(
  userId: string,
  newRole: string,
  currentRole: string,
  _changedBy: string,
  _changedByEmail: string,
  _userEmail: string,
  changerRole: 'creator' | 'admin' | 'staff' = 'admin'
) {
  const validation = canChangeRole(currentRole, newRole, changerRole);
  if (!validation.allowed) return { error: { message: validation.reason || 'Role change is not allowed' } };
  if (changerRole !== 'admin') {
    return { error: { message: 'Creator must use Team management so State, LGA and module are recorded.' } };
  }
  const { error } = await supabase.rpc('admin_update_role', {
    p_target_user_id: userId,
    p_new_role: newRole,
  });
  return { error };
}

export async function creatorSetTeamRole(
  userId: string,
  newRole: 'user' | 'staff' | 'admin',
  state?: string | null,
  lga?: string | null,
  module?: 'operations' | 'finance' | 'support' | 'verification' | 'field_officer' | null,
) {
  const { data, error } = await supabase.rpc('creator_set_team_role', {
    p_target_user_id: userId,
    p_new_role: newRole,
    p_state: state || null,
    p_lga: lga || null,
    p_module: module || null,
  });
  return { data, error };
}

export async function getRoleChangeHistory(userId?: string) {
  let query = supabase.from('role_change_history').select('*').order('created_at', { ascending: false });
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  return { history: data as RoleChangeHistory[] | null, error };
}

export async function deleteAccount(userId: string) {
  const { data, error } = await supabase.rpc('delete_user_account', { p_user_id: userId });
  return { data, error };
}

export async function toggleMaintenanceExempt(userId: string, exempt: boolean) {
  const { error } = await supabase.rpc('admin_toggle_exempt', { target_user_id: userId, exempt });
  return { error };
}

export async function getAllListingsAdmin() {
  const { data, error } = await supabase.from('listings').select('*').is('deleted_at', null).order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

export async function getReports() {
  const { data, error } = await supabase.from('listing_reports').select('*').order('created_at', { ascending: false });
  return { reports: data as ListingReport[] | null, error };
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

export async function suspendUser(userId: string, reason?: string) {
  const { error } = await supabase.rpc('admin_suspend_user', { p_target_user_id: userId, p_reason: reason || null });
  return { error };
}

export async function reactivateUser(userId: string) {
  const { error } = await supabase.rpc('admin_reactivate_user', { p_target_user_id: userId });
  return { error };
}

export async function freezeUser(userId: string, reason?: string) {
  return suspendUser(userId, reason || 'Account frozen by administrator');
}

export async function banUser(userId: string, reason?: string) {
  const { error } = await supabase.rpc('admin_ban_user', { p_target_user_id: userId, p_reason: reason || null });
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
};

export async function getSystemSettings() {
  const { data, error } = await supabase.from('platform_settings').select('*');
  const rows = (data || []) as SystemSetting[];
  const merged: SystemSetting[] = rows.map((dbRow) => ({
    id: dbRow.id,
    key: dbRow.key,
    value: dbRow.value ?? DEFAULT_SETTINGS[dbRow.key] ?? '',
    updated_by: dbRow.updated_by || null,
    updated_at: dbRow.updated_at || new Date().toISOString(),
  }));
  Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
    if (!merged.find((m) => m.key === key)) {
      merged.push({ id: key, key, value, updated_by: null, updated_at: new Date().toISOString() });
    }
  });
  return { settings: merged, error };
}

export async function updateSystemSetting(key: string, value: string, updatedBy: string) {
  const { error } = await supabase.from('platform_settings').upsert(
    { key, value, updated_by: updatedBy, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  return { error };
}

export async function submitStaffReview(reviewerId: string, staffId: string, rating: number, comment?: string, bookingId?: number) {
  const { data, error } = await supabase.from('staff_reviews').insert({
    reviewer_id: reviewerId,
    staff_id: staffId,
    booking_id: bookingId || null,
    rating,
    comment: comment || null,
  }).select().maybeSingle();
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
  const { data, error } = await supabase.rpc('get_staff_rating', { p_staff_user_id: staffId });
  return { summary: data?.[0] || { avg_rating: 0, review_count: 0 }, error };
}
