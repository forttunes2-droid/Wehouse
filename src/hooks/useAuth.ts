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

// ─── ROLE HELPERS (module-level) ───────────────────
// Role hierarchy: creator = admin = staff → admin dashboard
//                 user = worker → regular dashboard
const ADMIN_ROLES = new Set(['creator', 'admin', 'staff']);

export function hasAdminAccess(role: string): boolean {
  return ADMIN_ROLES.has(role);
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
    if (hasAdminAccess(profile.role)) return 'creator';
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
    let done = false;

    // Hard timeout: if getSession hangs, force login after 6s
    const forceLogin = () => {
      if (!done) {
        done = true;
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
      }
    };
    const timeoutId = setTimeout(forceLogin, 6000);

    // Race getSession against timeout
    Promise.race([
      supabase.auth.getSession(),
      new Promise<{ data: { session: null } }>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5000)
      ),
    ])
      .then(({ data }) => {
        if (done) return;
        clearTimeout(timeoutId);

        if (data.session?.user) {
          // Load profile with its own timeout
          loadProfile(data.session.user.id).catch(forceLogin);
        } else {
          forceLogin();
        }
      })
      .catch(() => {
        clearTimeout(timeoutId);
        forceLogin();
      });

    // Auth state listener
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        loadProfile(session.user.id);
      }
      if (event === 'SIGNED_OUT') {
        wipeOnLogout();
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
      }
    });

    return () => {
      done = true;
      clearTimeout(timeoutId);
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
