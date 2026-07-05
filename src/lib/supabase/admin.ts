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
  // PRIMARY: Direct query — always works, no RPC needed
  let query = supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);

  // Admin does NOT see creator account in their count
  // Creator sees EVERYTHING including themselves
  if (callerRole === 'admin') {
    query = query.neq('role', 'creator');
  }

  const { count, error } = await query;
  if (error) {
    // FALLBACK: Try RPC if direct query fails
    const { data: rpcData, error: rpcError } = await supabase.rpc('admin_get_user_count', { p_caller_role: callerRole });
    if (!rpcError && rpcData && rpcData.length > 0) {
      return { total: Number(rpcData[0].total) || 0, today: Number(rpcData[0].today) || 0, error: null };
    }
    return { total: 0, today: 0, error };
  }

  // Count users created today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: todayCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .gte('created_at', todayStart.toISOString());

  return { total: count || 0, today: todayCount || 0, error: null };
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

export async function getCreatorDashboardStats(): Promise<{ stats: CreatorDashboardStats | null; error: any }> {
  // Run all counts in parallel for speed
  const [
    usersRes, workersRes, partnersRes, staffRes, adminsRes,
    listingsRes, inspectionsRes, verificationsRes,
    workerBookingsRes, escrowRes, walletRes
  ] = await Promise.all([
    // Total users (excluding soft-deleted)
    supabase.from('profiles').select('*', { count: 'exact', head: true }).is('deleted_at', null),
    // Workers
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'worker').is('deleted_at', null),
    // Property Partners
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'property_partner').is('deleted_at', null),
    // Staff
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'staff').is('deleted_at', null),
    // Admins
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'admin').is('deleted_at', null),
    // Listings
    supabase.from('listings').select('*', { count: 'exact', head: true }).is('deleted_at', null),
    // Pending Inspections
    supabase.from('inspection_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    // Pending Worker Verifications
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'worker').eq('worker_status', 'pending').is('deleted_at', null),
    // Active Worker Bookings
    supabase.from('worker_bookings').select('*', { count: 'exact', head: true }).is('deleted_at', null).in('status', ['booking_requested', 'negotiating', 'confirmed', 'in_progress']),
    // Escrow
    supabase.from('escrow_transactions').select('amount').eq('status', 'held'),
    // Wallets (pending payouts)
    supabase.from('worker_wallets').select('pending_balance'),
  ]);

  // Calculate totals
  const escrowTotal = (escrowRes.data || []).reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const pendingTotal = (walletRes.data || []).reduce((s: number, r: any) => s + (r.pending_balance || 0), 0);

  // Today's signups
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: todayCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .gte('created_at', todayStart.toISOString());

  return {
    stats: {
      totalUsers: usersRes.count || 0,
      totalWorkers: workersRes.count || 0,
      totalPartners: partnersRes.count || 0,
      totalStaff: staffRes.count || 0,
      totalAdmins: adminsRes.count || 0,
      totalListings: listingsRes.count || 0,
      pendingInspections: inspectionsRes.count || 0,
      pendingVerifications: verificationsRes.count || 0,
      activeWorkerBookings: workerBookingsRes.count || 0,
      totalRevenue: escrowTotal + pendingTotal,
      pendingPayouts: pendingTotal,
      escrowBalance: escrowTotal,
      todaySignups: todayCount || 0,
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
