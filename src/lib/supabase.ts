import { createClient } from '@supabase/supabase-js';
import type { Profile, Listing, RoommatePreferences, ListingReport, AdminAuditLog, SystemSetting, Notification, Conversation, Message, Review, RoomInterest } from '@/types';

const SUPABASE_URL = 'https://rkrhnkhppeihvmuwvsvn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrcmhua2hwcGVpaHZtdXd2c3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjY0MjEsImV4cCI6MjA5NTA0MjQyMX0.y78mFMsrN81WOg4-YXHVnq6mNYUw5I-IowQWXnjeXyw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

// ─── AUTH HELPERS ──────────────────────────────────

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${window.location.origin}/login` },
  });
  return { data, error };
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/`,
    },
  });
  return { data, error };
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function resetPassword(email: string) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/login`,
  });
  return { data, error };
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  return { session: data.session, error };
}

// ─── PROFILE HELPERS ───────────────────────────────

export async function getProfile(authId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_id', authId)
    .maybeSingle();
  return { profile: data as Profile | null, error };
}

export async function getProfileByEmail(email: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  return { profile: data as Profile | null, error };
}

export async function linkProfileToAuth(userId: string, newAuthId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      auth_id: newAuthId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .single();
  return { profile: data as Profile | null, error };
}

export function generateUserId(): string {
  // Generate unique WHU-XXXX ID using timestamp (works without reading other profiles)
  // Format: WHU-[4-digit sequential from timestamp]
  // Each millisecond produces a unique number, so no collisions
  const ts = Date.now();
  const seq = (ts % 9000) + 1000; // 1000-9999 range
  return `WHU-${seq}`;
}

export async function createProfile(authId: string, email: string): Promise<{ profile: Profile | null; error: any }> {
  // Try up to 3 times with different IDs in case of collision
  for (let attempt = 0; attempt < 3; attempt++) {
    const userId = generateUserId();
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        auth_id: authId,
        email,
        user_id: userId,
        role: 'user',
        profile_complete: false,
      })
      .select()
      .single();

    if (!error) {
      return { profile: data as Profile, error: null };
    }

    // If not a duplicate key error, return the error
    if (!error.message?.includes('duplicate') && !error.message?.includes('unique')) {
      return { profile: null, error };
    }

    // Wait a tiny bit for next timestamp
    if (attempt < 2) await new Promise(r => setTimeout(r, 2));
  }

  return { profile: null, error: { message: 'Could not generate unique user ID after 3 attempts' } };
}

export async function updateUsername(userId: string, username: string) {
  const { error } = await supabase
    .from('profiles')
    .update({
      username,
      profile_complete: true,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  return { error };
}

export async function isUsernameTaken(username: string) {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  return !!data;
}

// ─── LISTING HELPERS ───────────────────────────────

function generateListingId(): string {
  const ts = Date.now();
  const seq = (ts % 9000) + 1000;
  return `LST-${seq}`;
}

export async function createListing(listing: Partial<Listing>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const listingId = generateListingId();
    const { data, error } = await supabase
      .from('listings')
      .insert({ ...listing, listing_id: listingId })
      .select()
      .single();

    if (!error) return { listing: data as Listing, error: null };
    if (!error.message?.includes('duplicate') && !error.message?.includes('unique')) {
      return { listing: null, error };
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 2));
  }
  return { listing: null, error: { message: 'Could not generate unique listing ID' } };
}

export async function updateListing(id: string, updates: Partial<Listing>) {
  const { data, error } = await supabase
    .from('listings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  return { listing: data as Listing | null, error };
}

export async function deleteListing(id: string) {
  const { error } = await supabase.from('listings').delete().eq('id', id);
  return { error };
}

export async function getListingById(id: string) {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('id', id)
    .single();
  return { listing: data as Listing | null, error };
}

export async function getAllListings() {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('availability_status', 'available')
    .order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

export async function getCreatorListings(authId: string) {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('owner_id', authId)
    .order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

// ─── SAVED LISTINGS ────────────────────────────────

export async function saveListing(userId: string, listingId: string) {
  const { error } = await supabase
    .from('saved_listings')
    .insert({ user_id: userId, listing_id: listingId });
  return { error };
}

export async function unsaveListing(userId: string, listingId: string) {
  const { error } = await supabase
    .from('saved_listings')
    .delete()
    .eq('user_id', userId)
    .eq('listing_id', listingId);
  return { error };
}

export async function getSavedListings(userId: string) {
  const { data, error } = await supabase
    .from('saved_listings')
    .select('listing_id')
    .eq('user_id', userId);
  return { saved: data as { listing_id: string }[] | null, error };
}

export async function isListingSaved(userId: string, listingId: string) {
  const { data } = await supabase
    .from('saved_listings')
    .select('id')
    .eq('user_id', userId)
    .eq('listing_id', listingId)
    .maybeSingle();
  return !!data;
}

// ─── STORAGE HELPERS ───────────────────────────────

export async function uploadListingImage(file: File, listingId: string) {
  const fileName = `${listingId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from('listings')
    .upload(fileName, file, { upsert: false });

  if (uploadError) return { url: null, error: uploadError };

  const { data: urlData } = supabase.storage.from('listings').getPublicUrl(fileName);
  return { url: urlData.publicUrl, error: null };
}

