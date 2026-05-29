import { createClient } from '@supabase/supabase-js';
import type { Profile, Listing, RoommatePreferences, AdminAuditLog, SystemSetting, Notification, Conversation, Message, Review, RoomInterest, Announcement, AnnouncementTargetType, Hotel, HotelRoom, HotelBooking, HotelReview } from '@/types';
import { ROLE_RANK } from '@/types';

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

// Public agent info — only safe fields exposed to users viewing a listing
// NEVER returns email, phone, or other sensitive data
export async function getPublicAgentInfo(authId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, avatar_url, role')
    .eq('auth_id', authId)
    .maybeSingle();
  return {
    agent: data as { user_id: string; username: string | null; avatar_url: string | null; role: string } | null,
    error,
  };
}

// Same as above but lookup by user_id (for chat_agent_id field on listings)
// Includes phone so users can call the agent directly
export async function getPublicAgentByUserId(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, avatar_url, role, phone')
    .eq('user_id', userId)
    .maybeSingle();
  return {
    agent: data as { user_id: string; username: string | null; avatar_url: string | null; role: string; phone: string | null } | null,
    error,
  };
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

export async function removeAvatar(userId: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return { error };
}

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

// ─── SINGLE-DEVICE SESSION MANAGEMENT ──────────────
// When user logs in on a new device, old device gets logged out

const SESSION_STORAGE_KEY = 'wh_session_id';

export async function createUserSession(userId: string, authId: string): Promise<string | null> {
  const { device, os, browser } = parseDeviceInfo();
  const { data, error } = await supabase
    .from('user_sessions')
    .insert({
      user_id: userId,
      auth_id: authId,
      device,
      os,
      browser,
      is_active: true,
      is_current: true,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[Session] Failed to create session:', error?.message);
    return null;
  }

  localStorage.setItem(SESSION_STORAGE_KEY, data.id);
  return data.id;
}

export async function deactivateUserSession(sessionId: string) {
  await supabase
    .from('user_sessions')
    .update({ is_active: false, is_current: false, logout_time: new Date().toISOString() })
    .eq('id', sessionId);
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export async function isSessionActive(sessionId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_sessions')
    .select('is_active')
    .eq('id', sessionId)
    .maybeSingle();
  return data?.is_active === true;
}

export function getStoredSessionId(): string | null {
  try { return localStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
}

export async function updateSessionLastSeen(sessionId: string) {
  await supabase
    .from('user_sessions')
    .update({ last_seen: new Date().toISOString() })
    .eq('id', sessionId);
}

// ─── LISTING HELPERS ───────────────────────────────

export async function getAllListings() {
  // Users only see available and reserved listings. Closed listings are hidden.
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .in('availability_status', ['available', 'reserved'])
    .order('created_at', { ascending: false });
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

// Alias: get listings by owner (used by StaffDashboard)
export { getCreatorListings as getListingsByOwner };

// Get staff/admin users available to be assigned as chat agents for a listing
// Hierarchy:
//   Admin: can appoint staff
//   Assistant State Admin: can appoint admin, staff, or themselves
//   State Admin: can appoint staff, admin, assistant_state_admin, or themselves
//   Creator: can appoint anyone (staff, admin, assistant_state_admin, state_admin)
// Get all active staff who can be assigned as chat agents.
// Staff matching the listing's location appear FIRST, then others follow.
// Uses assigned_state/lga with fallback to state/city for location matching.
export async function getAvailableChatAgents(listingState?: string, listingLga?: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, avatar_url, role, assigned_state, assigned_lga, state, city')
    .in('role', ['staff', 'admin', 'assistant_state_admin'])
    .eq('deleted', false)
    .order('username', { ascending: true });

  let agents = (data || []) as Array<{
    user_id: string; username: string | null; avatar_url: string | null; role: string;
    assigned_state: string | null; assigned_lga: string | null; state: string | null; city: string | null;
  }>;

  // Normalize listing location for comparison
  const normState = (listingState || '').trim().toLowerCase();
  const normLga = (listingLga || '').trim().toLowerCase();

  // Sort: staff matching listing location first, then others
  if (normState && agents.length > 1) {
    agents.sort((a, b) => {
      // Use assigned_* with fallback to state/city
      const aState = ((a.assigned_state || a.state) || '').trim().toLowerCase();
      const bState = ((b.assigned_state || b.state) || '').trim().toLowerCase();
      const aLga = ((a.assigned_lga || a.city) || '').trim().toLowerCase();
      const bLga = ((b.assigned_lga || b.city) || '').trim().toLowerCase();

      // Check if state matches (handles "Abuja (FCT)" vs "Abuja")
      const aMatchesState = aState === normState || aState.includes(normState) || normState.includes(aState);
      const bMatchesState = bState === normState || bState.includes(normState) || normState.includes(bState);

      // Check if LGA/city matches
      const aMatchesLga = normLga ? (aLga === normLga || aLga.includes(normLga) || normLga.includes(aLga)) : aMatchesState;
      const bMatchesLga = normLga ? (bLga === normLga || bLga.includes(normLga) || normLga.includes(bLga)) : bMatchesState;

      // Perfect match (state + lga) comes first
      if (aMatchesLga && !bMatchesLga) return -1;
      if (!aMatchesLga && bMatchesLga) return 1;

      // State match comes next
      if (aMatchesState && !bMatchesState) return -1;
      if (!aMatchesState && bMatchesState) return 1;

      // Alphabetical for same tier
      return (a.username || '').localeCompare(b.username || '');
    });
  }

  return { agents: agents.length > 0 ? agents : null, error };
}

// Check for duplicate listings — practical for Nigerian context (no house numbers)
// Uses: title similarity in same area + 30-day cooldown for same user
// Call the Supabase Edge Function to detect duplicate images
// Returns: { isDuplicate, isSuspicious, similarity, matches: [...] }
export async function detectDuplicateImage(imageUrl: string, listingId?: string, ownerId?: string) {
  const { data, error } = await supabase.functions.invoke('detect-duplicate-images', {
    body: { imageUrl, listingId, ownerId },
  });
  return { result: data, error };
}

export async function checkDuplicateListing(title: string, _area: string, city: string, state: string, posterAuthId?: string) {
  const normTitle = title.trim().toLowerCase().replace(/\s+/g, ' ');

  // Skip duplicate check for very short/generic titles — too many false positives
  if (normTitle.length < 6) {
    return { titleMatch: false, recentPost: null };
  }

  // 1. Fetch existing listings in same city (not hidden)
  // If area is provided, also filter by area for more precise matching
  let query = supabase
    .from('listings')
    .select('id, title, city, state, address, owner_id, created_at, images')
    .eq('city', city)
    .eq('state', state)
    .not('availability_status', 'eq', 'hidden');

  const { data: existing } = await query.limit(50);

  // 2. Check title similarity — ADAPTIVE threshold based on title length
  // Short titles (< 15 chars): need 95%+ match to flag (avoids "clean room" vs "nice room")
  // Medium titles (15-30 chars): need 88%+ match
  // Long titles (> 30 chars): need 82%+ match
  const THRESHOLD = normTitle.length < 15 ? 0.95 : normTitle.length < 30 ? 0.88 : 0.82;

  let titleMatch = false;
  for (const listing of (existing || [])) {
    if (!listing.title) continue;
    // Skip comparing against the same user's own listings
    if (posterAuthId && listing.owner_id === posterAuthId) continue;
    const existingTitle = listing.title.trim().toLowerCase().replace(/\s+/g, ' ');
    const similarity = calculateSimilarity(normTitle, existingTitle);
    if (similarity >= THRESHOLD) {
      titleMatch = true;
      break;
    }
  }

  // 3. Same-user cooldown: same poster, same city, within last 30 days
  let recentPost = null;
  if (posterAuthId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('listings')
      .select('id, created_at')
      .eq('owner_id', posterAuthId)
      .eq('city', city)
      .gte('created_at', thirtyDaysAgo)
      .limit(1)
      .maybeSingle();
    recentPost = recent;
  }

  return {
    titleMatch,
    recentPost,
  };
}

// Levenshtein distance — measures how similar two strings are
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
    }
  }

  const maxLen = Math.max(a.length, b.length);
  return 1 - matrix[b.length][a.length] / maxLen;
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

// ═══════════════════════════════════════════════════════════
// LISTING APPROVAL SYSTEM
// ═══════════════════════════════════════════════════════════

// Returns the minimum role rank required to approve a listing based on who posted it
export function getRequiredApproverRank(posterRole: string): number {
  switch (posterRole) {
    case 'staff': return ROLE_RANK.admin;        // needs Head of Staff+
    case 'admin': return ROLE_RANK.assistant_state_admin; // needs Asst Admin+
    case 'assistant_state_admin': return ROLE_RANK.state_admin; // needs Admin+
    case 'state_admin': return ROLE_RANK.director; // needs Director+
    case 'director': return ROLE_RANK.creator;    // needs Creator
    default: return ROLE_RANK.creator;
  }
}

// Returns human-readable approver label
export function getApproverLabel(posterRole: string): string {
  switch (posterRole) {
    case 'staff': return 'Head of Staff, Assistant Admin, Admin, or Creator';
    case 'admin': return 'Assistant Admin, Admin, or Creator';
    case 'assistant_state_admin': return 'Admin or Creator';
    case 'state_admin': return 'Director or Creator';
    case 'director': return 'Creator only';
    default: return 'Creator';
  }
}

// Check if a user with given role can approve a listing posted by someone with posterRole
export function canApproveListing(userRole: string, posterRole: string): boolean {
  return ROLE_RANK[userRole as keyof typeof ROLE_RANK] >= getRequiredApproverRank(posterRole);
}

// Get listings pending approval that this user can approve
export async function getListingsPendingApproval(userRole: string, _userId: string, scopeState?: string, scopeLga?: string) {
  // Build the query for listings with pending_approval status
  let query = supabase
    .from('listings')
    .select('*, profiles!owner_id(username, role)')
    .eq('status', 'pending_approval');

  // Filter by scope if provided
  if (scopeState) query = query.eq('state', scopeState);
  if (scopeLga) query = query.eq('city', scopeLga);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return { listings: [] as Listing[], error };

  // Filter to only show listings this user can approve
  const filtered = (data || []).filter((l: any) => {
    const posterRole = l.submitted_by_role || l.profiles?.role || 'staff';
    return canApproveListing(userRole, posterRole);
  });

  return { listings: filtered as Listing[], error: null };
}

// Approve a listing
export async function approveListing(listingId: string, approverId: string) {
  const { error } = await supabase
    .from('listings')
    .update({
      status: 'available',
      availability_status: 'available',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', listingId);
  return { error };
}

// Reject a listing
export async function rejectListing(listingId: string, approverId: string, reason: string) {
  const { error } = await supabase
    .from('listings')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', listingId);
  return { error };
}

// Get listings submitted by a user that are pending approval
export async function getMyPendingListings(userId: string) {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('owner_id', userId)
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: false });
  return { listings: data as Listing[] | null, error };
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

// 8-hour search window in milliseconds
const SEARCH_DURATION_MS = 8 * 60 * 60 * 1000;

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

// ─── BACKGROUND SEARCH SYSTEM ──────────────────────

// Start an 8-hour active search window
export async function startRoommateSearch(userId: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SEARCH_DURATION_MS);

  const { data, error } = await supabase
    .from('roommate_preferences')
    .update({
      search_status: 'active',
      search_started_at: now.toISOString(),
      search_expires_at: expiresAt.toISOString(),
      search_match_count: 0,
      updated_at: now.toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .single();

  return { prefs: data as RoommatePreferences | null, error };
}

// Stop an active search
export async function stopRoommateSearch(userId: string) {
  const { data, error } = await supabase
    .from('roommate_preferences')
    .update({
      search_status: 'stopped',
      search_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .single();

  return { prefs: data as RoommatePreferences | null, error };
}

// Refresh search — extends the 8-hour window and re-runs matching
export async function refreshRoommateSearch(userId: string) {
  // 1. Re-run the match algorithm
  const { matches: newMatches, error: matchError } = await findMatches(userId);
  if (matchError) return { matches: [], error: matchError };

  // 2. Get existing saved matches to avoid duplicates
  const { data: existing } = await supabase
    .from('roommate_search_results')
    .select('matched_user_id')
    .eq('searcher_id', userId);

  const existingIds = new Set((existing || []).map((m: any) => m.matched_user_id));

  // 3. Save only new matches
  const trulyNew = (newMatches || []).filter((m: any) => !existingIds.has(m.user_id));
  if (trulyNew.length > 0) {
    const rows = trulyNew.map((m: any) => ({
      searcher_id: userId,
      matched_user_id: m.user_id,
      match_score: m.match_score || 0,
      status: 'new',
    }));
    await supabase.from('roommate_search_results').insert(rows);
  }

  // 4. Update match count on preferences
  const { data: allSaved } = await supabase
    .from('roommate_search_results')
    .select('*', { count: 'exact', head: true })
    .eq('searcher_id', userId);

  await supabase
    .from('roommate_preferences')
    .update({ search_match_count: allSaved?.length || 0 })
    .eq('user_id', userId);

  return { matches: newMatches || [], error: null };
}

// Get saved match results (persisted across sessions)
export async function getSavedMatchResults(userId: string) {
  const { data, error } = await supabase
    .from('roommate_search_results')
    .select(`
      *,
      matched_profile:profiles!matched_user_id(username, gender, city, state, bio, school)
    `)
    .eq('searcher_id', userId)
    .order('match_score', { ascending: false });

  return { matches: data || [], error };
}

// Update a match status (viewed, accepted, declined)
export async function updateMatchStatus(matchId: string, status: 'new' | 'viewed' | 'accepted' | 'declined') {
  const { error } = await supabase
    .from('roommate_search_results')
    .update({ status })
    .eq('id', matchId);
  return { error };
}

// Clear all saved match results for a user
export async function clearMatchResults(userId: string) {
  const { error } = await supabase
    .from('roommate_search_results')
    .delete()
    .eq('searcher_id', userId);
  return { error };
}

// Check if search has expired — if so, update status
export async function checkSearchExpiry(userId: string): Promise<{ expired: boolean; prefs: RoommatePreferences | null }> {
  const { prefs } = await getRoommatePreferences(userId);
  if (!prefs) return { expired: false, prefs: null };

  // If already expired/stopped, return as-is
  if (prefs.search_status === 'expired' || prefs.search_status === 'stopped' || prefs.search_status === 'idle') {
    return { expired: prefs.search_status === 'expired', prefs };
  }

  // Check if the expiry time has passed
  if (prefs.search_expires_at && new Date(prefs.search_expires_at) < new Date()) {
    // Update to expired
    const { data } = await supabase
      .from('roommate_preferences')
      .update({ search_status: 'expired' })
      .eq('user_id', userId)
      .select()
      .single();
    return { expired: true, prefs: data as RoommatePreferences | null };
  }

  return { expired: false, prefs };
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

export async function createConversation(userA: string, userB: string, listingId?: string | null) {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ participant_a: userA, participant_b: userB, listing_id: listingId || null, status: 'pending' })
    .select()
    .single();
  return { conversation: data as Conversation | null, error };
}

// Accept an enquiry — unlocks full conversation
export async function acceptEnquiry(conversationId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'active' })
    .eq('id', conversationId)
    .select()
    .single();
  return { conversation: data as Conversation | null, error };
}

// Close a conversation
export async function closeConversation(conversationId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'closed' })
    .eq('id', conversationId)
    .select()
    .single();
  return { conversation: data as Conversation | null, error };
}

export async function getOrCreateConversation(userA: string, userB: string, listingId?: string | null) {
  // Build the filter: same participants (either direction) AND same listing
  let query = supabase
    .from('conversations')
    .select('*')
    .or(`and(participant_a.eq.${userA},participant_b.eq.${userB}),and(participant_a.eq.${userB},participant_b.eq.${userA})`);

  // If a listing_id is provided, match on it too
  if (listingId) {
    query = query.eq('listing_id', listingId);
  }

  const { data: existing } = await query.maybeSingle();

  if (existing) {
    return { conversation: existing as Conversation, error: null };
  }

  // Create new conversation with listing context
  return createConversation(userA, userB, listingId);
}

// ─── ANNOUNCEMENT SYSTEM v2 ────────────────────────

export async function checkAnnouncementTables() {
  try {
    const { error: msgErr } = await supabase.from('announcements').select('id').limit(1);
    const { error: recipErr } = await supabase.from('announcement_recipients').select('id').limit(1);
    const issues: string[] = [];
    if (msgErr && msgErr.message.includes('does not exist')) issues.push('announcements table missing');
    if (recipErr && recipErr.message.includes('does not exist')) issues.push('announcement_recipients table missing');
    return { ok: issues.length === 0 && !msgErr && !recipErr, issues, announcementsError: msgErr?.message || null, recipientsError: recipErr?.message || null };
  } catch (e: any) {
    return { ok: false, issues: ['Diagnostic failed'], announcementsError: e.message, recipientsError: null };
  }
}

export async function sendAnnouncement(
  senderId: string,
  senderRole: string,
  senderName: string,
  title: string,
  message: string,
  targetType: AnnouncementTargetType,
  options: { recipientIds?: string[]; scopeState?: string; scopeLga?: string } = {}
) {
  const { recipientIds, scopeState, scopeLga } = options;

  // Step 1: Insert the announcement
  const { data: announcement, error: insertErr } = await supabase
    .from('announcements')
    .insert({ title, message, created_by: senderId, sender_name: senderName, sender_role: senderRole, target_type: targetType, target_state: scopeState || null, target_lga: scopeLga || null })
    .select()
    .single();

  if (insertErr || !announcement) {
    console.error('[sendAnnouncement] insert failed:', insertErr);
    return { error: { message: `Insert failed: ${insertErr?.message || 'unknown'}` } };
  }

  // Step 2: Determine target users based on target_type
  let targetUserIds: string[] = [];

  if (targetType === 'specific_user' && recipientIds && recipientIds.length > 0) {
    targetUserIds = recipientIds;
  } else {
    // Build query based on target_type
    let query = supabase.from('profiles').select('user_id').eq('deleted', false);

    switch (targetType) {
      case 'all_workers':
        query = query.eq('role', 'worker');
        break;
      case 'verified_workers':
        query = query.eq('role', 'worker').eq('worker_verified', true);
        break;
      case 'admins':
        query = query.in('role', ['admin', 'state_admin', 'assistant_state_admin', 'creator']);
        break;
      case 'staff_only':
        query = query.eq('role', 'staff');
        break;
      case 'head_of_staff_only':
        query = query.eq('role', 'admin');
        break;
      case 'admin_only':
        query = query.eq('role', 'state_admin');
        break;
      case 'assistant_admin_only':
        query = query.eq('role', 'assistant_state_admin');
        break;
      case 'all_users':
      default:
        query = query.eq('role', 'user');
        break;
    }

    // Apply scope
    if (scopeState) query = query.eq('state', scopeState);
    if (scopeLga) query = query.eq('city', scopeLga);

    const { data: users, error: userErr } = await query;
    if (userErr) {
      console.error('[sendAnnouncement] fetch users failed:', userErr);
      return { error: { message: `Failed to fetch users: ${userErr.message}` } };
    }
    targetUserIds = (users || []).map((u: any) => u.user_id).filter((id: string) => id && id !== senderId);
  }

  if (targetUserIds.length === 0) {
    return { error: { message: 'No users match the selected target' } };
  }

  // Step 3: Insert recipient rows
  const rows = targetUserIds.map((uid) => ({ announcement_id: announcement.id, user_id: uid }));
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error: batchErr } = await supabase.from('announcement_recipients').insert(batch);
    if (batchErr) console.error(`[sendAnnouncement] batch ${i} failed:`, batchErr);
  }

  // Step 4: Update recipient_count
  await supabase.from('announcements').update({ recipient_count: rows.length }).eq('id', announcement.id);

  return { error: null, announcement: { ...announcement, recipient_count: rows.length } as Announcement, recipientCount: rows.length };
}

