import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface UserProfileModalProps {
  user: Profile | null;
  adminProfile?: Profile | null;
  onClose: () => void;
  onPromote?: () => void;
}

export default function UserProfileModal({ user, adminProfile, onClose, onPromote }: UserProfileModalProps) {
  if (!user) return null;

  const [confirmingPromote, setConfirmingPromote] = useState(false);
  const [promoting, setPromoting] = useState(false);

  const isAdmin = adminProfile?.role === 'admin';

  // Admin branch
  const adminState = adminProfile?.assigned_state || adminProfile?.state || '';
  const adminLga = (adminProfile as any)?.assigned_lga || (adminProfile as any).local_government || (adminProfile as any).city || '';

  // User location
  const userState = user.state || '';
  const userLga = (user as any).local_government || (user as any).city || '';
  const inBranch = userState === adminState && userLga === adminLga;

  // Can appoint: Admin + user in branch + user role is 'user'
  const canAppoint = isAdmin && inBranch && user.role === 'user';

  const initials = (user.username || user.email[0] || 'U').toUpperCase();

  async function handlePromote() {
    if (!user) return;
    setPromoting(true);
    const { data, error } = await supabase.rpc('admin_promote_to_staff', {
      p_target_user_id: user.user_id,
    });
    setPromoting(false);
    setConfirmingPromote(false);

    if (error) {
      toast.error(`Failed: ${error.message}`);
      return;
    }
    if (data) {
      toast.success(`${user.username || 'User'} appointed as Staff`);
      onPromote?.();
      onClose();
    }
  }

  // Prevent body scroll when modal is open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      {/* Scrollable area */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorY: 'contain',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top spacer */}
        <div className="h-[8vh] sm:h-[10vh]" />

        {/* Modal card */}
        <div
          className="bg-[#0E0E14] w-full sm:w-[420px] sm:rounded-3xl rounded-t-3xl border border-[#232330] mx-auto"
          style={{ minHeight: '84vh' }}
        >
          {/* Header */}
          <div className="relative bg-gradient-to-br from-indigo-900/30 to-[#0E0E14] px-5 pt-6 pb-8">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 flex items-center justify-center active:bg-white/20"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-xl font-bold mb-3">
                {user.avatar_url ? <img src={user.avatar_url} className="w-full h-full rounded-2xl object-cover" alt="" /> : initials}
              </div>
              <h3 className="text-base font-bold text-white">@{user.username || 'unknown'}</h3>
              <p className="text-xs text-[#5C5E72] mt-0.5">{user.email}</p>
              <span className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">
                {user.role === 'user' ? 'User' : user.role === 'worker' ? 'Worker' : user.role === 'property_partner' ? 'Partner' : user.role === 'staff' ? 'Staff' : user.role === 'admin' ? 'Admin' : user.role}
              </span>
            </div>
          </div>

          {/* Info sections */}
          <div className="px-5 pb-8 space-y-3">
            {/* Details */}
            <div className="glass rounded-2xl p-4 space-y-3">
              {[
                { label: 'ID', value: user.user_id },
                { label: 'State', value: user.state || 'Not set' },
                { label: 'LGA', value: (user as any).local_government || (user as any).city || 'Not set' },
                { label: 'Joined', value: new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) },
                { label: 'Status', value: (user as any).deleted ? 'Deleted' : (user as any).worker_status === 'suspended' ? 'Suspended' : 'Active' },
              ].map(item => (
                <div key={item.label} className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">{item.label}</span>
                  <span className="text-white/80 font-medium">{item.value}</span>
                </div>
              ))}
            </div>

            {/* About / Bio */}
            {(user as any).bio && (
              <div className="glass rounded-2xl p-4">
                <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">About</p>
                <p className="text-xs text-white/80 leading-relaxed">{(user as any).bio}</p>
              </div>
            )}

            {/* Contact */}
            <div className="glass rounded-2xl p-4 space-y-2">
              <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Contact</p>
              {user.email && (
                <div className="flex items-center gap-2 text-xs text-white">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                  {user.email}
                </div>
              )}
              {user.phone && (
                <div className="flex items-center gap-2 text-xs text-white">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                  {user.phone}
                </div>
              )}
            </div>

            {/* Worker-specific */}
            {user.role === 'worker' && (
              <>
                {user.worker_bio && (
                  <div className="glass rounded-2xl p-4">
                    <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Work Bio</p>
                    <p className="text-xs text-white/80 leading-relaxed">{user.worker_bio}</p>
                  </div>
                )}
                {user.worker_occupation && (
                  <div className="glass rounded-2xl p-4">
                    <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Occupation</p>
                    <p className="text-xs text-white/80">{user.worker_occupation}</p>
                  </div>
                )}
                {user.worker_skills && user.worker_skills.length > 0 && (
                  <div className="glass rounded-2xl p-4">
                    <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Skills</p>
                    <div className="flex flex-wrap gap-1.5">
                      {user.worker_skills.map((skill: string, i: number) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">{skill}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Promote action */}
            {canAppoint && (
              <div className="glass rounded-2xl p-4 border border-amber-500/10">
                <h4 className="text-xs font-semibold text-amber-400 mb-2">Management</h4>
                {!confirmingPromote ? (
                  <button
                    onClick={() => setConfirmingPromote(true)}
                    className="w-full h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-colors"
                  >
                    Appoint as Staff
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[10px] text-[#5C5E72]">
                      Promote <span className="text-white">@{user.username}</span> to Staff in your branch ({adminState} / {adminLga})?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmingPromote(false)}
                        className="flex-1 h-8 rounded-lg bg-[#12121A] border border-[#232330] text-[#5C5E72] text-[10px] font-semibold"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handlePromote}
                        disabled={promoting}
                        className="flex-1 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-semibold disabled:opacity-50"
                      >
                        {promoting ? 'Appointing...' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Close button */}
            <button
              onClick={onClose}
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-[#5C5E72] text-xs font-semibold hover:bg-[#232330] transition-colors mt-2"
            >
              Close
            </button>
          </div>
        </div>

        {/* Bottom spacer */}
        <div className="h-16" />
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );

  // Render via Portal to document.body — escapes ALL parent containers
  return createPortal(modalContent, document.body);
}