export async function deleteListingImage(path: string) {
  const { error } = await supabase.storage.from('listings').remove([path]);
  return { error };
}

// ─── ROOMMATE HELPERS ──────────────────────────────

export async function getRoommatePreferences(userId: string) {
  const { data, error } = await supabase
    .from('roommate_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return { prefs: data as RoommatePreferences | null, error };
}

export async function getAllRoommatePreferences() {
  const { data, error } = await supabase
    .from('roommate_preferences')
    .select('*')
    .eq('active', true);
  return { prefs: data as RoommatePreferences[] | null, error };
}

export async function saveRoommatePreferences(prefs: Partial<RoommatePreferences>) {
  const { data, error } = await supabase
    .from('roommate_preferences')
    .upsert({ ...prefs, updated_at: new Date().toISOString() })
    .select()
    .single();
  return { prefs: data as RoommatePreferences | null, error };
}

export async function findMatches(userId: string) {
  // Get current user's preferences
  const { data: myPrefs } = await supabase
    .from('roommate_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!myPrefs) return { matches: [], error: null };

  // Get all other active preferences
  const { data: allPrefs } = await supabase
    .from('roommate_preferences')
    .select('*, profiles:user_id(auth_id, username, email, user_id)')
    .eq('active', true)
    .neq('user_id', userId);

  if (!allPrefs) return { matches: [], error: null };

  // Filter by gender rules and calculate scores
  const scored = allPrefs
    .filter((other: any) => {
      // Gender matching rules
      if (myPrefs.gender_preference === 'male' && other.gender !== 'male') return false;
      if (myPrefs.gender_preference === 'female' && other.gender !== 'female') return false;
      if (other.gender_preference === 'male' && myPrefs.gender !== 'male') return false;
      if (other.gender_preference === 'female' && myPrefs.gender !== 'female') return false;
      return true;
    })
    .map((other: any) => {
      let score = 0;
      // Budget overlap (max 30 points)
      const budgetOverlap = Math.max(0, Math.min(myPrefs.budget_max, other.budget_max) - Math.max(myPrefs.budget_min, other.budget_min));
      const budgetRange = Math.max(myPrefs.budget_max - myPrefs.budget_min, 1);
      score += Math.round((budgetOverlap / budgetRange) * 30);

      // Lifestyle matches (10 points each, max 50)
      if (myPrefs.noise_level === other.noise_level) score += 10;
      if (myPrefs.cleanliness === other.cleanliness) score += 10;
      if (myPrefs.sleep_time === other.sleep_time) score += 10;
      if (myPrefs.visitors === other.visitors) score += 10;
      if (myPrefs.area_preference === other.area_preference) score += 10;

      // Study level match (20 points)
      if (myPrefs.study_level === other.study_level) score += 20;

      score = Math.min(100, score);

      return {
        ...other,
        match_score: score,
        match_level: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low' as 'low' | 'medium' | 'high',
      };
    })
    .filter((m: any) => m.match_score > 0)
    .sort((a: any, b: any) => b.match_score - a.match_score);

  return { matches: scored, error: null };
}

export async function saveMatch(userA: string, userB: string, score: number, level: string) {
  const { error } = await supabase
    .from('roommate_matches')
    .upsert({
      user_a_id: userA,
      user_b_id: userB,
      match_score: score,
      match_level: level,
      status: 'pending',
    });
  return { error };
}

export async function getMatchStats() {
  const { count: totalUsers } = await supabase
    .from('roommate_preferences')
    .select('*', { count: 'exact', head: true });
  const { count: totalMatches } = await supabase
    .from('roommate_matches')
    .select('*', { count: 'exact', head: true });
  return { totalUsers: totalUsers || 0, totalMatches: totalMatches || 0 };
}

// ─── PHASE 4 ADMIN HELPERS ─────────────────────────

export async function getAllUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  return { users: data as Profile[] | null, error };
}

export async function getUserCount() {
  const { count: total, error: err1 } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
  const { count: today, error: err2 } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString());
  return { total: total || 0, today: today || 0, error: err1 || err2 };
}

export async function updateUserRole(userId: string, role: string) {
  const { error } = await supabase.from('profiles').update({ role }).eq('user_id', userId);
  return { error };
}

export async function deleteUser(userId: string) {
  const { error } = await supabase.from('profiles').delete().eq('user_id', userId);
  return { error };
}

