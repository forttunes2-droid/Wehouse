import { useState, useEffect, useCallback, useRef } from 'react';
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
      if (key && (key.includes('sb-') || key.includes('supabase') || key.startsWith('wh_'))) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch { /* ignore */ }
}

// ─── ROLE HELPERS ──────────────────────────────────
const ADMIN_ROLES = new Set(['creator', 'creator_admin', 'state_admin', 'admin', 'assistant_state_admin']);

export function hasAdminAccess(role: string): boolean {
  return ADMIN_ROLES.has(role);
}

export function isStaff(role: string): boolean {
  return role === 'staff';
}

export function canCreateListings(role: string): boolean {
  return role === 'staff' || role === 'admin' || role === 'assistant_state_admin' || role === 'state_admin' || role === 'creator' || role === 'creator_admin';
}

export function isStateAdmin(role: string): boolean {
  return role === 'state_admin';
}

export function isAssistantAdmin(role: string): boolean {
  return role === 'assistant_state_admin';
}

export function canSendAnnouncements(role: string): boolean {
  return isCreator(role) || role === 'state_admin';
}

export function isCreator(role: string): boolean {
  return role === 'creator' || role === 'creator_admin';
}

export function getScope(role: string): 'global' | 'state' | 'local' | null {
  if (isCreator(role)) return 'global';
  if (role === 'state_admin') return 'state';
  if (role === 'admin' || role === 'assistant_state_admin' || role === 'staff') return 'local';
  return null;
}

export function isGlobal(role: string): boolean {
  return getScope(role) === 'global';
}

export function isStateScope(role: string): boolean {
  return getScope(role) === 'state';
}

export function isLocal(role: string): boolean {
  return getScope(role) === 'local';
}

export function canAccessLocation(
  userRole: string, userState: string | null, userLga: string | null,
  targetState: string | null, targetLga: string | null
): boolean {
  if (isGlobal(userRole)) return true;
  if (isStateScope(userRole)) return userState === targetState;
  if (isLocal(userRole)) {
    if (!userState || !userLga) return false;
    return userState === targetState && userLga === targetLga;
  }
  return true;
}

export function canModifyRole(modifierRole: string, targetRole: string): boolean {
  if (isCreator(modifierRole)) return !isCreator(targetRole);
  if (modifierRole === 'admin') return targetRole === 'staff' || targetRole === 'user';
  return false;
}

export function validateRoleTransition(
  modifierRole: string, targetCurrentRole: string, targetNewRole: string
): { allowed: boolean; reason?: string } {
  if (isCreator(targetCurrentRole)) return { allowed: false, reason: 'Creator role cannot be modified' };
  if (isCreator(targetNewRole)) return { allowed: false, reason: 'Creator role cannot be assigned' };
  if (targetCurrentRole === 'worker') return { allowed: false, reason: 'Worker role is locked. Workers must sign up via worker registration.' };
  if (targetNewRole === 'worker') return { allowed: false, reason: 'Cannot assign worker role. Workers must sign up via worker registration.' };
  if (isCreator(modifierRole)) {
    const allRoles = ['user', 'staff', 'admin', 'assistant_state_admin', 'state_admin'];
    if (allRoles.includes(targetCurrentRole) && allRoles.includes(targetNewRole)) return { allowed: true };
    return { allowed: false, reason: `Cannot change ${targetCurrentRole} to ${targetNewRole}` };
  }
  if (modifierRole === 'admin') {
    const validAdminTransitions: Record<string, string[]> = { staff: ['user'], user: ['staff'] };
    if (validAdminTransitions[targetCurrentRole]?.includes(targetNewRole)) return { allowed: true };
    return { allowed: false, reason: 'Admin can only change Staff ↔ User.' };
  }
  return { allowed: false, reason: 'Staff cannot change roles' };
}

// ─── PLATFORM SETTINGS READERS ────────────────────
async function readSettingFrom(table: string, key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from(table).select('value').eq('key', key).maybeSingle();
    if (error) { console.warn(`[Settings] ${table}.${key} error:`, error.message); return null; }
    if (data?.value == null) { console.warn(`[Settings] ${table}.${key} returned null`); return null; }
    return String(data.value);
  } catch (e: any) { console.warn(`[Settings] ${table}.${key} exception:`, e?.message); return null; }
}

async function getSettingValue(key: string): Promise<string | null> {
  const fromPlatform = await readSettingFrom('platform_settings', key);
  if (fromPlatform !== null) return fromPlatform;
  const fromSystem = await readSettingFrom('system_settings', key);
  if (fromSystem !== null) return fromSystem;
  console.warn(`[Settings] Could not read "${key}" from any table. Defaulting to null (feature OFF).`);
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
  if (!profile) { console.log('[Maintenance] No profile — blocking.'); return true; }
  if (isCreator(profile.role)) { console.log('[Maintenance] Creator — allowed.'); return false; }
  if ((profile as any).maintenance_exempt === true) { console.log('[Maintenance] Exempt — allowed.'); return false; }
  const maintOn = await isMaintenanceModeOn();
  if (maintOn) { console.log('[Maintenance] Mode ON — blocking.'); return true; }
  return false;
}

