import { createClient } from '@supabase/supabase-js';
import type { Profile } from '@/types';

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

export async function getNextUserId() {
  // Get the highest existing user_id number
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return 'WHU-0001';
  }

  // Extract number from WHU-XXXX format
  const match = data[0].user_id.match(/WHU-(\d+)/);
  const lastNum = match ? parseInt(match[1], 10) : 0;
  const nextNum = lastNum + 1;
  return `WHU-${nextNum.toString().padStart(4, '0')}`;
}

export async function createProfile(authId: string, email: string) {
  const userId = await getNextUserId();

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

  return { profile: data as Profile | null, error };
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
