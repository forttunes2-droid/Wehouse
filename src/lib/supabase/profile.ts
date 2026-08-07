import { supabase } from './client';
import type { Profile } from '@/types';
import { compressImageFile } from './utils';

export type SafeProfileUpdates = Pick<Partial<Profile>,
  | 'username' | 'full_name' | 'avatar_url' | 'bio' | 'phone' | 'occupation'
  | 'gender' | 'is_student' | 'school' | 'state' | 'local_government'
  | 'city' | 'area' | 'profile_complete'
>;

export type SafePrivacyUpdates = Pick<Partial<Profile>,
  | 'privacy_profile_visible' | 'privacy_search_visible' | 'privacy_activity_visible'
  | 'privacy_email_visible' | 'privacy_phone_visible'
>;

export async function getProfile(userId: string) {
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  return { profile: data as Profile | null, error };
}

export async function getProfileByAuthId(authId: string, _email?: string) {
  const { data, error } = await supabase.from('profiles').select('*').eq('auth_id', authId).maybeSingle();
  return { profile: data as Profile | null, error };
}

export async function getPublicAgentInfo(authId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, avatar_url, role')
    .eq('auth_id', authId)
    .maybeSingle();
  return { agent: data as { user_id: string; username: string | null; avatar_url: string | null; role: string } | null, error };
}

// Phone is returned only when the profile explicitly allows phone visibility.
export async function getPublicAgentByUserId(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, avatar_url, role, phone, privacy_phone_visible')
    .eq('user_id', userId)
    .maybeSingle();
  const agent = data ? {
    user_id: data.user_id,
    username: data.username,
    avatar_url: data.avatar_url,
    role: data.role,
    phone: data.privacy_phone_visible ? data.phone : null,
  } : null;
  return { agent, error };
}

export async function getProfileByEmail(email: string) {
  const { data, error } = await supabase.from('profiles').select('*').eq('email', email).maybeSingle();
  return { profile: data as Profile | null, error };
}

// Browser-side account relinking is intentionally disabled. Identity repair must
// happen through an audited server-side support workflow.
export async function linkProfileToAuth(_userId: string, _authId: string) {
  return {
    profile: null as Profile | null,
    error: { message: 'This account needs secure identity repair. Contact WeHouse Support.' } as any,
  };
}

export async function createProfile(authId: string, email: string, role?: 'user' | 'worker' | 'property_partner'): Promise<{ profile: Profile | null; error: any }>;
export async function createProfile(userId: string, email: string, username: string, authId: string): Promise<{ profile: Profile | null; error: any }>;
export async function createProfile(a: string, b: string, c?: string, d?: string) {
  const isLegacyDirectCall = c !== undefined && d !== undefined;
  const email = b;
  const role: 'user' | 'worker' | 'property_partner' = !isLegacyDirectCall && c ? c as any : 'user';

  const { data, error } = await supabase.rpc('create_my_profile', {
    p_email: email,
    p_role: role,
  });
  if (error || !data) return { profile: null, error };

  let profile = data as Profile;
  if (isLegacyDirectCall && c) {
    const { profile: updated, error: updateError } = await updateProfile(profile.user_id, { username: c });
    if (updateError) return { profile: null, error: updateError };
    profile = updated || profile;
  }
  return { profile, error: null };
}

export async function uploadAvatar(file: File, _userId: string) {
  if (!file.type.startsWith('image/')) return { url: null, error: { message: 'Please select an image (JPG, PNG)' } as any };
  if (file.size > 5 * 1024 * 1024) return { url: null, error: { message: 'Image must be under 5MB' } as any };

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { url: null, error: { message: 'Authentication required' } as any };

    const compressed = await compressImageFile(file, 600, 0.85);
    const fileName = `${user.id}/avatar-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, compressed, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) return { url: null, error: uploadError };

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
    return { url: urlData.publicUrl, error: null };
  } catch (err: any) {
    return { url: null, error: { message: err.message || 'Upload failed' } };
  }
}

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
  const { data } = await supabase.from('profiles').select('user_id').eq('username', trimmed).maybeSingle();
  const available = !data || (currentUserId && data.user_id === currentUserId);
  return { available, taken: !available };
}

export async function removeAvatar(_userId: string) {
  const { data, error } = await supabase.rpc('update_my_profile', { p_updates: { avatar_url: null } });
  return { profile: data as Profile | null, error };
}

export async function updateProfile(_userId: string, updates: SafeProfileUpdates) {
  const normalized: Record<string, unknown> = { ...updates };
  if ('city' in normalized && !('local_government' in normalized)) {
    normalized.local_government = normalized.city;
  }
  const { data, error } = await supabase.rpc('update_my_profile', { p_updates: normalized });
  return { profile: data as Profile | null, error };
}

export async function updatePrivacySettings(_userId: string, settings: SafePrivacyUpdates) {
  const { data, error } = await supabase.rpc('update_my_privacy', { p_updates: settings });
  return { profile: data as Profile | null, error };
}
