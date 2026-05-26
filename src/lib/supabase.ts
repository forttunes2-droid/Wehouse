import { createClient } from '@supabase/supabase-js';
import type { Profile, Listing, RoommatePreferences, AdminAuditLog, SystemSetting, Notification, Conversation, Message, Review, RoomInterest } from '@/types';

// ─── SUPABASE CONFIG ───────────────────────────────
// These are PUBLIC client credentials — safe in browser bundles.
// Real security = Row Level Security (RLS) policies, not key secrecy.
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

// ─── DIAGNOSTICS ───────────────────────────────────

export interface DiagnosticsResult {
  supabaseUrl: string;
  keyPresent: boolean;
  keyLength: number;
  authTest: 'ok' | 'error' | 'network_error';
  authError?: string;
  timestamp: string;
}

export async function runDiagnostics(): Promise<DiagnosticsResult> {
  let authTest: DiagnosticsResult['authTest'] = 'ok';
  let authError: string | undefined;

  try {
    const { error } = await supabase.auth.getSession();
    if (error) {
      authTest = 'error';
      authError = error.message;
    }
  } catch (e: any) {
    authTest = 'network_error';
    authError = e?.message || String(e);
  }

  return {
    supabaseUrl: SUPABASE_URL,
    keyPresent: SUPABASE_ANON_KEY.length > 0,
    keyLength: SUPABASE_ANON_KEY.length,
    authTest,
    authError,
    timestamp: new Date().toISOString(),
  };
}

// ─── AUTH HELPERS ──────────────────────────────────

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { source: 'wehouse' } },
  });
  return { data, error };
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/`,
    },
  });
}

export async function resetPassword(email: string) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  });
}

export async function getSession() {
  return supabase.auth.getSession();
}

// ─── SETUP HELPERS ─────────────────────────────────

export async function isUsernameTaken(username: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username.toLowerCase())
    .maybeSingle();
  return !!data;
}

export async function updateUsername(userId: string, username: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ username, profile_complete: true })
    .eq('user_id', userId);
  return { error };
}

// ─── PROFILE HELPERS ───────────────────────────────

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return { profile: data as Profile | null, error };
}

export async function getProfileByAuthId(authId: string) {
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

export async function linkProfileToAuth(userId: string, authId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ auth_id: authId })
    .eq('user_id', userId)
    .select()
    .single();
  return { profile: data as Profile | null, error };
}

// createProfile has two signatures:
//   createProfile(authId, email)        — called from useAuth.ts
//   createProfile(userId, email, username, authId)  — direct calls
export async function createProfile(authId: string, email: string): Promise<{ profile: Profile | null; error: any }>;
export async function createProfile(userId: string, email: string, username: string, authId: string): Promise<{ profile: Profile | null; error: any }>;
export async function createProfile(a: string, b: string, c?: string, d?: string) {
  const authId = c === undefined ? a : d!;
  const email = b;
  const userId = c === undefined ? `WHU-${(Date.now() % 9000) + 1000}` : a;
  const username = c === undefined ? email.split('@')[0].replace(/[^a-z0-9_]/g, '') + Math.floor(Math.random() * 1000) : c;
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      user_id: userId,
      email,
      username,
      auth_id: authId,
      role: 'user',
      profile_complete: false,
    })
    .select()
    .single();
  return { profile: data as Profile | null, error };
}

// ─── AVATAR UPLOAD ─────────────────────────────────

export async function uploadAvatar(file: File, userId: string) {
  // Validate
  if (!file.type.startsWith('image/')) return { url: null, error: { message: 'Please select an image (JPG, PNG)' } as any };
  if (file.size > 5 * 1024 * 1024) return { url: null, error: { message: 'Image must be under 5MB' } as any };

  const compressImage = (f: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(f);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxDim = 600; // Higher quality for profile photos
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxDim) { h = (h / w) * maxDim; w = maxDim; }
        else if (h > maxDim) { w = (w / h) * maxDim; h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('No canvas context')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Compression failed'));
        }, 'image/jpeg', 0.85);
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });
  };

  try {
    const compressed = await compressImage(file);
    const fileName = `avatars/${userId}-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, compressed, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) {
      // Check if bucket doesn't exist
      if (uploadError.message?.includes('bucket') || uploadError.message?.includes('Bucket')) {
        return { url: null, error: { message: 'Storage not configured. Ask admin to run storage setup SQL.' } as any };
      }
      return { url: null, error: uploadError };
    }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
    return { url: urlData.publicUrl, error: null };
  } catch (err: any) {
    return { url: null, error: { message: err.message || 'Upload failed' } };
  }
}

