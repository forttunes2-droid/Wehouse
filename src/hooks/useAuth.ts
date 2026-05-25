import { useState, useEffect, useCallback } from 'react';
import { supabase, getProfile, getProfileByEmail, linkProfileToAuth, createProfile } from '@/lib/supabase';
import type { Profile, Page } from '@/types';

interface AuthState {
  page: Page;
  profile: Profile | null;
  isLoading: boolean;
  error: string;
}

const AUTH_STATE_KEY = 'wh_auth_page';

// ─── TIMEOUT WRAPPER ───────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ]);
}

// ─── FULL AUTH CLEANUP ─────────────────────────────
function wipeAllAuthData() {
  try {
    const keys: string[] = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    keys.forEach((k) => {
      if (k.includes('sb-') || k.includes('supabase') || k === AUTH_STATE_KEY) {
        localStorage.removeItem(k);
      }
    });
  } catch { /* ignore */ }
  try { sessionStorage.clear(); } catch { /* ignore */ }
}

// ─── SAFE SESSION CHECK ───────────────────────────
// Just reads from localStorage — no network call on init.
// Supabase autoRefreshToken handles token refresh in background.
async function safeGetSession(): Promise<{ user: { id: string } } | null> {
  try {
    // 10s timeout — generous for slow mobile
    const { data } = await withTimeout(supabase.auth.getSession(), 10000);
    if (!data?.session?.user) return null;
    return { user: { id: data.session.user.id } };
  } catch {
    return null;
  }
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    page: 'loading',
    profile: null,
    isLoading: true,
    error: '',
  });

  const determinePage = useCallback((profile: Profile | null): Page => {
    if (!profile) return 'login';
    if (!profile.profile_complete) return 'setup';
    if (profile.role === 'creator_admin') return 'creator';
    return 'dashboard';
  }, []);

  // ─── Load profile (with timeout) ──────────────────
  const loadProfile = useCallback(
    async (authId: string) => {
      try {
        const { profile, error } = await withTimeout(getProfile(authId), 8000);
        if (error || !profile) {
          setState({ page: 'login', profile: null, isLoading: false, error: '' });
          return;
        }
        setState({ profile, page: determinePage(profile), isLoading: false, error: '' });
      } catch {
        // Timeout on profile load
        setState({ page: 'login', profile: null, isLoading: false, error: 'Connection slow. Please try again.' });
      }
    },
    [determinePage]
  );

  // ─── Initialize on mount ──────────────────────────
  useEffect(() => {
    let mounted = true;
    let safetyTimer: ReturnType<typeof setTimeout>;

    async function init() {
      // MASTER SAFETY: if init takes >20s, force login page
      safetyTimer = setTimeout(() => {
        if (mounted) {
          setState({ page: 'login', profile: null, isLoading: false, error: '' });
        }
      }, 20000);

      // Small delay for StrictMode
      await new Promise((r) => setTimeout(r, 50));
      if (!mounted) return;

      // Check session (with internal timeouts)
      const result = await safeGetSession();
      if (!mounted) return;

      if (!result) {
        // No valid session
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        wipeAllAuthData();
        clearTimeout(safetyTimer);
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
        return;
      }

      // Valid session → load profile
      await loadProfile(result.user.id);
      clearTimeout(safetyTimer);
    }

    init();

    // Auth state listener
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_IN' && session?.user) {
        setState((s) => ({ ...s, isLoading: true }));
        await loadProfile(session.user.id);
      }

      if (event === 'SIGNED_OUT') {
        wipeAllAuthData();
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
      }
    });

    // Window focus: check session (with timeout)
    const onFocus = async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), 3000);
        if (!data?.session && mounted) {
          setState((s) => {
            if (s.page !== 'login') {
              return { page: 'login', profile: null, isLoading: false, error: '' };
            }
            return s;
          });
        }
      } catch {
        // Timeout on focus check
      }
    };
    window.addEventListener('focus', onFocus);

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      listener.subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [loadProfile]);

  // ─── Login handler ────────────────────────────────
  const handleLoginSuccess = useCallback(
    async (authId: string, email: string) => {
      setState((s) => ({ ...s, isLoading: true, error: '' }));

      try {
        const { profile: byAuth, error: authErr } = await withTimeout(getProfile(authId), 15000);
        if (authErr) {
          setState({ page: 'login', profile: null, isLoading: false, error: authErr.message });
          return;
        }
        if (byAuth) {
          setState({ profile: byAuth, page: determinePage(byAuth), isLoading: false, error: '' });
          return;
        }

        // Account linking by email
        const { profile: byEmail, error: emailErr } = await withTimeout(getProfileByEmail(email), 10000);
        if (emailErr) {
          setState({ page: 'login', profile: null, isLoading: false, error: emailErr.message });
          return;
        }
        if (byEmail) {
          const { profile: linked, error: linkErr } = await withTimeout(
            linkProfileToAuth(byEmail.user_id, authId),
            10000
          );
          if (linkErr || !linked) {
            setState({ page: 'login', profile: null, isLoading: false, error: linkErr?.message || 'Account linking failed' });
            return;
          }
          setState({ profile: linked, page: determinePage(linked), isLoading: false, error: '' });
          return;
        }

        // Create new
        const { profile: newProfile, error: createError } = await withTimeout(createProfile(authId, email), 10000);
        if (createError || !newProfile) {
          setState({ page: 'login', profile: null, isLoading: false, error: createError?.message || 'Failed to create profile' });
          return;
        }
        setState({ profile: newProfile, page: 'setup', isLoading: false, error: '' });
      } catch {
        setState({ page: 'login', profile: null, isLoading: false, error: 'Connection timeout. Please try again.' });
      }
    },
    [determinePage]
  );

  // ─── Setup complete ───────────────────────────────
  const handleSetupComplete = useCallback(
    (updatedProfile: Profile) => {
      setState({ profile: updatedProfile, page: determinePage(updatedProfile), isLoading: false, error: '' });
    },
    [determinePage]
  );

  // ─── LOGOUT ───────────────────────────────────────
  const logout = useCallback(async () => {
    await supabase.auth.signOut({ scope: 'global' });
    wipeAllAuthData();
    setState({ page: 'login', profile: null, isLoading: false, error: '' });
    setTimeout(() => window.location.reload(), 100);
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: '' }));
  }, []);

  return {
    ...state,
    loadProfile,
    handleLoginSuccess,
    handleSetupComplete,
    logout,
    clearError,
  };
}