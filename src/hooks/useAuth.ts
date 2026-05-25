import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, getCurrentSession, getProfile, getProfileByEmail, linkProfileToAuth, createProfile } from '@/lib/supabase';
import type { Profile, Page } from '@/types';

interface AuthState {
  page: Page;
  profile: Profile | null;
  isLoading: boolean;
  error: string;
}

// ─── STALE DATA CLEANUP ────────────────────────────
// Remove old/broken auth data from previous app versions
function cleanupStaleAuth() {
  try {
    const prefix = 'sb-rkrhnkhppeihvmuwvsvn-auth-token';
    // Remove old Supabase auth keys that aren't the current one
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.includes('supabase') && key !== prefix) {
        // Keep current valid token, remove everything else
        if (key.includes('code-verifier') || key.includes('-pkce-') || key.includes('expires_at')) {
          localStorage.removeItem(key);
        }
      }
    }
  } catch {
    // localStorage might be blocked
  }
}

// ─── FULL AUTH CLEANUP (on logout) ─────────────────
function clearAllAuthData() {
  try {
    const keysToRemove: string[] = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.includes('supabase') || key.includes('sb-'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore
  }
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    page: 'loading',
    profile: null,
    isLoading: true,
    error: '',
  });
  const initDone = useRef(false);

  // ─── Determine which page to show ─────────────────
  const determinePage = useCallback((profile: Profile | null): Page => {
    if (!profile) return 'login';
    if (!profile.profile_complete) return 'setup';
    if (profile.role === 'creator_admin') return 'creator';
    return 'dashboard';
  }, []);

  // ─── Load profile from auth user ──────────────────
  const loadProfile = useCallback(
    async (authId: string) => {
      const { profile, error } = await getProfile(authId);

      if (error) {
        setState((s) => ({ ...s, isLoading: false, error: error.message }));
        return;
      }

      if (profile) {
        setState((s) => ({
          ...s,
          profile,
          page: determinePage(profile),
          isLoading: false,
          error: '',
        }));
        return;
      }

      setState((s) => ({ ...s, page: 'login', isLoading: false }));
    },
    [determinePage]
  );

  // ─── Initialize session ───────────────────────────
  useEffect(() => {
    // Prevent double-init in StrictMode
    if (initDone.current) return;
    initDone.current = true;

    let cancelled = false;

    async function init() {
      // Step 1: Clean stale data from old versions
      cleanupStaleAuth();

      // Step 2: Get current session
      const { session, error } = await getCurrentSession();

      if (cancelled) return;

      // No session → login page
      if (error || !session?.user) {
        // Clean any leftover auth state
        clearAllAuthData();
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
        return;
      }

      // Step 3: Session exists → validate it by refreshing
      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();

      if (cancelled) return;

      if (refreshErr || !refreshData.session?.user) {
        // Session is expired/invalid → clear and go to login
        await supabase.auth.signOut({ scope: 'local' });
        clearAllAuthData();
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
        return;
      }

      // Step 4: Valid session → load profile
      await loadProfile(refreshData.session.user.id);
    }

    init();

    // Listen for auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (cancelled) return;

        if (event === 'SIGNED_IN' && session?.user) {
          setState((s) => ({ ...s, isLoading: true }));
          await loadProfile(session.user.id);
        }

        if (event === 'SIGNED_OUT') {
          clearAllAuthData();
          setState({ page: 'login', profile: null, isLoading: false, error: '' });
        }

        if (event === 'TOKEN_REFRESHED' && session?.user) {
          // Session refreshed silently, ensure profile is still loaded
          setState((s) => {
            if (!s.profile) {
              // Profile missing but session valid → reload
              loadProfile(session.user.id);
              return { ...s, isLoading: true };
            }
            return s;
          });
        }
      }
    );

    // Step 5: Refresh session when user returns to tab
    const handleFocus = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        // Session expired while tab was inactive
        setState((s) => {
          if (s.page !== 'login') {
            return { page: 'login', profile: null, isLoading: false, error: '' };
          }
          return s;
        });
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadProfile]);

  // ─── Handle successful login ──────────────────────
  const handleLoginSuccess = useCallback(
    async (authId: string, email: string) => {
      setState((s) => ({ ...s, isLoading: true, error: '' }));

      // STEP 1: Check profile by auth_id
      const { profile: byAuth, error: authErr } = await getProfile(authId);
      if (authErr) {
        setState((s) => ({ ...s, isLoading: false, error: authErr.message }));
        return;
      }
      if (byAuth) {
        setState((s) => ({
          ...s,
          profile: byAuth,
          page: determinePage(byAuth),
          isLoading: false,
          error: '',
        }));
        return;
      }

      // STEP 2: Account linking — check by email
      const { profile: byEmail, error: emailErr } = await getProfileByEmail(email);
      if (emailErr) {
        setState((s) => ({ ...s, isLoading: false, error: emailErr.message }));
        return;
      }
      if (byEmail) {
        const { profile: linked, error: linkErr } = await linkProfileToAuth(
          byEmail.user_id,
          authId
        );
        if (linkErr || !linked) {
          setState((s) => ({
            ...s,
            isLoading: false,
            error: linkErr?.message || 'Account linking failed',
          }));
          return;
        }
        setState((s) => ({
          ...s,
          profile: linked,
          page: determinePage(linked),
          isLoading: false,
          error: '',
        }));
        return;
      }

      // STEP 3: Create new profile
      const { profile: newProfile, error: createError } = await createProfile(authId, email);

      if (createError || !newProfile) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: createError?.message || 'Failed to create profile',
        }));
        return;
      }

      setState((s) => ({
        ...s,
        profile: newProfile,
        page: 'setup',
        isLoading: false,
        error: '',
      }));
    },
    [determinePage]
  );

  // ─── Handle profile setup complete ────────────────
  const handleSetupComplete = useCallback(
    (updatedProfile: Profile) => {
      setState((s) => ({
        ...s,
        profile: updatedProfile,
        page: determinePage(updatedProfile),
        error: '',
      }));
    },
    [determinePage]
  );

  // ─── Logout (full cleanup) ────────────────────────
  const logout = useCallback(async () => {
    await supabase.auth.signOut({ scope: 'global' });
    clearAllAuthData();
    // Force page reload to ensure clean state
    window.location.reload();
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
