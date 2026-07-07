import { useState, useEffect } from 'react';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';
import { supabase } from '@/lib/supabase';

export default function CreatorAuthModal() {
  const { showModal, verifyPassword, setPassword, dismissRequest, error, isLoading } = useCreatorAuth();
  const [mode, setMode] = useState<'enter' | 'setup' | 'change'>('enter');
  const [password, setPasswordInput] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');

  // Check if password already set on mount
  useEffect(() => {
    if (!showModal) return;
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setMode('setup'); return; }
      const { data } = await supabase.rpc('creator_auth_status_v3', { p_auth_id: user.id });
      setMode(data?.has_password ? 'enter' : 'setup');
      setPasswordInput(''); setOldPassword(''); setConfirmPassword(''); setLocalError('');
    }
    check();
  }, [showModal]);

  if (!showModal) return null;
  const displayError = localError || error;

  async function handleEnter(e: React.FormEvent) {
    e.preventDefault(); setLocalError('');
    if (!password.trim()) { setLocalError('Enter your password'); return; }
    await verifyPassword(password);
  }
  async function handleSetup(e: React.FormEvent) {
    e.preventDefault(); setLocalError('');
    if (!password.trim()) { setLocalError('Enter a password'); return; }
    if (password.length < 6) { setLocalError('Minimum 6 characters'); return; }
    if (password !== confirmPassword) { setLocalError('Passwords do not match'); return; }
    await setPassword(password);
  }
  async function handleChange(e: React.FormEvent) {
    e.preventDefault(); setLocalError('');
    if (!oldPassword.trim()) { setLocalError('Enter current password'); return; }
    if (!password.trim()) { setLocalError('Enter new password'); return; }
    if (password.length < 6) { setLocalError('Minimum 6 characters'); return; }
    if (password !== confirmPassword) { setLocalError('Passwords do not match'); return; }
    await setPassword(password, oldPassword);
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) dismissRequest(); }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      <div className="relative w-full max-w-sm mx-4 bg-[#12121A] border border-white/[0.06] rounded-3xl overflow-hidden shadow-2xl animate-fadeIn">
        <button onClick={dismissRequest} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white z-10">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>

        {mode === 'enter' && (
          <>
            <div className="px-6 pt-8 pb-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-[#7C3AED] flex items-center justify-center mx-auto mb-3 shadow-lg shadow-purple-500/20">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </div>
              <h2 className="text-lg font-bold text-white">Enter Password</h2>
              <p className="text-xs text-[#5C5E72] mt-1">Required for this action</p>
            </div>
            <form onSubmit={handleEnter} className="px-6 pb-6 space-y-3">
              <input type="password" value={password} onChange={(e) => setPasswordInput(e.target.value)} placeholder="Authorization password" autoFocus className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none" />
              {displayError && <p className="text-xs text-red-400">{displayError}</p>}
              <button type="submit" disabled={isLoading} className="w-full h-11 rounded-xl bg-gradient-to-r from-purple-500 to-[#7C3AED] text-white text-sm font-semibold disabled:opacity-40">{isLoading ? 'Verifying...' : 'Continue'}</button>
              <button type="button" onClick={() => { setMode('change'); setLocalError(''); setPasswordInput(''); }} className="w-full h-9 rounded-xl text-[11px] text-[#5C5E72] hover:text-white">Change Password</button>
            </form>
          </>
        )}

        {mode === 'setup' && (
          <>
            <div className="px-6 pt-8 pb-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-[#7C3AED] flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </div>
              <h2 className="text-lg font-bold text-white">Set Your Password</h2>
              <p className="text-xs text-[#5C5E72] mt-1">Protect critical platform actions</p>
            </div>
            <form onSubmit={handleSetup} className="px-6 pb-6 space-y-3">
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3">
                <p className="text-[11px] text-amber-400/80">This password protects settings changes, role management, and user actions. You will only enter it when doing these actions.</p>
              </div>
              <input type="password" value={password} onChange={(e) => setPasswordInput(e.target.value)} placeholder="New password (min 6 characters)" autoFocus className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none" />
              {displayError && <p className="text-xs text-red-400">{displayError}</p>}
              <button type="submit" disabled={isLoading} className="w-full h-11 rounded-xl bg-gradient-to-r from-purple-500 to-[#7C3AED] text-white text-sm font-semibold disabled:opacity-40">{isLoading ? 'Saving...' : 'Set Password'}</button>
            </form>
          </>
        )}

        {mode === 'change' && (
          <>
            <div className="px-6 pt-8 pb-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-[#7C3AED] flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </div>
              <h2 className="text-lg font-bold text-white">Change Password</h2>
            </div>
            <form onSubmit={handleChange} className="px-6 pb-6 space-y-3">
              <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} placeholder="Current password" autoFocus className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none" />
              <input type="password" value={password} onChange={(e) => setPasswordInput(e.target.value)} placeholder="New password (min 6 characters)" className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-purple-500/50 focus:outline-none" />
              {displayError && <p className="text-xs text-red-400">{displayError}</p>}
              <button type="submit" disabled={isLoading} className="w-full h-11 rounded-xl bg-gradient-to-r from-purple-500 to-[#7C3AED] text-white text-sm font-semibold disabled:opacity-40">{isLoading ? 'Changing...' : 'Change Password'}</button>
              <button type="button" onClick={() => { setMode('enter'); setLocalError(''); setPasswordInput(''); setOldPassword(''); setConfirmPassword(''); }} className="w-full h-9 rounded-xl text-[11px] text-[#5C5E72] hover:text-white">Back</button>
            </form>
          </>
        )}
      </div>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}.animate-fadeIn{animation:fadeIn .2s ease-out}`}</style>
    </div>
  );
}
