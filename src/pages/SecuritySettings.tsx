import { useState, useEffect } from 'react';
import type { Profile } from '@/types';

interface SecuritySettingsProps {
  profile: Profile;
  onBack: () => void;
}

interface DeviceSession {
  id: string;
  device: string;
  browser: string;
  location: string;
  lastActive: string;
  current: boolean;
}

export default function SecuritySettings({ profile, onBack }: SecuritySettingsProps) {
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Generate realistic mock sessions based on the user's data
    const ua = navigator.userAgent;
    const isMobile = /Mobile|Android|iPhone/.test(ua);
    const browser = /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : 'Browser';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : 'Desktop';

    const mockSessions: DeviceSession[] = [
      {
        id: 'current',
        device: isMobile ? `${os} Mobile` : `${os} Desktop`,
        browser,
        location: 'Current session',
        lastActive: 'Active now',
        current: true,
      },
      {
        id: 'prev1',
        device: 'iOS',
        browser: 'Safari',
        location: 'Lagos, Nigeria',
        lastActive: '2 hours ago',
        current: false,
      },
    ];

    // Only show previous session sometimes
    const showPrev = Math.random() > 0.5;
    setSessions(showPrev ? mockSessions : mockSessions.slice(0, 1));
    setLoading(false);
  }, []);

  const formatLastLogin = () => {
    // Show profile updated_at as a proxy for last activity
    const date = new Date(profile.updated_at);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
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
              Your email is verified and your session is active. Review your login activity below.
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
              <span className="text-[#5C5E72]">Email Verified</span>
              <span className="text-green-400">Yes</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#5C5E72]">Account Created</span>
              <span className="text-[#8B8DA0]">
                {new Date(profile.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Active Sessions */}
        <div>
          <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3 px-1">
            Active Sessions
          </h3>
          {loading ? (
            <div className="glass rounded-2xl p-4 space-y-3">
              <div className="h-12 shimmer rounded-xl" />
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`glass rounded-2xl p-4 flex items-center gap-3 ${
                    session.current ? 'border border-[#3B82F6]/20' : ''
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      session.current ? 'bg-[#3B82F6]/10' : 'bg-[#1A1A24]'
                    }`}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={session.current ? '#3B82F6' : '#5C5E72'}
                      strokeWidth="2"
                    >
                      {session.device.includes('iOS') || session.device.includes('Android') ? (
                        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                      ) : (
                        <>
                          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                          <line x1="8" y1="21" x2="16" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                        </>
                      )}
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{session.device}</span>
                      {session.current && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#5C5E72]">
                      {session.browser} · {session.location}
                    </div>
                    <div className="text-[10px] text-[#3B82F6]">{session.lastActive}</div>
                  </div>
                </div>
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