// ─── USERNAME VALIDATION ───────────────────────────

const RESERVED_USERNAMES = ['admin', 'creator', 'support', 'system', 'api', 'wehouse', 'mod', 'moderator', 'owner', 'staff', 'help', 'info', 'null', 'undefined'];

export function validateUsername(username: string): { valid: boolean; error?: string } {
  const trimmed = username.trim().toLowerCase();
  if (!trimmed) return { valid: false, error: 'Username is required' };
  if (trimmed.length < 3) return { valid: false, error: 'Minimum 3 characters' };
  if (trimmed.length > 20) return { valid: false, error: 'Maximum 20 characters' };
  if (!/^[a-z0-9_]+$/.test(trimmed)) return { valid: false, error: 'Letters, numbers, underscores only' };
  if (RESERVED_USERNAMES.includes(trimmed)) return { valid: false, error: 'This username is reserved' };
  return { valid: true };
}

export async function checkUsernameAvailable(username: string, currentUserId?: string) {
  const trimmed = username.trim().toLowerCase();
  const { data } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('username', trimmed)
    .maybeSingle();
  const available = !data || (currentUserId && data.user_id === currentUserId);
  return { available, taken: !available };
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

// ─── PRIVACY SETTINGS ──────────────────────────────

export async function updatePrivacySettings(userId: string, settings: {
  privacy_profile_visible?: boolean;
  privacy_search_visible?: boolean;
  privacy_activity_visible?: boolean;
}) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...settings, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select()
    .single();
  return { profile: data as Profile | null, error };
}

// ─── SESSION TRACKING ──────────────────────────────

export function parseDeviceInfo(ua: string = navigator.userAgent) {
  let device = 'Desktop';
  let os = 'Unknown';
  let browser = 'Unknown';

  if (/Android/.test(ua)) {
    const match = ua.match(/Android\s([\d.]+)/);
    os = match ? `Android ${match[1]}` : 'Android';
    const deviceMatch = ua.match(/;\s*([^)]+)\s*Build/);
    device = deviceMatch ? deviceMatch[1].trim() : 'Android Device';
  } else if (/iPhone/.test(ua)) {
    os = 'iOS';
    device = 'iPhone';
  } else if (/iPad/.test(ua)) {
    os = 'iPadOS';
    device = 'iPad';
  } else if (/Windows NT/.test(ua)) {
    os = 'Windows';
  } else if (/Mac OS/.test(ua)) {
    os = 'macOS';
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  }

  if (/Chrome/.test(ua) && !/Edg/.test(ua) && !/OPR/.test(ua)) {
    const match = ua.match(/Chrome\/([\d.]+)/);
    browser = match ? `Chrome ${match[1].split('.')[0]}` : 'Chrome';
  } else if (/Edg/.test(ua)) {
    browser = 'Edge';
  } else if (/Firefox/.test(ua)) {
    browser = 'Firefox';
  } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
    browser = 'Safari';
  } else if (/OPR/.test(ua)) {
    browser = 'Opera';
  }

  return { device, os, browser };
}

export async function trackSession(userId: string, authId: string) {
  const { device, os, browser } = parseDeviceInfo();
  const { error } = await supabase.from('user_activity').insert({
    user_id: userId,
    auth_id: authId,
    action_type: 'session_start',
    details: { device, os, browser, source: 'login' },
  });
  return { error };
}

