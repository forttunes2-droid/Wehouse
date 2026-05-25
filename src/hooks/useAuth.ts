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
  try {
    sessionStorage.clear();
  } catch { /* ignore */ }
  // Remove all cookies
  document.cookie.split(';').forEach((c) => {
    const [name] = c.split('=');
    if (name) {
      document.cookie = `${name.trim()}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    }
  });
}

// ─── SAFE SESSION CHECK ────────────────────────────
async function safeGetSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.user) return null;

    // Validate: try refresh to confirm session is still valid
    const { data: refresh, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refresh.session?.user) return null;

    return refresh.session;
  } catch {
    return null;
  }
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    // Start from loading state
    return { page: 'loading', profile: null, isLoading: true, error: '' };
  });

  const determinePage = useCallback((profile: Profile | null): Page => {
    if (!profile) return 'login';
    if (!profile.profile_complete) return 'setup';
    if (profile.role === 'creator_admin') return 'creator';
    return 'dashboard';
  }, []);

  // ─── Load profile ─────────────────────────────────
  const loadProfile = useCallback(
    async (authId: string) => {
      const { profile, error } = await getProfile(authId);
      if (error) {
        setState({ page: 'login', profile: null, isLoading: false, error: error.message });
        return;
      }
      if (profile) {
        setState({ profile, page: determinePage(profile), isLoading: false, error: '' });
        return;
      }
      setState({ page: 'login', profile: null, isLoading: false, error: '' });
    },
    [determinePage]
  );

  // ─── Initialize on mount ──────────────────────────
  useEffect(() => {
    let mounted = true;

    async function init() {
      // Wait a tick to let StrictMode settle
      await new Promise((r) => setTimeout(r, 0));
      if (!mounted) return;

      const session = await safeGetSession();
      if (!mounted) return;

      if (!session) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        wipeAllAuthData();
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
        return;
      }

      await loadProfile(session.user.id);
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

    // Window focus: validate session still exists
    const onFocus = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session && mounted) {
        setState((s) => {
          if (s.page !== 'login') {
            return { page: 'login', profile: null, isLoading: false, error: '' };
          }
          return s;
        });
      }
    };
    window.addEventListener('focus', onFocus);

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [loadProfile]);

  // ─── Login handler ────────────────────────────────
  const handleLoginSuccess = useCallback(
    async (authId: string, email: string) => {
      setState((s) => ({ ...s, isLoading: true, error: '' }));

      const { profile: byAuth, error: authErr } = await getProfile(authId);
      if (authErr) {
        setState((s) => ({ ...s, isLoading: false, error: authErr.message }));
        return;
      }
      if (byAuth) {
        setState({ profile: byAuth, page: determinePage(byAuth), isLoading: false, error: '' });
        return;
      }

      // Account linking by email
      const { profile: byEmail, error: emailErr } = await getProfileByEmail(email);
      if (emailErr) {
        setState((s) => ({ ...s, isLoading: false, error: emailErr.message }));
        return;
      }
      if (byEmail) {
        const { profile: linked, error: linkErr } = await linkProfileToAuth(byEmail.user_id, authId);
        if (linkErr || !linked) {
          setState((s) => ({ ...s, isLoading: false, error: linkErr?.message || 'Account linking failed' }));
          return;
        }
        setState({ profile: linked, page: determinePage(linked), isLoading: false, error: '' });
        return;
      }

      // Create new
      const { profile: newProfile, error: createError } = await createProfile(authId, email);
      if (createError || !newProfile) {
        setState((s) => ({ ...s, isLoading: false, error: createError?.message || 'Failed to create profile' }));
        return;
      }
      setState({ profile: newProfile, page: 'setup', isLoading: false, error: '' });
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
    // Step 1: Sign out from Supabase
    await supabase.auth.signOut({ scope: 'global' });
    // Step 2: Wipe everything
    wipeAllAuthData();
    // Step 3: Reset state immediately
    setState({ page: 'login', profile: null, isLoading: false, error: '' });
    // Step 4: Hard reload after a brief delay to let state settle
    setTimeout(() => {
      window.location.reload();
    }, 100);
  }, []);

  // ─── Clear error ──────────────────────────────────
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