export async function getAnnouncementsForUser(userId: string) {
  try {
    // Join announcement_recipients with announcements
    const { data, error } = await supabase
      .from('announcement_recipients')
      .select('id, announcement_id, read_status, delivered_at, announcements(*)')
      .eq('user_id', userId)
      .order('delivered_at', { ascending: false });

    if (error) {
      if (error.message?.includes('does not exist')) return { messages: [], error: null };
      return { messages: [], error };
    }

    const messages = (data || []).map((row: any) => ({
      ...row,
      message: row.announcements,
    }));

    return { messages, error: null };
  } catch (e: any) {
    return { messages: [], error: null };
  }
}

export async function markAnnouncementRead(announcementId: number, userId: string) {
  // Update recipient row
  const { error: updateErr } = await supabase
    .from('announcement_recipients')
    .update({ read_status: true })
    .eq('announcement_id', announcementId)
    .eq('user_id', userId);

  // Update read count on announcement
  const { count } = await supabase
    .from('announcement_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('announcement_id', announcementId)
    .eq('read_status', true);

  await supabase.from('announcements').update({ read_count: count || 0 }).eq('id', announcementId);

  return { error: updateErr };
}

export async function deleteAnnouncement(announcementId: number) {
  const { error } = await supabase.from('announcements').delete().eq('id', announcementId);
  return { error };
}

export async function getAnnouncementsSentBy(senderId: string) {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('created_by', senderId)
    .order('created_at', { ascending: false });
  return { messages: data as Announcement[] | null, error };
}

export async function getAllAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });
  return { messages: data as Announcement[] | null, error };
}