export async function endSession(userId: string, authId: string) {
  const { error } = await supabase.from('user_activity').insert({
    user_id: userId,
    auth_id: authId,
    action_type: 'session_end',
    details: { source: 'logout' },
  });
  return { error };
}

export async function getSessionHistory(userId: string, limit: number = 20) {
  const { data, error } = await supabase
    .from('user_activity')
    .select('*')
    .eq('user_id', userId)
    .or('action_type.eq.session_start,action_type.eq.session_end')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { sessions: data || [], error };
}

// ─── LISTING HELPERS ───────────────────────────────

export async function getAllListings() {
  const { data, error } = await supabase.from('listings').select('*').order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

export async function getListing(id: string) {
  const { data, error } = await supabase.from('listings').select('*').eq('listing_id', id).single();
  return { listing: data as Listing | null, error };
}

// Alias used by ListingDetail.tsx
export { getListing as getListingById };

export async function getCreatorListings(userId: string) {
  const { data, error } = await supabase.from('listings').select('*').eq('owner_id', userId).order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
}

export async function uploadListingImage(file: File, listingId: string) {
  const fileName = `listings/${listingId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from('listing-images').upload(fileName, file);
  if (uploadError) return { url: null, error: uploadError };
  const { data: urlData } = supabase.storage.from('listing-images').getPublicUrl(fileName);
  return { url: urlData.publicUrl, error: null };
}

export async function uploadListingVideo(file: File, listingId: string) {
  // Validate file type
  const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
  if (!validTypes.includes(file.type)) {
    return { url: null, error: { message: 'Only MP4, MOV, and WebM videos are allowed' } as any };
  }
  // Validate file size (50MB max)
  if (file.size > 50 * 1024 * 1024) {
    return { url: null, error: { message: 'Video must be under 50MB' } as any };
  }

  const fileName = `listings/${listingId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from('listing-videos')
    .upload(fileName, file, { contentType: file.type });

  if (uploadError) {
    if (uploadError.message?.includes('bucket')) {
      return { url: null, error: { message: 'Video storage not configured. Run the SQL migration.' } as any };
    }
    return { url: null, error: uploadError };
  }

  const { data: urlData } = supabase.storage.from('listing-videos').getPublicUrl(fileName);
  return { url: urlData.publicUrl, error: null };
}

export async function deleteListing(listingId: string) {
  const { error } = await supabase.from('listings').delete().eq('listing_id', listingId);
  return { error };
}

// ─── SAVED LISTINGS ────────────────────────────────

export async function saveListing(userId: string, listingId: string) {
  const { error } = await supabase.from('saved_listings').insert({ user_id: userId, listing_id: listingId });
  return { error };
}

export async function unsaveListing(userId: string, listingId: string) {
  const { error } = await supabase.from('saved_listings').delete().eq('user_id', userId).eq('listing_id', listingId);
  return { error };
}

export async function getSavedListings(userId: string) {
  const { data, error } = await supabase.from('saved_listings').select('listing_id').eq('user_id', userId);
  return { saved: data || [], savedIds: (data || []).map((r: any) => r.listing_id) as string[], error };
}

// ─── LISTING CREATION ──────────────────────────────

export async function createListing(listing: Omit<Listing, 'id' | 'listing_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.from('listings').insert({
    ...listing,
    listing_id: crypto.randomUUID(),
  }).select().single();
  return { listing: data as Listing | null, error };
}

// ─── PASSWORD CHANGE ───────────────────────────────

export async function changePassword(currentPassword: string, newPassword: string, email: string) {
  // Step 1: Verify current password by re-authenticating
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signInError) {
    return { error: { message: 'Current password is incorrect' } };
  }

  // Step 2: Update password
  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (updateError) {
    return { error: { message: updateError.message || 'Failed to update password' } };
  }

  return { error: null };
}

