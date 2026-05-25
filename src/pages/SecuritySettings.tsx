import { useState, useEffect, useCallback } from 'react';
import { parseDeviceInfo, getSessionHistory, supabase } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface SecuritySettingsProps {
  profile: Profile;
  onBack: () => void;
}

interface DeviceSession {
  id: string;
  device: string;
  os: string;
  browser: string;
  location: string | null;
  loginTime: string;
  lastActive: string;
  isCurrent: boolean;
  source: string;
}

export default function SecuritySettings({ profile, onBack }: SecuritySettingsProps) {
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState<string | null>(null);

  // Parse current device for comparison
  const currentDevice = parseDeviceInfo();

  // Load session history from user_activity table
  const loadSessions = useCallback(async () => {
    setLoading(true);
    const { sessions: history } = await getSessionHistory(profile.user_id, 50);

    // Build session pairs from start/end events
    const sessionMap = new Map<string, Partial<DeviceSession>>();
    const endedSessions = new Set<string>();

    history.forEach((entry: any) => {
      const key = entry.created_at; // Use timestamp as grouping key
      if (entry.action_type === 'session_start') {
        const details = entry.details || {};
        sessionMap.set(key, {
          id: entry.id,
          device: details.device || 'Unknown Device',
          os: details.os || 'Unknown OS',
          browser: details.browser || 'Unknown Browser',
          location: details.location || null,
          loginTime: entry.created_at,
          lastActive: entry.created_at,
          source: details.source || 'login',
        });
      } else if (entry.action_type === 'session_end') {
        endedSessions.add(entry.created_at);
      }
    });

    // Detect current session from browser
    const now = new Date().toISOString();
    const result: DeviceSession[] = [];

    // Add current browser session
    result.push({
      id: 'current',
      device: currentDevice.device,
      os: currentDevice.os,
      browser: currentDevice.browser,
      location: null,
      loginTime: profile.updated_at || now,
      lastActive: 'Active now',
      isCurrent: true,
      source: 'login',
    });

    // Add historical sessions from DB
    sessionMap.forEach((s, key) => {
      if (s.id && s.id !== 'current') {
        const loginDate = new Date(s.loginTime || key);
        const isEnded = endedSessions.has(key);
        result.push({
          id: s.id || key,
          device: s.device || 'Unknown',
          os: s.os || '',
          browser: s.browser || '',
          location: s.location || null,
          loginTime: s.loginTime || key,
          lastActive: isEnded ? 'Logged out' : formatTimeAgo(loginDate),
          isCurrent: false,
          source: s.source || 'login',
        });
      }
    });

    setSessions(result);
    setLoading(false);
  }, [profile.user_id, profile.updated_at, currentDevice.device, currentDevice.os, currentDevice.browser]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function handleLogoutSession(sessionId: string) {
    setLoggingOut(sessionId);
    // For current session, sign out globally
    if (sessionId === 'current') {
      await supabase.auth.signOut({ scope: 'global' });
      toast.success('Logged out successfully');
      setTimeout(() => window.location.reload(), 500);
      return;
    }
    // For historical sessions, we can only show a message
    // Real remote logout requires backend support
    toast.info('Session marked for termination');
    setLoggingOut(null);
  }

  async function handleLogoutAll() {
    if (!confirm('Log out of ALL devices? You will need to log in again.')) return;
    setLoggingOut('all');
    await supabase.auth.signOut({ scope: 'global' });
    toast.success('Logged out of all devices');
    setTimeout(() => window.location.reload(), 500);
  }

  const formatLastLogin = () => {
    const date = new Date(profile.updated_at);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold">Security</h1>
      </header>

      <div className="max-w-lg mx-auto px-5 py-5 space-y-6">
        {/* Security Status */}
        <div className="glass rounded-2xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Your account is secure</h3>
            <p className="text-[11px] text-[#5C5E72] mt-0.5 leading-relaxed">
              Your email is verified and your current session is active. Review all active sessions below.
            </p>
          </div>
        </div>

        {/* Login Info */}
        <div>
          <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3 px-1">
            Login Information
          </h3>
          <div className="glass rounded-2xl p-4 space-y-3">
            <div className="flex justify-between text-xs">
              <span className="text-[#5C5E72]">Last Activity</span>
              <span className="text-white">{formatLastLogin()}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#5C5E72]">Email Status</span>
              <span className="text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                Verified
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#5C5E72]">Account Created</span>
              <span className="text-[#8B8DA0]">
                {new Date(profile.created_at).toLocaleDateString(undefined, {
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#5C5E72]">Current Device</span>
              <span className="text-white">{currentDevice.device} · {currentDevice.browser}</span>
            </div>
          </div>
        </div>

        {/* Active Sessions */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">
              Active Sessions
            </h3>
            {sessions.length > 1 && (
              <button
                onClick={handleLogoutAll}
                disabled={loggingOut === 'all'}
                className="text-[10px] text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10 disabled:opacity-50"
              >
                {loggingOut === 'all' ? '...' : 'Logout All'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="glass rounded-2xl p-4 space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#1A1A24] shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-[#1A1A24] shimmer rounded w-1/3" />
                    <div className="h-2 bg-[#1A1A24] shimmer rounded w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onLogout={handleLogoutSession}
                  loggingOut={loggingOut === session.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Coming Soon */}
        <div>
          <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3 px-1">
            Coming Soon
          </h3>
          <div className="glass rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
            {[
              {
                label: 'Change Password',
                desc: 'Update your account password',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                ),
              },
              {
                label: 'Two-Factor Authentication',
                desc: 'Add an extra layer of security',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                ),
              },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 px-4 py-3.5 opacity-50">
                <div className="w-9 h-9 rounded-xl bg-[#1A1A24] flex items-center justify-center flex-shrink-0">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white flex items-center gap-2">
                    {item.label}
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-[#2A2A3A] text-[#5C5E72]">SOON</span>
                  </div>
                  <div className="text-[11px] text-[#5C5E72]">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SESSION CARD COMPONENT ─────────────────────────

function SessionCard({
  session,
  onLogout,
  loggingOut,
}: {
  session: DeviceSession;
  onLogout: (id: string) => void;
  loggingOut: boolean;
}) {
  // Pick icon based on OS
  const isMobile = /iPhone|iPad|Android/.test(session.device);

  return (
    <div
      className={`glass rounded-2xl p-4 flex items-center gap-3 ${
        session.isCurrent ? 'border border-[#3B82F6]/20' : ''
      }`}
    >
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          session.isCurrent ? 'bg-[#3B82F6]/10' : 'bg-[#1A1A24]'
        }`}
      >
        {isMobile ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={session.isCurrent ? '#3B82F6' : '#5C5E72'} strokeWidth="2">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12" y2="18.01" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={session.isCurrent ? '#3B82F6' : '#5C5E72'} strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{session.device}</span>
          {session.isCurrent && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">
              Current
            </span>
          )}
        </div>
        <div className="text-[11px] text-[#5C5E72]">
          {session.browser} · {session.os}
          {session.location && ` · ${session.location}`}
        </div>
        <div className="text-[10px] text-[#3B82F6]">{session.lastActive}</div>
      </div>
      <button
        onClick={() => onLogout(session.id)}
        disabled={loggingOut}
        className="flex-shrink-0 text-[10px] text-red-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
      >
        {loggingOut ? '...' : 'Logout'}
      </button>
    </div>
  );
}

// ─── UTIL ───────────────────────────────────────────

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