export async function getUnreadAnnouncementCount(userId: string) {
  const { count, error } = await supabase
    .from('announcement_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read_status', false);
  return { count: count || 0, error };
}

export async function getAnnouncementStats(announcementId: number) {
  const { data: announcement, error } = await supabase
    .from('announcements')
    .select('recipient_count, read_count')
    .eq('id', announcementId)
    .single();
  return { stats: announcement || { recipient_count: 0, read_count: 0 }, error };
}

// Legacy aliases for backward compatibility
export const getOfficialMessagesForUser = getAnnouncementsForUser;
export const markOfficialMessageRead = (rowId: string) => markAnnouncementRead(Number(rowId), '');
export const deleteOfficialMessage = (id: string) => deleteAnnouncement(Number(id));
export const getOfficialMessagesSentBy = getAnnouncementsSentBy;
export const getAllOfficialMessages = getAllAnnouncements;
export const getUnreadOfficialCount = getUnreadAnnouncementCount;
export const checkOfficialMessageTables = checkAnnouncementTables;
export const getMessageRecipientCount = async (id: string | number) => {
  const { stats } = await getAnnouncementStats(Number(id));
  return { count: stats.recipient_count, error: null };
};
export const getFilteredRecipientCount = async (includeWorkers: boolean, includeStaff: boolean, scopeState?: string, scopeLga?: string) => {
  const allowedRoles: string[] = ['user'];
  if (includeWorkers) allowedRoles.push('worker');
  if (includeStaff) allowedRoles.push('staff', 'assistant_state_admin', 'admin');
  let query = supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('deleted', false).in('role', allowedRoles);
  if (scopeState) query = query.eq('state', scopeState);
  if (scopeLga) query = query.eq('city', scopeLga);
  const { count, error } = await query;
  return { count: count || 0, error };
};

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

