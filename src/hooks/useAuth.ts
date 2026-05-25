import { useState, useEffect, useCallback } from 'react';
import { supabase, getProfile, getProfileByEmail, linkProfileToAuth, createProfile } from '@/lib/supabase';
import type { Profile, Page } from '@/types';

interface AuthState {
  page: Page;
  profile: Profile | null;
  isLoading: boolean;
  error: string;
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
      if (k.includes('sb-') || k.includes('supabase')) {
        localStorage.removeItem(k);
      }
    });
  } catch { /* ignore */ }
  try { sessionStorage.clear(); } catch { /* ignore */ }
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

  const loadProfile = useCallback(
    async (authId: string) => {
      try {
        // 15s timeout for profile fetch
        const profilePromise = getProfile(authId);
        const timeoutPromise = new Promise<{ profile: null; error: Error }>((resolve) =>
          setTimeout(() => resolve({ profile: null, error: new Error('timeout') }), 15000)
        );
        const { profile, error } = await Promise.race([profilePromise, timeoutPromise]);

        if (error || !profile) {
          setState({ page: 'login', profile: null, isLoading: false, error: '' });
          return;
        }
        setState({ profile, page: determinePage(profile), isLoading: false, error: '' });
      } catch {
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
      }
    },
    [determinePage]
  );

  // ─── Initialize on mount ──────────────────────────
  useEffect(() => {
    let mounted = true;

    // SAFETY: if anything takes >10s, force login page
    const safetyTimer = setTimeout(() => {
      if (mounted) {
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
      }
    }, 10000);

    async function init() {
      try {
        // Get session from localStorage — NO network call
        const { data } = await supabase.auth.getSession();

        if (!mounted) { clearTimeout(safetyTimer); return; }

        if (!data.session?.user) {
          // No session → login page
          clearTimeout(safetyTimer);
          setState({ page: 'login', profile: null, isLoading: false, error: '' });
          return;
        }

        // Valid session → load profile
        await loadProfile(data.session.user.id);
        clearTimeout(safetyTimer);
      } catch {
        if (mounted) {
          clearTimeout(safetyTimer);
          setState({ page: 'login', profile: null, isLoading: false, error: '' });
        }
      }
    }

    init();

    // Auth state listener
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_IN' && session?.user) {
        setState((s) => ({ ...s, isLoading: true }));
        loadProfile(session.user.id);
      }

      if (event === 'SIGNED_OUT') {
        wipeAllAuthData();
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // ─── Login handler ────────────────────────────────
  const handleLoginSuccess = useCallback(
    async (authId: string, email: string) => {
      setState((s) => ({ ...s, isLoading: true, error: '' }));

      try {
        // 15s timeout
        const profilePromise = getProfile(authId);
        const timeoutPromise = new Promise<{ profile: null; error: Error }>((resolve) =>
          setTimeout(() => resolve({ profile: null, error: new Error('timeout') }), 15000)
        );
        const { profile: byAuth, error: authErr } = await Promise.race([profilePromise, timeoutPromise]);

        if (authErr) {
          setState({ page: 'login', profile: null, isLoading: false, error: 'Connection timeout. Please try again.' });
          return;
        }
        if (byAuth) {
          setState({ profile: byAuth, page: determinePage(byAuth), isLoading: false, error: '' });
          return;
        }

        // Account linking by email
        const emailPromise = getProfileByEmail(email);
        const emailTimeout = new Promise<{ profile: null; error: Error }>((resolve) =>
          setTimeout(() => resolve({ profile: null, error: new Error('timeout') }), 10000)
        );
        const { profile: byEmail } = await Promise.race([emailPromise, emailTimeout]);

        if (byEmail) {
          const linkPromise = linkProfileToAuth(byEmail.user_id, authId);
          const linkTimeout = new Promise<{ profile: null; error: Error }>((resolve) =>
            setTimeout(() => resolve({ profile: null, error: new Error('timeout') }), 10000)
          );
          const { profile: linked, error: linkErr } = await Promise.race([linkPromise, linkTimeout]);
          if (linkErr || !linked) {
            setState({ page: 'login', profile: null, isLoading: false, error: linkErr?.message || 'Account linking failed' });
            return;
          }
          setState({ profile: linked, page: determinePage(linked), isLoading: false, error: '' });
          return;
        }

        // Create new profile
        const createPromise = createProfile(authId, email);
        const createTimeout = new Promise<{ profile: null; error: Error }>((resolve) =>
          setTimeout(() => resolve({ profile: null, error: new Error('timeout') }), 10000)
        );
        const { profile: newProfile, error: createError } = await Promise.race([createPromise, createTimeout]);
        if (createError || !newProfile) {
          setState({ page: 'login', profile: null, isLoading: false, error: createError?.message || 'Failed to create profile' });
          return;
        }
        setState({ profile: newProfile, page: 'setup', isLoading: false, error: '' });
      } catch {
        setState({ page: 'login', profile: null, isLoading: false, error: 'Something went wrong. Please try again.' });
      }
    },
    [determinePage]
  );

  const handleSetupComplete = useCallback(
    (updatedProfile: Profile) => {
      setState({ profile: updatedProfile, page: determinePage(updatedProfile), isLoading: false, error: '' });
    },
    [determinePage]
  );

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
    handleLoginSuccess,
    handleSetupComplete,
    logout,
    clearError,
  };
}
