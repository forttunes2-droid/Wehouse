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
  // Use RPC to bypass RLS — pass caller role so admin sees 10 (no creator), creator sees 11 (all)
  const { data, error } = await supabase.rpc('admin_get_user_count', { p_caller_role: callerRole });
  if (error || !data || data.length === 0) return { total: 0, today: 0, error };
  return { total: Number(data[0].total) || 0, today: Number(data[0].today) || 0, error: null };
}

// ── ROLE MANAGEMENT ────────────────────────────────

// Valid role transitions — simplified hierarchy
// Creator can change any role (except other creators)
// Admin can change user ↔ staff
const VALID_ROLE_TRANSITIONS: Record<string, string[]> = {
  user: ['staff', 'admin'],
  staff: ['user', 'admin'],
  admin: ['user', 'staff'],
  property_partner: [],
  worker: [],
  creator: [],
};

export function canChangeRole(currentRole: string, newRole: string): { allowed: boolean; reason?: string } {
  // Creator can do anything (except change another creator)
  // Workers and property partners signed up with their role — cannot be changed
  if (currentRole === 'worker') return { allowed: false, reason: 'Workers signed up as workers. Role cannot be changed.' };
  if (currentRole === 'property_partner') return { allowed: false, reason: 'Property partners signed up as partners. Role cannot be changed.' };
  if (currentRole === 'creator') return { allowed: false, reason: 'Creator role cannot be changed.' };
  if (newRole === 'creator') return { allowed: false, reason: 'Creator role cannot be assigned.' };
  if (newRole === 'worker') return { allowed: false, reason: 'Workers must sign up via worker registration.' };
  if (newRole === 'property_partner') return { allowed: false, reason: 'Partners must sign up via partner registration.' };
  // For user/staff/admin roles, check the transition matrix
  const allowed = VALID_ROLE_TRANSITIONS[currentRole] || [];
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
  userEmail: string
) {
  // 1. Validate transition
  const validation = canChangeRole(currentRole, newRole);
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
