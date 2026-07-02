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
// When user logs in on a new device, old device gets logged out

const SESSION_STORAGE_KEY = 'wh_session_id';

export async function createUserSession(userId: string, authId: string): Promise<string | null> {
  const { device, os, browser } = parseDeviceInfo();
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
    .single();

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

export async function isSessionActive(sessionId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_sessions')
    .select('is_active')
    .eq('id', sessionId)
    .maybeSingle();
  return data?.is_active === true;
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
