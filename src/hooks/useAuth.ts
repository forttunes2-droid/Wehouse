import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, getProfileByAuthId, getProfileByEmail, linkProfileToAuth, createProfile, restoreUser, trackSession, endSession, createUserSession, deactivateUserSession, getStoredSessionId, updateSessionLastSeen } from '@/lib/supabase';
import type { Profile, Page } from '@/types';

interface AuthState {
  page: Page;
  profile: Profile | null;
  isLoading: boolean;
  error: string;
  kickedOut?: boolean;
  showRestore?: boolean;
  restoreUserId?: string;
}

// ─── LOGOUT CLEANUP ────────────────────────────────
async function wipeOnLogout() {
  try {
    // 1. Clear all localStorage
    const keys: string[] = [];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.includes('sb-') || key.includes('supabase') || key.startsWith('wh_'))) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();

    // 2. Unregister service worker (clears PWA cache)
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        await reg.unregister();
      }
    }

    // 3. Clear all caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        await caches.delete(name);
      }
    }
  } catch { /* ignore */ }
}

// ─── ROLE HELPERS ──────────────────────────────────
const ADMIN_ROLES = new Set(['creator', 'creator_admin', 'admin']);

export function hasAdminAccess(role: string): boolean {
  return ADMIN_ROLES.has(role);
}

export function isStaff(role: string): boolean {
  return role === 'staff';
}

export function canCreateListings(role: string): boolean {
  return role === 'staff' || role === 'admin' || role === 'creator' || role === 'creator_admin';
}

export function isAdmin(role: string): boolean {
  return role === 'admin';
}

export function isCreator(role: string): boolean {
  return role === 'creator' || role === 'creator_admin';
}

export function canSendAnnouncements(role: string): boolean {
  return isCreator(role) || isAdmin(role);
}

export function getScope(role: string): 'global' | 'local' | null {
  if (isCreator(role)) return 'global';
  if (isAdmin(role)) return 'global';
  if (role === 'staff') return 'local';
  return null;
}

export function isGlobal(role: string): boolean {
  return getScope(role) === 'global';
}

export function canModifyRole(modifierRole: string, targetRole: string): boolean {
  if (isCreator(modifierRole)) return !isCreator(targetRole);
  if (isAdmin(modifierRole)) return !isCreator(targetRole) && !isAdmin(targetRole);
  return false;
}

export function validateRoleTransition(
  modifierRole: string, targetCurrentRole: string, targetNewRole: string
): { allowed: boolean; reason?: string } {
  if (isCreator(targetCurrentRole)) return { allowed: false, reason: 'Creator role cannot be modified' };
  if (isCreator(targetNewRole)) return { allowed: false, reason: 'Creator role cannot be assigned' };
  // Workers and property partners signed up with their role — it cannot be changed
  if (targetCurrentRole === 'worker') return { allowed: false, reason: 'Workers signed up as workers. Their role cannot be changed.' };
  if (targetCurrentRole === 'property_partner') return { allowed: false, reason: 'Property partners signed up as partners. Their role cannot be changed.' };
  if (targetNewRole === 'worker') return { allowed: false, reason: 'Cannot assign worker role. Workers must sign up via worker registration.' };
  if (targetNewRole === 'property_partner') return { allowed: false, reason: 'Cannot assign partner role. Partners must sign up via partner registration.' };
  // Creator can change user/staff/admin roles (not workers, not partners, not creators)
  if (isCreator(modifierRole)) {
    const allRoles = ['user', 'staff', 'admin'];
    if (allRoles.includes(targetCurrentRole) && allRoles.includes(targetNewRole)) return { allowed: true };
    return { allowed: false, reason: `Cannot change ${targetCurrentRole} to ${targetNewRole}` };
  }
  // Admin can change roles up to staff
  if (isAdmin(modifierRole)) {
    const adminRoles = ['user', 'staff'];
    if (adminRoles.includes(targetCurrentRole) && adminRoles.includes(targetNewRole)) return { allowed: true };
    return { allowed: false, reason: 'Admin can only assign User and Staff roles.' };
  }
  return { allowed: false, reason: 'You cannot change roles' };
}

