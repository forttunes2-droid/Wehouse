import { useState, useEffect, useCallback } from 'react';
import { supabase, getProfileByAuthId, getProfileByEmail, linkProfileToAuth, createProfile, trackSession, endSession } from '@/lib/supabase';
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
// ONLY creator and admin get the creator dashboard
// Staff is a listing manager only — NO admin access
const ADMIN_ROLES = new Set(['creator', 'creator_admin', 'admin']);

export function hasAdminAccess(role: string): boolean {
  return ADMIN_ROLES.has(role);
}

// Staff check — for listing creation permission only
export function isStaff(role: string): boolean {
  return role === 'staff';
}

// Can create listings (staff, admin, creator)
export function canCreateListings(role: string): boolean {
  return role === 'staff' || role === 'admin' || role === 'creator' || role === 'creator_admin';
}

// Creator = highest rank. Protected from changes/deletion.
// Supports both 'creator' (new) and 'creator_admin' (legacy)
export function isCreator(role: string): boolean {
  return role === 'creator' || role === 'creator_admin';
}

// ─── ROLE HIERARCHY ───────────────────────────────
// Creator > Admin > Staff > User
// Worker is a separate signup-only role (locked)

// Returns true if modifier can change target's role
export function canModifyRole(modifierRole: string, targetRole: string): boolean {
  // Creator can modify anyone except themselves (handled separately)
  if (isCreator(modifierRole)) return !isCreator(targetRole);
  // Admin can modify staff and users only (not other admins, not creator)
  if (modifierRole === 'admin') {
    return targetRole === 'staff' || targetRole === 'user';
  }
  // Staff cannot modify anyone's role
  return false;
}

// Validate if a role transition is allowed
// Returns { allowed, reason? }
export function validateRoleTransition(
  modifierRole: string,
  targetCurrentRole: string,
  targetNewRole: string
): { allowed: boolean; reason?: string } {
  // Cannot change own role
  // (checked at call site with userId comparison)

  // Creator is locked
  if (isCreator(targetCurrentRole)) {
    return { allowed: false, reason: 'Creator role cannot be modified' };
  }

  // Cannot assign creator
  if (isCreator(targetNewRole)) {
    return { allowed: false, reason: 'Creator role cannot be assigned' };
  }

  // Worker is locked (must sign up as worker)
  if (targetCurrentRole === 'worker') {
    return { allowed: false, reason: 'Worker role is locked. Workers must sign up via worker registration.' };
  }
  if (targetNewRole === 'worker') {
    return { allowed: false, reason: 'Cannot assign worker role. Workers must sign up via worker registration.' };
  }

  // Creator can do any valid transition
  if (isCreator(modifierRole)) {
    // User ↔ Staff, User ↔ Admin, Staff ↔ Admin all allowed
    const validCreatorTransitions: Record<string, string[]> = {
      user: ['staff', 'admin'],
      staff: ['user', 'admin'],
      admin: ['user', 'staff'],
    };
    if (validCreatorTransitions[targetCurrentRole]?.includes(targetNewRole)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Cannot change ${targetCurrentRole} to ${targetNewRole}` };
  }

  // Admin can only do: Staff ↔ User
  if (modifierRole === 'admin') {
    const validAdminTransitions: Record<string, string[]> = {
      staff: ['user'],
      user: ['staff'],
    };
    if (validAdminTransitions[targetCurrentRole]?.includes(targetNewRole)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Admin can only change Staff ↔ User. Cannot modify other admins or non-staff/non-user accounts.' };
  }

  // Staff cannot change any roles
  return { allowed: false, reason: 'Staff cannot change roles' };
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
    if (!profile.profile_complete && profile.role === 'worker') return 'worker_setup';
    if (!profile.profile_complete) return 'setup';
    // ONLY creator and admin get the creator dashboard
    // Staff goes to regular dashboard (they just get listing creation tools)
    if (isCreator(profile.role) || profile.role === 'admin') return 'creator';
    return 'dashboard';
  }, []);

  // ─── Load profile from auth ID ────────────────────
  const loadProfile = useCallback(
    async (authId: string) => {
      try {
        const { profile, error } = await getProfileByAuthId(authId);
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
      .catch((err) => {
        console.error('[WeHouse Auth Init] getSession failed:', err?.message || err);
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
    async (authId: string, email: string, role?: 'user' | 'worker') => {
      setState((s) => ({ ...s, isLoading: true, error: '' }));

      // Check by auth_id
      const { profile: byAuth, error: authErr } = await getProfileByAuthId(authId);
      if (authErr) {
        setState({ page: 'login', profile: null, isLoading: false, error: authErr.message });
        return;
      }
      if (byAuth) {
        setState({ profile: byAuth, page: determinePage(byAuth), isLoading: false, error: '' });
        trackSession(byAuth.user_id, authId).catch(() => {});
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
        trackSession(linked.user_id, authId).catch(() => {});
        return;
      }

      // Create new profile — with role for workers
      const isWorker = role === 'worker';
      const { profile: newProfile, error: createError } = await createProfile(authId, email);
      if (createError || !newProfile) {
        setState({ page: 'login', profile: null, isLoading: false, error: createError?.message || 'Create failed' });
        return;
      }

      // If worker, update with worker role and status
      if (isWorker) {
        await supabase
          .from('profiles')
          .update({ role: 'worker', worker_status: 'pending' })
          .eq('user_id', newProfile.user_id);
        // Refresh profile
        const { data: updated } = await supabase.from('profiles').select('*').eq('user_id', newProfile.user_id).maybeSingle();
        if (updated) {
          setState({ profile: updated as Profile, page: 'worker_setup', isLoading: false, error: '' });
          trackSession(updated.user_id, authId).catch(() => {});
          return;
        }
      }

      setState({ profile: newProfile, page: 'setup', isLoading: false, error: '' });
      trackSession(newProfile.user_id, authId).catch(() => {});
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
    // Track session end before signing out
    const userId = state.profile?.user_id;
    const authId = state.profile?.auth_id;
    if (userId && authId) {
      await endSession(userId, authId).catch(() => {});
    }
    await supabase.auth.signOut({ scope: 'global' });
    wipeOnLogout();
    setState({ page: 'login', profile: null, isLoading: false, error: '' });
    setTimeout(() => window.location.reload(), 100);
  }, [state.profile]);

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