// ═══════════════════════════════════════════════════════════
// HOTELS — Browse, Book, Manage
// ═══════════════════════════════════════════════════════════

// ── Browse Hotels ──────────────────────────────────────

export async function getHotels(filters?: {
  state?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  amenities?: string[];
  search?: string;
  featured?: boolean;
}) {
  let query = supabase
    .from('hotels')
    .select('*, hotel_rooms(room_id, price_per_night, room_type)')
    .eq('status', 'active');

  if (filters?.state) {
    query = query.ilike('state', `%${filters.state}%`);
  }
  if (filters?.city) {
    query = query.ilike('city', `%${filters.city}%`);
  }
  if (filters?.featured) {
    query = query.eq('featured', true);
  }
  if (filters?.search) {
    query = query.ilike('name', `%${filters.search}%`);
  }

  const { data, error } = await query.order('featured', { ascending: false }).order('created_at', { ascending: false });
  return { hotels: data as (Hotel & { hotel_rooms: { room_id: number; price_per_night: number; room_type: string }[] })[] | null, error };
}

export async function getHotelById(hotelId: number) {
  const { data, error } = await supabase
    .from('hotels')
    .select('*, hotel_rooms(*)')
    .eq('hotel_id', hotelId)
    .single();
  return { hotel: data as (Hotel & { hotel_rooms: HotelRoom[] }) | null, error };
}