// ─── PLATFORM SETTINGS READERS ────────────────────
async function readSettingFrom(table: string, key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from(table).select('value').eq('key', key).limit(1).maybeSingle();
    if (error) { console.warn(`[Settings] ${table}.${key} error:`, error.message, error.code); return null; }
    if (data?.value == null) { console.warn(`[Settings] ${table}.${key} no data`); return null; }
    return String(data.value);
  } catch (e: any) { console.warn(`[Settings] ${table}.${key} exception:`, e?.message); return null; }
}

async function getSettingValue(key: string): Promise<string | null> {
  const fromPlatform = await readSettingFrom('platform_settings', key);
  if (fromPlatform !== null) return fromPlatform;
  const fromSystem = await readSettingFrom('system_settings', key);
  if (fromSystem !== null) return fromSystem;
  console.warn(`[Settings] Could not read "${key}" from any table.`);
  return null;
}

async function isMaintenanceModeOn(): Promise<boolean> {
  const val = await getSettingValue('maintenance_mode');
  const on = val === 'true' || val === 'on' || val === '1';
  console.log('[Maintenance] mode:', on ? 'ON' : 'OFF', `(raw: ${val})`);
  return on;
}

async function isRegistrationClosed(): Promise<boolean> {
  const val = await getSettingValue('registration_open');
  const closed = val === 'false' || val === 'closed' || val === '0';
  console.log('[Registration] closed:', closed, `(raw: ${val})`);
  return closed;
}

// ─── MAINTENANCE BLOCK HELPER ─────────────────────
async function shouldBlockForMaintenance(profile: Profile | null): Promise<boolean> {
  if (!profile) { console.log('[Maint] No profile — BLOCK'); return true; }
  if (isCreator(profile.role)) { console.log('[Maint] Creator — ALLOW'); return false; }
  if ((profile as any).maintenance_exempt === true) { console.log('[Maint] Exempt — ALLOW'); return false; }
  const maintOn = await isMaintenanceModeOn();
  if (maintOn) { console.log('[Maint] ON — BLOCK'); return true; }
  console.log('[Maint] OFF — ALLOW');
  return false;
}

