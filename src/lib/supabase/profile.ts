import { supabase } from './client';
import type { Profile } from '@/types';
import { compressImageFile } from './utils';

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
    .maybeSingle();
  return { profile: data as Profile | null, error };
}

// createProfile — unified signup for all external users
//   createProfile(authId, email, role?)   — called from useAuth.ts (role = user/worker/property_owner)
//   createProfile(userId, email, username, authId)  — direct calls
export async function createProfile(authId: string, email: string, role?: 'user' | 'worker' | 'property_owner'): Promise<{ profile: Profile | null; error: any }>;
export async function createProfile(userId: string, email: string, username: string, authId: string): Promise<{ profile: Profile | null; error: any }>;
export async function createProfile(a: string, b: string, c?: string, d?: string) {
  // Determine which signature was used
  const isDirectCall = c !== undefined && d !== undefined;
  const authId = isDirectCall ? d! : a;
  const email = b;
  const userId = isDirectCall ? a : `WHU-${(Date.now() % 9000) + 1000}`;
  const username = isDirectCall ? c : email.split('@')[0].replace(/[^a-z0-9_]/g, '') + Math.floor(Math.random() * 1000);
  // Role: direct calls default to 'user', useAuth passes the chosen role
  const role: 'user' | 'worker' | 'property_owner' = !isDirectCall && c ? c as any : 'user';
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      user_id: userId,
      email,
      username,
      auth_id: authId,
      role,
      worker_status: role === 'worker' ? 'pending' : null,
      profile_complete: false,
    })
    .select()
    .maybeSingle();
  return { profile: data as Profile | null, error };
}

// ─── AVATAR UPLOAD ─────────────────────────────────

export async function uploadAvatar(file: File, userId: string) {
  if (!file.type.startsWith('image/')) return { url: null, error: { message: 'Please select an image (JPG, PNG)' } as any };
  if (file.size > 5 * 1024 * 1024) return { url: null, error: { message: 'Image must be under 5MB' } as any };

  try {
    const compressed = await compressImageFile(file, 600, 0.85);
    const fileName = `avatars/${userId}-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, compressed, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) {
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
    .maybeSingle();
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
    .maybeSingle();
  return { profile: data as Profile | null, error };
}