export async function getHotelRooms(hotelId: number) {
  const { data, error } = await supabase
    .from('hotel_rooms')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('price_per_night', { ascending: true });
  return { rooms: data as HotelRoom[] | null, error };
}

export async function getRoomById(roomId: number) {
  const { data, error } = await supabase
    .from('hotel_rooms')
    .select('*, hotels(*)')
    .eq('room_id', roomId)
    .single();
  return { room: data as (HotelRoom & { hotels: Hotel }) | null, error };
}

// ── Reviews ────────────────────────────────────────────

export async function getHotelReviews(hotelId: number) {
  const { data, error } = await supabase
    .from('hotel_reviews')
    .select('*, profiles(username, avatar_url)')
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: false });
  return { reviews: data as (HotelReview & { profiles: { username: string | null; avatar_url: string | null } })[] | null, error };
}

export async function addHotelReview(hotelId: number, userId: string, rating: number, comment?: string) {
  const { data, error } = await supabase
    .from('hotel_reviews')
    .insert({ hotel_id: hotelId, user_id: userId, rating, comment: comment || null })
    .select()
    .single();
  // Update hotel average rating
  if (!error) {
    const { data: allReviews } = await supabase
      .from('hotel_reviews')
      .select('rating')
      .eq('hotel_id', hotelId);
    if (allReviews) {
      const avg = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
      await supabase.from('hotels').update({
        rating: Math.round(avg * 10) / 10,
        review_count: allReviews.length,
      }).eq('hotel_id', hotelId);
    }
  }
  return { review: data as HotelReview | null, error };
}