// ─── AUTH HOOK ────────────────────────────────────
export function useAuth() {
  const [state, setState] = useState<AuthState>({ page: 'loading', profile: null, isLoading: true, error: '', kickedOut: false });

  const handlingLoginRef = useRef(false);
  const processedAuthIdRef = useRef<string | null>(null);
  const weTriggeredSignOutRef = useRef(false);

  const determinePage = useCallback((profile: Profile | null): Page => {
    if (!profile) return 'login';
    if (!profile.profile_complete && profile.role === 'worker') return 'worker_setup';
    if (!profile.profile_complete) return 'setup';
    if (profile.role === 'worker') return 'worker_dashboard';
    if (isCreator(profile.role)) return 'creator';
    if (profile.role === 'admin') return 'admin';
    if (profile.role === 'staff') return 'staff_dashboard';
    if (profile.role === 'property_partner') return 'property_partner';
    return 'dashboard';
  }, []);

  // ─── Centralized entry-point guard ────────────────
  const allowEntry = useCallback(async (profile: Profile): Promise<boolean> => {
    if (profile.deleted) {
      // Show restore option instead of immediately blocking
      setState({ page: 'login', profile: null, isLoading: false, error: '', showRestore: true, restoreUserId: profile.user_id });
      return false;
    }
    const blocked = await shouldBlockForMaintenance(profile);
    if (blocked) {
      weTriggeredSignOutRef.current = true;
      await supabase.auth.signOut(); await wipeOnLogout();
      setState({ page: 'login', profile: null, isLoading: false, error: 'WeHouse is currently under maintenance. Please check back later.' });
      return false;
    }
    return true;
  }, []);

  // ─── Load profile from auth ID ────────────────────
  const loadProfile = useCallback(async (authId: string) => {
    if (processedAuthIdRef.current === authId) { console.log('[Auth] Dedup loadProfile', authId.slice(0,8)); return; }
    processedAuthIdRef.current = authId;
    try {
      // Get email from Supabase auth for fallback matching
      const { data: userData } = await supabase.auth.getUser();
      const email = userData?.user?.email;
      const { profile, error } = await getProfileByAuthId(authId, email);
      if (error || !profile) { setState({ page: 'login', profile: null, isLoading: false, error: '' }); return; }
      const allowed = await allowEntry(profile);
      if (allowed) setState({ profile, page: determinePage(profile), isLoading: false, error: '' });
    } catch (e: any) { setState({ page: 'login', profile: null, isLoading: false, error: '' }); }
  }, [determinePage, allowEntry]);

  // ─── Initialize: check session on mount ───────────
  useEffect(() => {
    let done = false;
    const forceLogin = () => { if (!done) { done = true; setState({ page: 'login', profile: null, isLoading: false, error: '' }); } };
    const timeoutId = setTimeout(forceLogin, 6000);

    Promise.race([
      supabase.auth.getSession(),
      new Promise<{ data: { session: null } }>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])
      .then(({ data }) => {
        if (done) return; clearTimeout(timeoutId);
        if (data.session?.user) loadProfile(data.session.user.id).catch(forceLogin);
        else forceLogin();
      })
      .catch((err) => { console.error('[Auth Init] getSession failed:', err?.message); clearTimeout(timeoutId); forceLogin(); });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        if (handlingLoginRef.current) { console.log('[Auth] SIGNED_IN skipped'); return; }
        loadProfile(session.user.id);
      }
      if (event === 'SIGNED_OUT') {
        if (weTriggeredSignOutRef.current) {
          console.log('[Auth] SIGNED_OUT — we triggered it, preserving error');
          weTriggeredSignOutRef.current = false;
          return;
        }
        wipeOnLogout().catch(() => {});
        setState({ page: 'login', profile: null, isLoading: false, error: '' });
      }
    });

    return () => { done = true; clearTimeout(timeoutId); listener.subscription.unsubscribe(); };
  }, [loadProfile]);

  // ─── Login / Signup success handler ───────────────
  const handleLoginSuccess = useCallback(async (authId: string, email: string, role?: 'user' | 'worker' | 'property_partner') => {
    handlingLoginRef.current = true;
    processedAuthIdRef.current = authId;
    setState((s) => ({ ...s, isLoading: true, error: '' }));

    try {
      const { profile: byAuth } = await getProfileByAuthId(authId);
      const { profile: byEmail } = !byAuth ? await getProfileByEmail(email) : { profile: null };

      if (byAuth) {
        const allowed = await allowEntry(byAuth);
        if (allowed) {
          setState({ profile: byAuth, page: determinePage(byAuth), isLoading: false, error: '', kickedOut: false });
          trackSession(byAuth.user_id, authId).catch(() => {});
          createUserSession(byAuth.user_id, authId).catch(() => {});
        }
        return;
      }

      if (byEmail) {
        // Check if account is deleted — offer restore
        if (byEmail.deleted) {
          setState({ page: 'login', profile: null, isLoading: false, error: '', showRestore: true, restoreUserId: byEmail.user_id });
          return;
        }
        const allowed = await allowEntry(byEmail);
        if (!allowed) return;
        const { profile: linked, error: linkErr } = await linkProfileToAuth(byEmail.user_id, authId);
        if (linkErr || !linked) { setState({ page: 'login', profile: null, isLoading: false, error: linkErr?.message || 'Link failed' }); return; }
        setState({ profile: linked, page: determinePage(linked), isLoading: false, error: '', kickedOut: false });
        trackSession(linked.user_id, authId).catch(() => {});
        createUserSession(linked.user_id, authId).catch(() => {});
        return;
      }

      const maintOn = await isMaintenanceModeOn();
      if (maintOn) {
        weTriggeredSignOutRef.current = true;
        await supabase.auth.signOut(); await wipeOnLogout();
        setState({ page: 'login', profile: null, isLoading: false, error: 'WeHouse is currently under maintenance. Please check back later.' });
        return;
      }
      const regClosed = await isRegistrationClosed();
      if (regClosed) {
        weTriggeredSignOutRef.current = true;
        await supabase.auth.signOut(); await wipeOnLogout();
        setState({ page: 'login', profile: null, isLoading: false, error: 'New registrations are currently closed. Please check back later.' });
        return;
      }

      const chosenRole = role || 'user';
      const { profile: newProfile, error: createError } = await createProfile(authId, email, chosenRole);
      if (createError || !newProfile) { setState({ page: 'login', profile: null, isLoading: false, error: createError?.message || 'Create failed' }); return; }

      if (chosenRole === 'worker') {
        setState({ profile: newProfile, page: 'worker_setup', isLoading: false, error: '', kickedOut: false });
        trackSession(newProfile.user_id, authId).catch(() => {});
        createUserSession(newProfile.user_id, authId).catch(() => {});
        return;
      }

      if (chosenRole === 'property_partner') {
        await supabase.from('property_partners').insert({
          profile_id: newProfile.user_id,
          partner_code: `WHP-${Date.now().toString(36).toUpperCase()}`,
          status: 'pending_verification',
        });
        setState({ profile: newProfile, page: 'setup', isLoading: false, error: '', kickedOut: false });
        trackSession(newProfile.user_id, authId).catch(() => {});
        createUserSession(newProfile.user_id, authId).catch(() => {});
        return;
      }

      setState({ profile: newProfile, page: 'setup', isLoading: false, error: '', kickedOut: false });
      trackSession(newProfile.user_id, authId).catch(() => {});
      createUserSession(newProfile.user_id, authId).catch(() => {});
    } catch (e: any) {
      console.error('[Auth] handleLoginSuccess crashed:', e);
      setState({ page: 'login', profile: null, isLoading: false, error: 'Login failed. Please try again.' });
    } finally {
      handlingLoginRef.current = false;
    }
  }, [determinePage, allowEntry]);

  const handleSetupComplete = useCallback((updatedProfile: Profile) => {
    setState({ profile: updatedProfile, page: determinePage(updatedProfile), isLoading: false, error: '' });
  }, [determinePage]);

  // Restore a soft-deleted account
  const restoreAccount = useCallback(async (userId: string, authId: string) => {
    setState((s) => ({ ...s, isLoading: true }));
    const { error } = await restoreUser(userId);
    if (error) {
      setState({ page: 'login', profile: null, isLoading: false, error: 'Failed to restore account: ' + error.message });
      return;
    }
    // Load the restored profile
    const { profile } = await getProfileByAuthId(authId);
    if (profile) {
      setState({ profile, page: determinePage(profile), isLoading: false, error: '', showRestore: false });
      trackSession(profile.user_id, authId).catch(() => {});
      createUserSession(profile.user_id, authId).catch(() => {});
    }
  }, [determinePage]);

  const logout = useCallback(async () => {
    const userId = state.profile?.user_id; const authId = state.profile?.auth_id;
    const sessionId = getStoredSessionId();
    if (sessionId) await deactivateUserSession(sessionId).catch(() => {});
    if (userId && authId) await endSession(userId, authId).catch(() => {});
    await supabase.auth.signOut({ scope: 'global' }); await wipeOnLogout();
    setState({ page: 'login', profile: null, isLoading: false, error: '', kickedOut: false });
    setTimeout(() => window.location.reload(), 100);
  }, [state.profile]);

  // ─── Session heartbeat (no aggressive kicking) ───
  // Just update last_seen periodically for audit. If the session row
  // goes missing (rare), silently recreate it. Never kick the user out
  // just because their phone went to sleep.
  useEffect(() => {
    if (!state.profile || state.page === 'login' || state.page === 'setup' || state.page === 'worker_setup') return;

    let sessionId = getStoredSessionId();
    const userId = state.profile.user_id;
    const authId = state.profile.auth_id;

    // Recover or create session record
    async function ensureSession() {
      if (!sessionId) {
        // Try to find an existing active session for this user
        const { data: existing } = await supabase
          .from('user_sessions')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          sessionId = existing.id;
          localStorage.setItem('wh_session_id', sessionId!);
        } else {
          // Create a new session
          const newId = await createUserSession(userId, authId);
          if (newId) sessionId = newId;
        }
      }
    }
    ensureSession();

    // Gentle heartbeat — just update last_seen, never kick out
    const interval = setInterval(async () => {
      try {
        if (sessionId) {
          await updateSessionLastSeen(sessionId);
        } else {
          await ensureSession();
        }
      } catch { /* network issues — ignore */ }
    }, 60000); // Every 60 seconds

    return () => clearInterval(interval);
  }, [state.profile?.user_id, state.page]);

  const clearError = useCallback(() => { setState((s) => ({ ...s, error: '' })); }, []);

  return { ...state, handleLoginSuccess, handleSetupComplete, logout, clearError, kickedOut: state.kickedOut, restoreAccount };
}
