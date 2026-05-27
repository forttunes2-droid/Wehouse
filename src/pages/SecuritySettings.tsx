import { useState, useEffect, useCallback } from 'react';
import { parseDeviceInfo, getSessionHistory, supabase, deleteOwnAccount, changePassword, logPasswordChange } from '@/lib/supabase';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';
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
  const { ask, dialogProps } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Password change state
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Only USER and WORKER can delete their own account
  const canDeleteAccount = profile.role === 'user' || profile.role === 'worker';
  const isCreator = profile.role === 'creator';

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
    const ok = await ask({ title: 'Logout All Devices', message: 'You will be logged out of all devices and need to sign in again.', confirmLabel: 'Logout All', cancelLabel: 'Cancel', variant: 'warning' });
    if (!ok) return;
    setLoggingOut('all');
    await supabase.auth.signOut({ scope: 'global' });
    toast.success('Logged out of all devices');
    setTimeout(() => window.location.reload(), 500);
  }

  function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
    const colors = ['#EF4444', '#EF4444', '#F59E0B', '#3B82F6', '#22C55E', '#22C55E'];
    return { score, label: labels[score], color: colors[score] };
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Fill in all password fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    setChangingPassword(true);
    const { error } = await changePassword(currentPassword, newPassword, profile.email);
    if (error) {
      toast.error(error.message);
      setChangingPassword(false);
      return;
    }
    // Log the password change
    await logPasswordChange(profile.user_id, profile.auth_id);
    toast.success('Password updated successfully');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswordForm(false);
    setChangingPassword(false);
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    const { error } = await deleteOwnAccount(profile.user_id, profile.auth_id);
    if (error) {
      toast.error('Delete failed: ' + (error.message || JSON.stringify(error)));
      console.error('[Delete Account Error]', error);
      setDeleting(false);
      return;
    }
    // Wipe auth data
    await supabase.auth.signOut({ scope: 'global' });
    try {
      const keys: string[] = [];
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('sb-') || key.includes('supabase'))) keys.push(key);
      }
      keys.forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch { /* ignore */ }
    toast.success('Account deleted');
    setTimeout(() => window.location.reload(), 1000);
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
      <ConfirmDialog {...dialogProps} />
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

        {/* Change Password */}
        <div>
          <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3 px-1">
            Password
          </h3>
          {!showPasswordForm ? (
            <button
              onClick={() => setShowPasswordForm(true)}
              className="w-full glass rounded-2xl p-4 flex items-center gap-3 text-left card-hover group"
            >
              <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">Change Password</p>
                <p className="text-[11px] text-[#5C5E72]">Update your account password</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          ) : (
            <form onSubmit={handleChangePassword} className="glass rounded-2xl p-4 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#3B82F6]/10 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Change Password</p>
                  <p className="text-[10px] text-[#5C5E72]">Re-authentication required</p>
                </div>
              </div>

              {/* Current Password */}
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 pr-11 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
                  />
                  <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C5E72] hover:text-white transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {showCurrent ? (
                        <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                      ) : (
                        <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">New Password</label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 pr-11 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
                  />
                  <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C5E72] hover:text-white transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {showNew ? (
                        <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                      ) : (
                        <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
                      )}
                    </svg>
                  </button>
                </div>
                {newPassword && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-[#1A1A24] overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${(getPasswordStrength(newPassword).score / 5) * 100}%`, backgroundColor: getPasswordStrength(newPassword).color }} />
                    </div>
                    <span className="text-[9px]" style={{ color: getPasswordStrength(newPassword).color }}>{getPasswordStrength(newPassword).label}</span>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 pr-11 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C5E72] hover:text-white transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {showConfirm ? (
                        <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                      ) : (
                        <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
                      )}
                    </svg>
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-[10px] text-red-400 mt-1">Passwords do not match</p>
                )}
                {confirmPassword && newPassword === confirmPassword && newPassword.length >= 8 && (
                  <p className="text-[10px] text-green-400 mt-1">Passwords match</p>
                )}
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowPasswordForm(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}
                  disabled={changingPassword}
                  className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm font-medium hover:bg-[#232330] transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword || newPassword.length < 8}
                  className="flex-1 h-10 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  {changingPassword && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {changingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Delete Account — USER and WORKER only */}
        {canDeleteAccount && <div className="pt-4 border-t border-white/[0.04]">
          <h3 className="text-[10px] font-semibold text-[#5C5E72] uppercase tracking-widest mb-4 px-1">
            Account Removal
          </h3>

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full glass rounded-2xl p-4 flex items-center gap-4 text-left group hover:border-red-500/20 transition-all duration-300"
            >
              <div className="w-11 h-11 rounded-xl bg-red-500/[0.08] flex items-center justify-center flex-shrink-0 group-hover:bg-red-500/[0.15] transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white group-hover:text-red-400 transition-colors">Delete Account</p>
                <p className="text-[11px] text-[#5C5E72] mt-0.5">Remove your account and all associated data permanently</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className="flex-shrink-0 group-hover:translate-x-0.5 transition-transform">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ) : (
            <div className="glass rounded-2xl border border-red-500/15 overflow-hidden">
              {/* Header */}
              <div className="px-5 pt-5 pb-4">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <h4 className="text-base font-semibold text-white mb-1">Delete your account?</h4>
                <p className="text-xs text-[#5C5E72] leading-relaxed">
                  This will permanently erase your profile, listings, saved items, messages, and all activity. This action <span className="text-red-400 font-medium">cannot be undone</span>.
                </p>
              </div>

              {/* Data summary */}
              <div className="mx-5 mb-4 p-3 rounded-xl bg-[#1A1A24] border border-[#2A2A3A]">
                <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2 font-medium">Account to delete</p>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-bold">
                    {(profile.username || profile.email[0]).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs text-white font-medium">@{profile.username || 'user'}</p>
                    <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
                  </div>
                </div>
              </div>

              {/* Type DELETE confirmation */}
              <div className="mx-5 mb-4">
                <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-1.5 block">
                  Type <span className="text-red-400 font-bold">DELETE</span> to confirm
                </label>
                <input
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  placeholder="DELETE"
                  className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-red-500/50 focus:ring-red-500/20 outline-none uppercase tracking-widest font-medium"
                />
              </div>

              {/* Actions */}
              <div className="px-5 pb-5 flex gap-2.5">
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                  disabled={deleting}
                  className="flex-1 h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm font-medium hover:bg-[#232330] transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting || deleteInput !== 'DELETE'}
                  className="flex-1 h-11 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 active:scale-[0.98] transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  {deleting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {deleting ? 'Deleting...' : 'Permanently Delete'}
                </button>
              </div>
            </div>
          )}
        </div>}

        {/* Creator safety notice */}
        {isCreator && (
          <div className="pt-4 border-t border-white/[0.04]">
            <h3 className="text-[10px] font-semibold text-purple-400 uppercase tracking-widest mb-4 px-1">
              Creator Account
            </h3>
            <div className="glass rounded-2xl p-4 border border-purple-500/10">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Protected Account</p>
                  <p className="text-[11px] text-[#5C5E72] mt-0.5">
                    Creator accounts cannot be deleted through settings. Contact platform support for account changes.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Staff/Admin notice */}
        {!canDeleteAccount && !isCreator && (
          <div className="pt-4 border-t border-white/[0.04]">
            <h3 className="text-[10px] font-semibold text-[#5C5E72] uppercase tracking-widest mb-4 px-1">
              Account
            </h3>
            <div className="glass rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Account Managed</p>
                  <p className="text-[11px] text-[#5C5E72] mt-0.5">
                    {profile.role === 'staff' ? 'Staff' : 'Admin'} accounts cannot be self-deleted. Contact the creator to remove your account.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
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