export async function logPasswordChange(userId: string, authId: string) {
  const { device, os, browser } = parseDeviceInfo();
  const { error } = await supabase.from('user_activity').insert({
    user_id: userId,
    auth_id: authId,
    action_type: 'password_change',
    details: { device, os, browser, source: 'security_settings' },
  });
  return { error };
}

// ─── ROOMMATE HELPERS ──────────────────────────────

export async function saveRoommatePreferences(prefs: Partial<RoommatePreferences>) {
  const { data, error } = await supabase
    .from('roommate_preferences')
    .upsert(
      { ...prefs, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select()
    .single();
  return { prefs: data as RoommatePreferences | null, error };
}

export async function getRoommatePreferences(userId: string) {
  const { data, error } = await supabase.from('roommate_preferences').select('*').eq('user_id', userId).maybeSingle();
  return { prefs: data as RoommatePreferences | null, error };
}

export async function findMatches(userId: string) {
  const { data, error } = await supabase.rpc('find_roommate_matches', { p_user_id: userId });
  return { matches: data || [], error };
}

// ─── WORKER HELPERS ────────────────────────────────

export async function getWorkers(filters?: { city?: string; occupation?: string; status?: string }) {
  let query = supabase.from('profiles').select('*').eq('role', 'worker');
  if (filters?.city) query = query.eq('city', filters.city);
  if (filters?.occupation) query = query.eq('worker_occupation', filters.occupation);
  if (filters?.status) query = query.eq('worker_status', filters.status);
  else query = query.eq('worker_status', 'verified'); // default: only verified
  const { data, error } = await query.order('created_at', { ascending: false });
  return { workers: data as Profile[] | null, error };
}

// Parse worker status from profile — checks bio marker FIRST (source of truth), falls back to column
export function parseWorkerStatus(profile: Profile): string {
  // Bio marker is the source of truth — we always write here
  const match = profile.bio?.match(/🛠️STATUS:(\w+)🛠️/);
  if (match) return match[1];
  // Fallback to column (for pre-existing data)
  if (profile.worker_status) return profile.worker_status;
  return 'pending';
}

export async function getAllWorkers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'worker')
    .order('created_at', { ascending: false });
  return { workers: data as Profile[] | null, error };
}

export async function getPendingWorkers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'worker')
    .eq('worker_status', 'pending')
    .order('created_at', { ascending: false });
  return { workers: data as Profile[] | null, error };
}

export async function updateWorkerStatus(userId: string, status: 'pending' | 'verified' | 'suspended' | 'rejected') {
  // Strategy: Update bio marker (always works) + try column (best effort)
  // Bio marker is the SOURCE OF TRUTH — parseWorkerStatus reads it first

  // 1. Read current bio
  const { data: row } = await supabase
    .from('profiles')
    .select('bio')
    .eq('user_id', userId)
    .maybeSingle();

  const bio = row?.bio || '';
  const cleanBio = bio.replace(/🛠️STATUS:\w+🛠️/g, '').trim();
  const newBio = `🛠️STATUS:${status}🛠️ ${cleanBio}`.trim();

  // 2. Update bio (this column always exists) — this is the PRIMARY write
  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ bio: newBio })
    .eq('user_id', userId)
    .select();

  // Verify rows were actually updated
  if (!error && (!updated || updated.length === 0)) {
    return { error: { message: `Update succeeded but 0 rows changed for user ${userId}` } as any };
  }

  // 3. Also update the proper columns (best effort, may fail if columns don't exist)
  if (!error) {
    try {
      await supabase
        .from('profiles')
        .update({ worker_status: status, worker_verified: status === 'verified', updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    } catch { /* columns may not exist, bio is the source of truth */ }
  }

  return { error };
}

// ─── CHAT HELPERS ──────────────────────────────────

export async function getConversations(userId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
    .order('updated_at', { ascending: false });
  return { conversations: data as Conversation[] | null, error };
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

export async function createConversation(userA: string, userB: string) {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ participant_a: userA, participant_b: userB })
    .select()
    .single();
  return { conversation: data as Conversation | null, error };
}

