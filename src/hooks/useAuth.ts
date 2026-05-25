import { useState, useEffect, useCallback } from 'react';
import { supabase, getProfile, getProfileByEmail, linkProfileToAuth, createProfile } from '@/lib/supabase';
import type { Profile, Page } from '@/types';

interface AuthState {
  page: Page;
  profile: Profile | null;
  isLoading: boolean;
  error: string;
}

// ─── LOGOUT CLEANUP ────────────────────────────────
function wipeOnLogout() {
  try {
    const keys: string[] = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.includes('sb-') || key.includes('supabase'))) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch { /* ignore */ }
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

  // ─── Load profile from auth ID ────────────────────
  const loadProfile = useCallback(
    async (authId: string) => {
      try {
        const { profile, error } = await getProfile(authId);
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

  // ─── Initialize: check session on mount ───────────
  useEffect(() => {
    let mounted = true;

    // Safety: if stuck >8s, show login
    const safetyTimer = setTimeout(() => {
      if (mounted) setState({ page: 'login', profile: null, isLoading: false, error: '' });
    }, 8000);

    // Initialize
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) { clearTimeout(safetyTimer); return; }

      if (data.session?.user) {
        // Session found → load profile (supersedes safety timer)
        loadProfile(data.session.user.id).then(() => clearTimeout(safetyTimer));
      } else {
        // No session → login page
        clearTimeout(safetyTimer);
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
      }
    }).catch(() => {
      if (mounted) {
        clearTimeout(safetyTimer);
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
      }
    });

    // Auth state listener
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && session?.user) {
        loadProfile(session.user.id);
      }
      if (event === 'SIGNED_OUT') {
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // ─── Login success handler ────────────────────────
  const handleLoginSuccess = useCallback(
    async (authId: string, email: string) => {
      setState((s) => ({ ...s, isLoading: true, error: '' }));

      // Check by auth_id
      const { profile: byAuth, error: authErr } = await getProfile(authId);
      if (authErr) {
        setState({ page: 'login', profile: null, isLoading: false, error: authErr.message });
        return;
      }
      if (byAuth) {
        setState({ profile: byAuth, page: determinePage(byAuth), isLoading: false, error: '' });
        return;
      }

      // Account linking by email
      const { profile: byEmail } = await getProfileByEmail(email);
      if (byEmail) {
        const { profile: linked, error: linkErr } = await linkProfileToAuth(byEmail.user_id, authId);
        if (linkErr || !linked) {
          setState({ page: 'login', profile: null, isLoading: false, error: linkErr?.message || 'Link failed' });
          return;
        }
        setState({ profile: linked, page: determinePage(linked), isLoading: false, error: '' });
        return;
      }

      // Create new profile
      const { profile: newProfile, error: createError } = await createProfile(authId, email);
      if (createError || !newProfile) {
        setState({ page: 'login', profile: null, isLoading: false, error: createError?.message || 'Create failed' });
        return;
      }
      setState({ profile: newProfile, page: 'setup', isLoading: false, error: '' });
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
    wipeOnLogout();
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
