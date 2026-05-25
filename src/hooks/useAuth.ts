import { useState, useEffect, useCallback } from 'react';
import { supabase, getCurrentSession, getProfile, getProfileByEmail, linkProfileToAuth, createProfile } from '@/lib/supabase';
import type { Profile, Page } from '@/types';

interface AuthState {
  page: Page;
  profile: Profile | null;
  isLoading: boolean;
  error: string;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    page: 'loading',
    profile: null,
    isLoading: true,
    error: '',
  });

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
      // Try to get existing profile
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

      // No profile found - should auto-create, but wait for user info
      setState((s) => ({ ...s, page: 'login', isLoading: false }));
    },
    [determinePage]
  );

  // ─── Initialize: check session on mount ───────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { session, error } = await getCurrentSession();

      if (cancelled) return;

      if (error || !session?.user) {
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
        return;
      }

      await loadProfile(session.user.id);
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
          setState({ page: 'login', profile: null, isLoading: false, error: '' });
        }
      }
    );

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // ─── Handle successful login ──────────────────────
  // Supports account linking: email + Google with same email = same profile
  const handleLoginSuccess = useCallback(
    async (authId: string, email: string) => {
      setState((s) => ({ ...s, isLoading: true, error: '' }));

      // STEP 1: Check if profile exists for this auth_id
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

      // STEP 2: Account linking — check if profile exists for this EMAIL
      // (e.g., user signed up with email, now logging in with Google)
      const { profile: byEmail, error: emailErr } = await getProfileByEmail(email);
      if (emailErr) {
        setState((s) => ({ ...s, isLoading: false, error: emailErr.message }));
        return;
      }
      if (byEmail) {
        // Link: update auth_id to the new provider's auth_id
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

      // STEP 3: No profile found — create new profile
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

  // ─── Logout ───────────────────────────────────────
  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    // State will be updated by onAuthStateChange listener
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