// ─── PERSONAL ACTIVITY ─────────────────────────────

export interface UserActivityItem {
  id: string;
  user_id: string;
  auth_id: string;
  action_type: string;
  details: Record<string, any>;
  created_at: string;
}

export async function getUserActivity(userId: string, limit: number = 30) {
  const { data, error } = await supabase
    .from('user_activity')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { activity: data as UserActivityItem[] | null, error };
}

export async function getUserMatches(userId: string) {
  // Get roommate matches involving the user
  const { data, error } = await supabase
    .from('roommate_matches')
    .select('*, user_a:profiles!user_a_id(username, city, state), user_b:profiles!user_b_id(username, city, state)')
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(20);
  return { matches: data || [], error };
}

export async function getUserRoomInterests(userId: string) {
  // Get room interests where user is sender or receiver
  const { data, error } = await supabase
    .from('room_interests')
    .select('*')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(20);
  return { interests: data as RoomInterest[] | null, error };
}

export async function getSavedListingsWithData(userId: string) {
  const { data, error } = await supabase
    .from('saved_listings')
    .select('*, listing:listings(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  return { saved: data || [], error };
}

// ─── REVIEWS ───────────────────────────────────────

export async function getReviews(targetId: string) {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('target_id', targetId)
    .order('created_at', { ascending: false });
  return { reviews: data as Review[] | null, error };
}

export async function createReview(reviewerId: string, targetId: string, rating: number, content: string) {
  const { data, error } = await supabase
    .from('reviews')
    .insert({ reviewer_id: reviewerId, target_id: targetId, rating, content })
    .select()
    .single();
  return { review: data as Review | null, error };
}

// ─── ROOM INTERESTS ────────────────────────────────

export async function getRoomInterests(listingId: string) {
  const { data, error } = await supabase
    .from('room_interests')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false });
  return { interests: data as RoomInterest[] | null, error };
}

export async function createRoomInterest(userId: string, listingId: string, message?: string) {
  const { data, error } = await supabase
    .from('room_interests')
    .insert({ user_id: userId, listing_id: listingId, message })
    .select()
    .single();
  return { interest: data as RoomInterest | null, error };
}

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

export async function getUserCount() {
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('deleted', false);
  const { count: today } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('deleted', false)
    .gte('created_at', new Date(Date.now() - 86400000).toISOString());
  return { total: count || 0, today: today || 0, error };
}

// ── ROLE MANAGEMENT ────────────────────────────────

// Valid role transitions (bidirectional):
// user ↔ staff, user ↔ admin, staff ↔ admin
// worker is locked (must sign up as worker)
// creator is locked (only one creator)
const VALID_ROLE_TRANSITIONS: Record<string, string[]> = {
  user: ['staff', 'admin'],
  staff: ['user', 'admin'],
  admin: ['user', 'staff'],
  worker: [],
  creator: [],
};