// ─── AUTH HOOK ────────────────────────────────────
export function useAuth() {
  const [state, setState] = useState<AuthState>({ page: 'loading', profile: null, isLoading: true, error: '' });

  // Prevent auth listener from racing with handleLoginSuccess
  const handlingLoginRef = useRef(false);
  // Prevent loadProfile from running twice for same authId
  const processedAuthIdRef = useRef<string | null>(null);

  const determinePage = useCallback((profile: Profile | null): Page => {
    if (!profile) return 'login';
    if (!profile.profile_complete && profile.role === 'worker') return 'worker_setup';
    if (!profile.profile_complete) return 'setup';
    if (isCreator(profile.role)) return 'creator';
    if (profile.role === 'state_admin') return 'state_admin';
    if (profile.role === 'assistant_state_admin') return 'assistant_state_admin';
    if (profile.role === 'admin') return 'admin';
    return 'dashboard';
  }, []);

  // Centralized entry-point guard: every path into the app goes through here
  const allowEntry = useCallback(async (profile: Profile): Promise<boolean> => {
    if (profile.deleted) {
      await supabase.auth.signOut(); wipeOnLogout();
      setState({ page: 'login', profile: null, isLoading: false, error: 'This account has been deleted. Please contact support if you believe this is an error.' });
      return false;
    }
    const blocked = await shouldBlockForMaintenance(profile);
    if (blocked) {
      await supabase.auth.signOut(); wipeOnLogout();
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
      const { profile, error } = await getProfileByAuthId(authId);
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
        if (handlingLoginRef.current) { console.log('[Auth] SIGNED_IN skipped — handleLoginSuccess handling it'); return; }
        loadProfile(session.user.id);
      }
      if (event === 'SIGNED_OUT') { wipeOnLogout(); setState({ page: 'login', profile: null, isLoading: false, error: '' }); }
    });

    return () => { done = true; clearTimeout(timeoutId); listener.subscription.unsubscribe(); };
  }, [loadProfile]);

  // ─── Login / Signup success handler ───────────────
  const handleLoginSuccess = useCallback(async (authId: string, email: string, role?: 'user' | 'worker') => {
    handlingLoginRef.current = true;
    processedAuthIdRef.current = authId;
    setState((s) => ({ ...s, isLoading: true, error: '' }));

    try {
      // STEP 1: Look up existing profile
      const { profile: byAuth } = await getProfileByAuthId(authId);
      const { profile: byEmail } = !byAuth ? await getProfileByEmail(email) : { profile: null };

      // STEP 2: Existing profile by auth_id
      if (byAuth) {
        const allowed = await allowEntry(byAuth);
        if (allowed) { setState({ profile: byAuth, page: determinePage(byAuth), isLoading: false, error: '' }); trackSession(byAuth.user_id, authId).catch(() => {}); }
        return;
      }

      // STEP 3: Account linking by email
      if (byEmail) {
        const allowed = await allowEntry(byEmail);
        if (!allowed) return;
        const { profile: linked, error: linkErr } = await linkProfileToAuth(byEmail.user_id, authId);
        if (linkErr || !linked) { setState({ page: 'login', profile: null, isLoading: false, error: linkErr?.message || 'Link failed' }); return; }
        setState({ profile: linked, page: determinePage(linked), isLoading: false, error: '' });
        trackSession(linked.user_id, authId).catch(() => {});
        return;
      }

      // STEP 4: New account — check maintenance + registration
      const maintOn = await isMaintenanceModeOn();
      if (maintOn) {
        await supabase.auth.signOut(); wipeOnLogout();
        setState({ page: 'login', profile: null, isLoading: false, error: 'WeHouse is currently under maintenance. Please check back later.' });
        return;
      }
      const regClosed = await isRegistrationClosed();
      if (regClosed) {
        await supabase.auth.signOut(); wipeOnLogout();
        setState({ page: 'login', profile: null, isLoading: false, error: 'New registrations are currently closed. Please check back later.' });
        return;
      }

      // STEP 5: Create new profile
      const isWorker = role === 'worker';
      const { profile: newProfile, error: createError } = await createProfile(authId, email);
      if (createError || !newProfile) { setState({ page: 'login', profile: null, isLoading: false, error: createError?.message || 'Create failed' }); return; }

      if (isWorker) {
        await supabase.from('profiles').update({ role: 'worker', worker_status: 'pending' }).eq('user_id', newProfile.user_id);
        const { data: updated } = await supabase.from('profiles').select('*').eq('user_id', newProfile.user_id).maybeSingle();
        if (updated) { setState({ profile: updated as Profile, page: 'worker_setup', isLoading: false, error: '' }); trackSession(updated.user_id, authId).catch(() => {}); return; }
      }

      setState({ profile: newProfile, page: 'setup', isLoading: false, error: '' });
      trackSession(newProfile.user_id, authId).catch(() => {});
    } finally {
      handlingLoginRef.current = false;
    }
  }, [determinePage, allowEntry]);

  const handleSetupComplete = useCallback((updatedProfile: Profile) => {
    setState({ profile: updatedProfile, page: determinePage(updatedProfile), isLoading: false, error: '' });
  }, [determinePage]);

  const logout = useCallback(async () => {
    const userId = state.profile?.user_id; const authId = state.profile?.auth_id;
    if (userId && authId) await endSession(userId, authId).catch(() => {});
    await supabase.auth.signOut({ scope: 'global' }); wipeOnLogout();
    setState({ page: 'login', profile: null, isLoading: false, error: '' });
    setTimeout(() => window.location.reload(), 100);
  }, [state.profile]);

  const clearError = useCallback(() => { setState((s) => ({ ...s, error: '' })); }, []);

  return { ...state, handleLoginSuccess, handleSetupComplete, logout, clearError };
}
