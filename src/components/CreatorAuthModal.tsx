import { useState, useEffect } from 'react';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';
import { supabase } from '@/lib/supabase';

/**
 * CreatorAuthModal — Password gate for critical actions.
 *
 * Shows automatically when the auth context requests verification.
 * Also handles first-time password setup if none is set yet.
 */
export default function CreatorAuthModal() {
  const { showModal, verifyPassword, setPassword, dismissRequest, error, isLoading } = useCreatorAuth();
  const [mode, setMode] = useState<'check' | 'setup' | 'change'>('check');
  const [password, setPasswordInput] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);

  // Check if auth password needs first-time setup
  useEffect(() => {
    if (!showModal) return;
    async function check() {
      const { data } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'creator_auth_hash')
        .maybeSingle();
      const { data: enabled } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'creator_auth_enabled')
        .maybeSingle();

      if (!data?.value || enabled?.value !== 'true') {
        setNeedsSetup(true);
        setMode('setup');
      } else {
        setNeedsSetup(false);
        setMode('check');
      }
    }
    check();
  }, [showModal]);

  // Reset fields when modal opens/closes
  useEffect(() => {
    if (showModal) {
      setPasswordInput('');
      setOldPassword('');
      setConfirmPassword('');
      setLocalError('');
    }
  }, [showModal]);

  if (!showModal) return null;

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');
    if (!password.trim()) { setLocalError('Enter your password'); return; }
    const ok = await verifyPassword(password);
    if (ok) {
      setPasswordInput('');
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');
    if (!password.trim()) { setLocalError('Enter a password'); return; }
    if (password.length < 6) { setLocalError('Minimum 6 characters'); return; }
    if (password !== confirmPassword) { setLocalError('Passwords do not match'); return; }
    const ok = await setPassword(password);
    if (ok) {
      setPasswordInput('');
      setConfirmPassword('');
    }
  }

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');
    if (!oldPassword.trim()) { setLocalError('Enter current password'); return; }
    if (!password.trim()) { setLocalError('Enter new password'); return; }
    if (password.length < 6) { setLocalError('Minimum 6 characters'); return; }
    if (password !== confirmPassword) { setLocalError('Passwords do not match'); return; }
    const ok = await setPassword(password, oldPassword);
    if (ok) {
      setPasswordInput('');
      setOldPassword('');
      setConfirmPassword('');
    }
  }

  const displayError = localError || error;
  const isCheckMode = mode === 'check';
  const isSetupMode = mode === 'setup';
  const isChangeMode = mode === 'change';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) dismissRequest(); }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

      {/* Modal */}
      <div className="relative w-full max-w-sm mx-4 bg-[#12121A] border border-white/[0.06] rounded-3xl overflow-hidden shadow-2xl animate-fadeIn">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-[#7C3AED] flex items-center justify-center mx-auto mb-3 shadow-lg shadow-purple-500/20">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white">
            {isSetupMode ? 'Set Creator Password' : isChangeMode ? 'Change Password' : 'Creator Authorization'}
          </h2>
          <p className="text-xs text-[#5C5E72] mt-1">
            {isSetupMode
              ? 'Protect critical actions with a password'
              : isChangeMode
              ? 'Enter current and new password'
              : 'Enter your authorization password'}
          </p>
        </div>

        {/* Form */}
        <div className="px-6 pb-6">
          {/* CHECK MODE */}
          {isCheckMode && (
            <form onSubmit={handleVerify} className="space-y-3">
              <div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Authorization password"
                  autoFocus
                  className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none transition-colors"
                />
              </div>
              {displayError && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                  </svg>
                  {displayError}
                </p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-purple-500 to-[#7C3AED] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {isLoading ? 'Verifying...' : 'Authorize'}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setMode('change'); setLocalError(''); setPasswordInput(''); }}
                  className="flex-1 h-9 rounded-xl text-[11px] text-[#5C5E72] hover:text-white transition-colors border border-white/[0.04]"
                >
                  Change Password
                </button>
                <button
                  type="button"
                  onClick={dismissRequest}
                  className="flex-1 h-9 rounded-xl text-[11px] text-[#5C5E72] hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* SETUP MODE */}
          {isSetupMode && (
            <form onSubmit={handleSetup} className="space-y-3">
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 mb-2">
                <p className="text-[11px] text-amber-400/80 leading-relaxed">
                  This password will be required before any critical action (settings, role changes, user management). Keep it safe.
                </p>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="New password (min 6 characters)"
                autoFocus
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none transition-colors"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none transition-colors"
              />
              {displayError && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                  </svg>
                  {displayError}
                </p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-purple-500 to-[#7C3AED] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {isLoading ? 'Setting...' : 'Set Password & Enable'}
              </button>
              {!needsSetup && (
                <button
                  type="button"
                  onClick={() => { setMode('check'); setLocalError(''); }}
                  className="w-full h-9 rounded-xl text-[11px] text-[#5C5E72] hover:text-white transition-colors"
                >
                  Back to Login
                </button>
              )}
            </form>
          )}

          {/* CHANGE MODE */}
          {isChangeMode && (
            <form onSubmit={handleChange} className="space-y-3">
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Current password"
                autoFocus
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none transition-colors"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="New password (min 6 characters)"
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none transition-colors"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none transition-colors"
              />
              {displayError && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                  </svg>
                  {displayError}
                </p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-purple-500 to-[#7C3AED] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {isLoading ? 'Changing...' : 'Change Password'}
              </button>
              <button
                type="button"
                onClick={() => { setMode(needsSetup ? 'setup' : 'check'); setLocalError(''); setPasswordInput(''); setOldPassword(''); setConfirmPassword(''); }}
                className="w-full h-9 rounded-xl text-[11px] text-[#5C5E72] hover:text-white transition-colors"
              >
                Back
              </button>
            </form>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}
