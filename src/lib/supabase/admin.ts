import { supabase } from './client';
import type { AdminAuditLog, Listing, Profile, SystemSetting } from '@/types';

// ─── ADMIN HELPERS ─────────────────────────────────

// ── USERS (with soft-delete filtering) ─────────────

export async function getAllUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('deleted', false)
    .order('created_at', { ascending: false });
  return { users: data as Profile[] | null, error };
}

// Get start of TODAY in the user's LOCAL timezone, returned as UTC ISO string.
// E.g. Nigeria (UTC+1) at 8am → returns "2026-05-27T23:00:00.000Z" (midnight local = 11pm UTC prev day)
function getLocalMidnightISO(): string {
  const now = new Date();
  // Create a date at local midnight (year, month, day, 0, 0, 0)
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return localMidnight.toISOString();
}

export async function getUserCount() {
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('deleted', false);
  // Count users created since midnight UTC today (actual "today", not last 24h)
  const { count: today } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('deleted', false)
    .gte('created_at', getLocalMidnightISO());
  return { total: count || 0, today: today || 0, error };
}

// ── ROLE MANAGEMENT ────────────────────────────────

// Valid role transitions — full hierarchy support
// Creator can change any role (except other creators)
// Director can change up to state_admin
// Each role can move within its level and below
const VALID_ROLE_TRANSITIONS: Record<string, string[]> = {
  user: ['staff', 'admin', 'assistant_state_admin', 'state_admin', 'director'],
  staff: ['user', 'admin', 'assistant_state_admin', 'state_admin', 'director'],
  admin: ['user', 'staff', 'assistant_state_admin', 'state_admin', 'director'],
  assistant_state_admin: ['user', 'staff', 'admin', 'state_admin', 'director'],
  state_admin: ['user', 'staff', 'admin', 'assistant_state_admin', 'director'],
  director: ['user', 'staff', 'admin', 'assistant_state_admin', 'state_admin'],
  worker: [],
  creator: [],
};

export function canChangeRole(currentRole: string, newRole: string): { allowed: boolean; reason?: string } {
  // Creator can do anything (except change another creator)
  // This is checked at the UI level via validateRoleTransition
  const allowed = VALID_ROLE_TRANSITIONS[currentRole] || [];
  if (!allowed.includes(newRole)) {
    if (currentRole === 'worker') return { allowed: false, reason: 'Workers signed up as workers. Role cannot be changed.' };
    if (currentRole === 'creator') return { allowed: false, reason: 'Creator role cannot be changed.' };
    if (newRole === 'creator') return { allowed: false, reason: 'Creator role cannot be assigned.' };
    if (newRole === 'worker') return { allowed: false, reason: 'Workers must sign up via worker registration.' };
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

  // 2. Update role
  const { error } = await supabase.from('profiles').update({ role: newRole }).eq('user_id', userId);
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
  const { data, error } = await supabase
    .from('profiles')
    .update({ maintenance_exempt: exempt })
    .eq('user_id', userId)
    .select()
    .single();
  return { profile: data as Profile | null, error };
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
  // Import from workers module to avoid circular dependency
  const { updateWorkerStatus } = await import('./workers');
  return await updateWorkerStatus(userId, 'suspended');
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
    .single();
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
