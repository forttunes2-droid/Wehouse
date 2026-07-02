import { supabase } from './client';

// ─── SESSION TRACKING ──────────────────────────────

export function parseDeviceInfo(ua: string = navigator.userAgent) {
  let device = 'Desktop';
  let os = 'Unknown';
  let browser = 'Unknown';

  if (/Android/.test(ua)) {
    const match = ua.match(/Android\s([\d.]+)/);
    os = match ? `Android ${match[1]}` : 'Android';
    const deviceMatch = ua.match(/;\s*([^)]+)\s*Build/);
    device = deviceMatch ? deviceMatch[1].trim() : 'Android Device';
  } else if (/iPhone/.test(ua)) {
    os = 'iOS';
    device = 'iPhone';
  } else if (/iPad/.test(ua)) {
    os = 'iPadOS';
    device = 'iPad';
  } else if (/Windows NT/.test(ua)) {
    os = 'Windows';
  } else if (/Mac OS/.test(ua)) {
    os = 'macOS';
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  }

  if (/Chrome/.test(ua) && !/Edg/.test(ua) && !/OPR/.test(ua)) {
    const match = ua.match(/Chrome\/([\d.]+)/);
    browser = match ? `Chrome ${match[1].split('.')[0]}` : 'Chrome';
  } else if (/Edg/.test(ua)) {
    browser = 'Edge';
  } else if (/Firefox/.test(ua)) {
    browser = 'Firefox';
  } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
    browser = 'Safari';
  } else if (/OPR/.test(ua)) {
    browser = 'Opera';
  }

  return { device, os, browser };
}

export async function trackSession(userId: string, authId: string) {
  const { device, os, browser } = parseDeviceInfo();
  const { error } = await supabase.from('user_activity').insert({
    user_id: userId,
    auth_id: authId,
    action_type: 'session_start',
    details: { device, os, browser, source: 'login' },
  });
  return { error };
}

export async function endSession(userId: string, authId: string) {
  const { error } = await supabase.from('user_activity').insert({
    user_id: userId,
    auth_id: authId,
    action_type: 'session_end',
    details: { source: 'logout' },
  });
  return { error };
}

export async function getSessionHistory(userId: string, limit: number = 20) {
  const { data, error } = await supabase
    .from('user_activity')
    .select('*')
    .eq('user_id', userId)
    .or('action_type.eq.session_start,action_type.eq.session_end')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { sessions: data || [], error };
}

// ─── SINGLE-DEVICE SESSION MANAGEMENT ──────────────
// When user logs in on a new device, old device gets logged out.
// BUT: same device (phone turn off/on) should NOT trigger logout.
// Grace period: 5 minutes of no heartbeat before considering session stale.

const SESSION_STORAGE_KEY = 'wh_session_id';
const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

export async function createUserSession(userId: string, authId: string): Promise<string | null> {
  const { device, os, browser } = parseDeviceInfo();

  // Deactivate ALL previous sessions for this user first
  await supabase
    .from('user_sessions')
    .update({ is_active: false, is_current: false, logout_time: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_active', true);

  // Create new session
  const { data, error } = await supabase
    .from('user_sessions')
    .insert({
      user_id: userId,
      auth_id: authId,
      device,
      os,
      browser,
      is_active: true,
      is_current: true,
    })
    .select('id')
    .maybeSingle();

  if (error || !data) {
    console.error('[Session] Failed to create session:', error?.message);
    return null;
  }

  localStorage.setItem(SESSION_STORAGE_KEY, data.id);
  return data.id;
}

export async function deactivateUserSession(sessionId: string) {
  await supabase
    .from('user_sessions')
    .update({ is_active: false, is_current: false, logout_time: new Date().toISOString() })
    .eq('id', sessionId);
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

/**
 * Check if a session is still the active one.
 * A session is active IF:
 * 1. The session row exists and is_active=true, AND
 * 2. There is no NEWER session for the same user (prevents false logout on phone restart)
 * 3. OR the last_seen is within the grace period (phone turned off briefly)
 */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  // Get the current session details
  const { data: currentSession } = await supabase
    .from('user_sessions')
    .select('is_active, user_id, last_seen, created_at')
    .eq('id', sessionId)
    .maybeSingle();

  if (!currentSession) return false;
  if (!currentSession.is_active) return false;

  // Check if there's a newer session for the same user
  const { data: newerSessions } = await supabase
    .from('user_sessions')
    .select('id, created_at')
    .eq('user_id', currentSession.user_id)
    .eq('is_active', true)
    .gt('created_at', currentSession.created_at)
    .limit(1);

  // If there's a newer active session, this one is superseded
  if (newerSessions && newerSessions.length > 0) {
    // But wait — if our last_seen is very recent (within grace period),
    // it might be a race condition. Allow it.
    const lastSeen = currentSession.last_seen ? new Date(currentSession.last_seen).getTime() : 0;
    const now = Date.now();
    if (now - lastSeen < GRACE_PERIOD_MS) {
      return true; // Grace period — don't kick out
    }
    return false; // There's a newer session — we got replaced
  }

  // No newer session — we're the current one. Check grace period for stale last_seen.
  // If last_seen is very old (beyond grace), the session might be stale.
  // But we only check this if there's actually another session to compete with.
  // Since there's no newer session, we're fine.
  return true;
}

export function getStoredSessionId(): string | null {
  try { return localStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
}

export async function updateSessionLastSeen(sessionId: string) {
  await supabase
    .from('user_sessions')
    .update({ last_seen: new Date().toISOString() })
    .eq('id', sessionId);
}
