import { supabase } from './client';
import { parseDeviceInfo } from './session';

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
