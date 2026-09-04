import { supabase } from './client';
import { parseDeviceInfo } from './session';

// ─── AUTH HELPERS ──────────────────────────────────

type PublicSignupRole = 'user' | 'worker' | 'property_partner';

export async function signUpWithEmail(email: string, password: string, role: PublicSignupRole = 'user') {
  const safeRole: PublicSignupRole = ['user','worker','property_partner'].includes(role) ? role : 'user';
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/`,
      data: { source: 'wehouse', signup_role: safeRole },
    },
  });
  return { data, error };
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signInWithGoogle() {
  const redirectUrl = `${window.location.origin}/`;
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectUrl, queryParams: { prompt: 'select_account' } },
  });
}

export async function getSession() {
  return supabase.auth.getSession();
}

// ─── SETUP HELPERS ──────────────────────────────────

export async function isUsernameTaken(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_username_available', { p_username: username.trim().toLowerCase() });
  if (error) return false;
  return data !== true;
}

export async function updateUsername(userId: string, username: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ username, profile_complete: true })
    .eq('user_id', userId);
  return { error };
}

// ─── PASSWORD CHANGE ───────────────────────────────

export async function changePassword(currentPassword: string, newPassword: string, email: string) {
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signInError) {
    return { error: { message: 'Current password is incorrect' } };
  }

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