// ── Bookings ───────────────────────────────────────────

export async function createHotelBooking(booking: Omit<HotelBooking, 'booking_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('hotel_bookings')
    .insert(booking)
    .select()
    .single();
  return { booking: data as HotelBooking | null, error };
}

export async function getHotelBookingsForUser(userId: string) {
  const { data, error } = await supabase
    .from('hotel_bookings')
    .select('*, hotels(name, city, state, images), hotel_rooms(room_type, bed_type)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { bookings: data as (HotelBooking & { hotels: Hotel; hotel_rooms: HotelRoom })[] | null, error };
}

export async function getHotelBookingsForHotel(hotelId: number) {
  const { data, error } = await supabase
    .from('hotel_bookings')
    .select('*, profiles(username, phone), hotel_rooms(room_type)')
    .eq('hotel_id', hotelId)
    .order('check_in', { ascending: true });
  return { bookings: data as (HotelBooking & { profiles: { username: string | null; phone: string | null }; hotel_rooms: { room_type: string } })[] | null, error };
}

export async function updateBookingStatus(bookingId: number, status: HotelBooking['status']) {
  const { error } = await supabase
    .from('hotel_bookings')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('booking_id', bookingId);
  return { error };
}

// ── Hotel Owner Dashboard (CRUD) ───────────────────────

export async function getHotelsByOwner(ownerId: string) {
  const { data, error } = await supabase
    .from('hotels')
    .select('*, hotel_rooms(*)')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  return { hotels: data as (Hotel & { hotel_rooms: HotelRoom[] })[] | null, error };
}

export async function createHotel(hotel: Omit<Hotel, 'hotel_id' | 'rating' | 'review_count' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('hotels')
    .insert(hotel)
    .select()
    .single();
  return { hotel: data as Hotel | null, error };
}

export async function updateHotel(hotelId: number, updates: Partial<Hotel>) {
  const { data, error } = await supabase
    .from('hotels')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('hotel_id', hotelId)
    .select()
    .single();
  return { hotel: data as Hotel | null, error };
}

export async function deleteHotel(hotelId: number) {
  const { error } = await supabase.from('hotels').delete().eq('hotel_id', hotelId);
  return { error };
}

export async function createHotelRoom(room: Omit<HotelRoom, 'room_id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('hotel_rooms')
    .insert(room)
    .select()
    .single();
  return { room: data as HotelRoom | null, error };
}

export async function updateHotelRoom(roomId: number, updates: Partial<HotelRoom>) {
  const { data, error } = await supabase
    .from('hotel_rooms')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('room_id', roomId)
    .select()
    .single();
  return { room: data as HotelRoom | null, error };
}

export async function deleteHotelRoom(roomId: number) {
  const { error } = await supabase.from('hotel_rooms').delete().eq('room_id', roomId);
  return { error };
}

// ── Upload hotel images ────────────────────────────────

export async function uploadHotelImage(file: File, hotelId: number) {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `hotels/${hotelId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('listings').upload(path, file, { cacheControl: '3600' });
  if (uploadError) return { url: null, error: uploadError };
  const { data } = supabase.storage.from('listings').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

export async function uploadRoomImage(file: File, hotelId: number, roomId: number) {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `hotels/${hotelId}/rooms/${roomId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('listings').upload(path, file, { cacheControl: '3600' });
  if (uploadError) return { url: null, error: uploadError };
  const { data } = supabase.storage.from('listings').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}
// force deploy Fri May 29 09:06:48 CST 2026
// deploy trigger 1780037607