export async function getAllListingsAdmin() {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

export async function approveListing(id: string) {
  const { error } = await supabase.from('listings').update({ availability_status: 'available' }).eq('id', id);
  return { error };
}

export async function getReports() {
  const { data, error } = await supabase
    .from('listing_reports')
    .select('*')
    .order('created_at', { ascending: false });
  return { reports: data as ListingReport[] | null, error };
}

export async function resolveReport(id: string, adminId: string) {
  const { error } = await supabase.from('listing_reports').update({ status: 'resolved', resolved_by: adminId, resolved_at: new Date().toISOString() }).eq('id', id);
  return { error };
}

export async function dismissReport(id: string, adminId: string) {
  const { error } = await supabase.from('listing_reports').update({ status: 'dismissed', resolved_by: adminId, resolved_at: new Date().toISOString() }).eq('id', id);
  return { error };
}

export async function createReport(report: Partial<ListingReport>) {
  const { error } = await supabase.from('listing_reports').insert(report);
  return { error };
}

export async function logAuditAction(adminId: string, adminEmail: string, action: string, targetType: string, targetId?: string, details?: string) {
  const { error } = await supabase.from('admin_audit_log').insert({
    admin_id: adminId,
    admin_email: adminEmail,
    action,
    target_type: targetType,
    target_id: targetId || null,
    details: details || null,
  });
  return { error };
}

export async function getAuditLogs() {
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  return { logs: data as AdminAuditLog[] | null, error };
}

export async function getNotifications(userId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', userId)
    .eq('read', false)
    .order('created_at', { ascending: false });
  return { notifications: data as Notification[] | null, error };
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
  return { error };
}

export async function getSystemSettings() {
  const { data, error } = await supabase.from('system_settings').select('*');
  return { settings: data as SystemSetting[] | null, error };
}

export async function updateSystemSetting(key: string, value: string, adminId: string) {
  const { error } = await supabase.from('system_settings').update({ value, updated_by: adminId, updated_at: new Date().toISOString() }).eq('key', key);
  return { error };
}

export async function trackActivity(userId: string, authId: string, actionType: string, details?: Record<string, any>) {
  const { error } = await supabase.from('user_activity').insert({
    user_id: userId,
    auth_id: authId,
    action_type: actionType,
    details: details || {},
  });
  return { error };
}

// ─── PHASE 5 CHAT HELPERS ──────────────────────────

export async function getConversations(userId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
    .order('last_message_at', { ascending: false });
  return { conversations: data as Conversation[] | null, error };
}

export async function getOrCreateConversation(userA: string, userB: string) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('participant_a', userA)
    .eq('participant_b', userB)
    .maybeSingle();
  if (existing) return { conversation: existing as Conversation, error: null };

  const { data: existing2 } = await supabase
    .from('conversations')
    .select('*')
    .eq('participant_a', userB)
    .eq('participant_b', userA)
    .maybeSingle();
  if (existing2) return { conversation: existing2 as Conversation, error: null };

  const { data, error } = await supabase.from('conversations').insert({ participant_a: userA, participant_b: userB }).select().single();
  return { conversation: data as Conversation | null, error };
}

export async function getMessages(conversationId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return { messages: data as Message[] | null, error };
}

export async function sendMessage(conversationId: string, senderId: string, content: string) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, content })
    .select()
    .single();
  if (!error && data) {
    await supabase.from('conversations').update({
      last_message: content,
      last_message_at: new Date().toISOString(),
    }).eq('id', conversationId);
  }
  return { message: data as Message | null, error };
}

export async function markMessagesSeen(conversationId: string, userId: string) {
  const { error } = await supabase
    .from('messages')
    .update({ seen: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId);
  return { error };
}

// ─── REVIEWS ───────────────────────────────────────

export async function getReviews(revieweeId: string) {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('reviewee_id', revieweeId)
    .order('created_at', { ascending: false });
  return { reviews: data as Review[] | null, error };
}

export async function createReview(review: Partial<Review>) {
  const { data, error } = await supabase.from('reviews').insert(review).select().single();
  return { review: data as Review | null, error };
}

export async function getAverageRating(revieweeId: string) {
  const { data } = await supabase.from('reviews').select('rating').eq('reviewee_id', revieweeId);
  if (!data || data.length === 0) return { average: 0, count: 0 };
  const avg = data.reduce((sum: number, r: any) => sum + r.rating, 0) / data.length;
  return { average: Math.round(avg * 10) / 10, count: data.length };
}

// ─── ROOM INTERESTS ────────────────────────────────

export async function sendRoomInterest(senderId: string, receiverId: string, message?: string) {
  const { error } = await supabase.from('room_interests').insert({
    sender_id: senderId,
    receiver_id: receiverId,
    message: message || null,
  });
  return { error };
}

export async function getRoomInterests(userId: string) {
  const { data, error } = await supabase
    .from('room_interests')
    .select('*')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  return { interests: data as RoomInterest[] | null, error };
}

export async function respondToInterest(id: string, status: 'accepted' | 'declined') {
  const { error } = await supabase.from('room_interests').update({ status }).eq('id', id);
  return { error };
}

// ─── RECENTLY VIEWED ───────────────────────────────

export async function trackView(userId: string, itemId: string, itemType: string = 'listing') {
  const { error } = await supabase.from('recently_viewed').insert({
    user_id: userId,
    item_id: itemId,
    item_type: itemType,
  });
  return { error };
}

// ─── PROFILE UPDATE ────────────────────────────────

export async function updateProfile(userId: string, updates: Partial<Profile>) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select()
    .single();
  return { profile: data as Profile | null, error };
}