export function canChangeRole(currentRole: string, newRole: string): { allowed: boolean; reason?: string } {
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

export async function getAllListingsAdmin() {
  const { data, error } = await supabase.from('listings').select('*').order('created_at', { ascending: false });
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
    status: 'pending',
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
// Reads with fallback defaults if table doesn't exist
const DEFAULT_SETTINGS: Record<string, string> = {
  platform_name: 'WeHouse',
  listing_approval_required: 'false',
  default_user_role: 'user',
  maintenance_mode: 'false',
  registration_open: 'true',
  max_listings_per_user: '5',
};

export async function getSystemSettings() {
  const { data, error } = await supabase.from('platform_settings').select('*');
  // Merge DB values with defaults (DB wins if exists)
  const merged: SystemSetting[] = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => {
    const dbRow = data?.find((d: any) => d.key === key);
    return {
      id: dbRow?.id || key,
      key,
      value: dbRow?.value ?? value,
      updated_by: dbRow?.updated_by || null,
      updated_at: dbRow?.updated_at || new Date().toISOString(),
    };
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

// ─── NOTIFICATIONS ─────────────────────────────────

export async function getNotifications(userId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { notifications: data as Notification[] | null, error };
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', notificationId);
  return { error };
}

export async function createNotification(userId: string, title: string, body: string, type: string = 'general') {
  const { error } = await supabase.from('notifications').insert({ user_id: userId, title, body, type });
  return { error };
}


// ─── LISTING STATUS ───────────────────────────────

export async function updateListingStatus(listingId: string, status: string, updates?: Record<string, any>) {
  const payload = { status, ...updates, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('listings').update(payload).eq('listing_id', listingId);
  return { error };
}

// ─── ENQUIRIES ────────────────────────────────────

export async function createEnquiry(listingId: string, userId: string, message: string) {
  const { data, error } = await supabase.from('enquiries').insert({
    listing_id: listingId,
    user_id: userId,
    message,
    status: 'pending',
  }).select();
  return { enquiry: data?.[0] || null, error };
}

export async function getEnquiriesForListing(listingId: string) {
  const { data, error } = await supabase
    .from('enquiries')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false });
  return { enquiries: data as any[] | null, error };
}

export async function getEnquiriesForUser(userId: string) {
  const { data, error } = await supabase
    .from('enquiries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { enquiries: data as any[] | null, error };
}

export async function replyToEnquiry(enquiryId: string, staffId: string, reply: string) {
  const { error } = await supabase.from('enquiries').update({
    reply,
    staff_id: staffId,
    status: 'replied',
    replied_at: new Date().toISOString(),
  }).eq('id', enquiryId);
  return { error };
}

// ─── RESERVATIONS ─────────────────────────────────

// ─── MANUAL RESERVATION (MVP — no Paystack) ──────

export async function createReservation(
  listingId: string,
  userId: string,
  listingSnapshot?: { title: string; price: number; location: string }
) {
  // Check if already has pending/paid reservation for this listing
  const { data: existing } = await supabase
    .from('reservations')
    .select('*')
    .eq('listing_id', listingId)
    .eq('user_id', userId)
    .in('status', ['pending', 'paid', 'inspection_scheduled'])
    .maybeSingle();

  if (existing) {
    return { reservation: existing as any, error: null, alreadyExists: true };
  }

  // Get user profile for contact info
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, phone')
    .eq('user_id', userId)
    .maybeSingle();

  const { data, error } = await supabase.from('reservations').insert({
    listing_id: listingId,
    user_id: userId,
    user_email: profile?.email || '',
    user_phone: profile?.phone || '',
    listing_title: listingSnapshot?.title || '',
    listing_price: listingSnapshot?.price || 0,
    listing_location: listingSnapshot?.location || '',
    status: 'pending',
    manual_payment_status: 'unpaid',
    amount: 10000,
    currency: 'NGN',
    support_phone: '+2348000000000',
  }).select();

  return { reservation: data?.[0] as any || null, error, alreadyExists: false };
}

export async function getReservationForListing(listingId: string, userId: string) {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('listing_id', listingId)
    .eq('user_id', userId)
    .in('status', ['pending', 'paid', 'inspection_scheduled'])
    .maybeSingle();
  return { reservation: data as any, error };
}

export async function getReservationsForUser(userId: string) {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { reservations: data as any[] | null, error };
}

export async function cancelReservation(reservationId: string) {
  const { error } = await supabase
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('id', reservationId);
  return { error };
}

export async function markSupportContacted(reservationId: string) {
  const { error } = await supabase
    .from('reservations')
    .update({ support_contacted: true, updated_at: new Date().toISOString() })
    .eq('id', reservationId);
  return { error };
}
