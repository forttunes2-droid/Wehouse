import { withTimeout } from '@/lib/withTimeout';
import { supabase } from './client';
import { parseDeviceInfo } from './session';
import type { GoogleVerificationContext } from '@/lib/googleVerification';
import { verificationRedirectUrl } from '@/lib/googleVerification';
import { isNative } from '@/lib/native';
import { openNativeOAuth } from '@/lib/nativeOAuth';
import type { LegalChoices } from '@/lib/legalConsent';
import { hasLegalConsent } from '@/lib/legalConsent';
import { getCurrentLegalDocuments } from './legal';

// ─── AUTH HELPERS ──────────────────────────────────
// Public signup always creates one Personal identity. Service Worker and
// Property Partner are additive workspaces requested only after the Personal
// account exists; auth metadata is never an authority source for a workspace/role.
export async function signUpWithEmail(
  email: string,
  password: string,
  legacyInitialWorkspace: 'user' | 'worker' | 'property_partner' = 'user',
  legalChoices: LegalChoices = {},
) {
  // Keep the old call signature so stale clients compile, but deliberately do
  // not persist or trust their requested workspace during public signup.
  void legacyInitialWorkspace;
  const { documents, error: legalError } = await getCurrentLegalDocuments();
  if (legalError || !hasLegalConsent(documents, legalChoices)) {
    return { data: { user: null, session: null }, error: { message: legalError ? 'Signup requirements could not be checked. Please try again.' : 'Review each published legal document before creating an account.' } };
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: verificationRedirectUrl('signup'),
      data: { source: 'wehouse', legal_review: legalChoices },
    },
  });
  return { data, error };
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signInWithIdentifier(identifier: string, password: string) {
  const clean = identifier.trim().toLowerCase();
  if (clean.includes('@')) return signInWithEmail(clean, password);
  const result = await supabase.functions.invoke('login-with-identifier', {
    body: { identifier: clean, password },
  });
  if (result.error || !result.data?.access_token || !result.data?.refresh_token) {
    // FunctionsHttpError keeps a non-2xx response in context, not data. Preserve
    // a real server cooldown instead of telling a throttled person their
    // password is wrong. Do not trust arbitrary provider/transport prose.
    const response = result.error?.context;
    const throttled = response?.status === 429;
    return {
      data: { user: null, session: null },
      error: { message: throttled ? 'Too many sign-in attempts. Wait briefly and try again.' : result.data?.error || 'Invalid username, email or password' },
    };
  }
  return supabase.auth.setSession({
    access_token: String(result.data.access_token),
    refresh_token: String(result.data.refresh_token),
  });
}

export async function signInWithGoogle(verificationEmail?: string, context?: GoogleVerificationContext) {
  const redirectUrl = verificationRedirectUrl(context);
  const loginHint = verificationEmail?.trim().toLowerCase();
  const native = isNative();
  const result = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl,
      skipBrowserRedirect: native,
      queryParams: {
        prompt: 'select_account',
        ...(loginHint ? { login_hint: loginHint } : {}),
      },
    },
  });
  if (native && !result.error && result.data.url) await openNativeOAuth(result.data.url);
  return result;
}

export async function signInWithApple(context?: GoogleVerificationContext) {
  const native = isNative();
  const result = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: verificationRedirectUrl(context), skipBrowserRedirect: native },
  });
  if (native && !result.error && result.data.url) await openNativeOAuth(result.data.url);
  return result;
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
    current_password: currentPassword,
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

// Password accounts only. The password is checked first, then Supabase emails a confirmation link
// to the new address. The old address stays active until that link is opened.
export async function requestEmailChange(currentPassword: string, currentEmail: string, newEmail: string) {
  const clean = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { error: { message: 'Enter a valid email address' } };
  if (clean === currentEmail.trim().toLowerCase()) return { error: { message: 'That is already your email' } };
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: currentEmail, password: currentPassword });
  if (signInError) return { error: { message: 'Current password is incorrect' } };
  const { error } = await supabase.auth.updateUser({ email: clean }, { emailRedirectTo: `${window.location.origin}/` });
  return { error: error ? { message: error.message || 'Email could not be changed' } : null };
}

const EMAIL_CHANGE_KEY = 'wh_email_change';

// Main route. Google confirms the new address, the same way sign-up does. Any address works
// if it is a Google account (Gmail, Yahoo, Outlook, company mail).
export async function startEmailChangeWithGoogle(currentPassword: string, currentEmail: string, newEmail: string) {
  const clean = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { error: { message: 'Enter a valid email address' } };
  if (clean === currentEmail.trim().toLowerCase()) return { error: { message: 'That is already your email' } };
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: currentEmail, password: currentPassword });
  if (signInError) return { error: { message: 'Current password is incorrect' } };
  try { sessionStorage.setItem(EMAIL_CHANGE_KEY, JSON.stringify({ email: clean, at: Date.now() })); } catch { /* tab storage unavailable */ }
  const native = isNative();
  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/`, skipBrowserRedirect: native, queryParams: { prompt: 'select_account', login_hint: clean } },
  });
  if (error) {
    try { sessionStorage.removeItem(EMAIL_CHANGE_KEY); } catch { /* nothing to clean */ }
    return { error: { message: error.message || 'Google could not be started' } };
  }
  if (native && data?.url) await openNativeOAuth(data.url);
  return { error: null };
}

// Runs when the app reopens after Google. Returns the new email, or null if no change was pending.
export async function finishEmailChangeWithGoogle(): Promise<{ email: string | null; error: string | null }> {
  let pending: { email: string; at: number } | null = null;
  try { pending = JSON.parse(sessionStorage.getItem(EMAIL_CHANGE_KEY) || 'null'); } catch { pending = null; }
  if (!pending) return { email: null, error: null };
  if (typeof pending.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pending.email) || !Number.isFinite(pending.at) || pending.at > Date.now() || Date.now() - pending.at > 15 * 60 * 1000) {
    try { sessionStorage.removeItem(EMAIL_CHANGE_KEY); } catch { /* nothing to clean */ }
    return { email: null, error: 'The email change expired. Start again.' };
  }
  const { data, error } = await withTimeout(supabase.rpc('change_my_email_to_verified_identity', { p_new_email: pending.email }), 15000, 'Email change could not be confirmed. Refresh your account before retrying.');
  try { sessionStorage.removeItem(EMAIL_CHANGE_KEY); } catch { /* nothing to clean */ }
  if (error) return { email: null, error: error.message || 'Email could not be changed' };
  await withTimeout(supabase.auth.refreshSession(), 15000, 'Session refresh timed out').catch(() => undefined);
  if (typeof data !== 'string' || data.trim().toLowerCase() !== pending.email.trim().toLowerCase()) return { email: null, error: 'The updated email could not be confirmed. Refresh your account.' };
  return { email: data, error: null };
}
