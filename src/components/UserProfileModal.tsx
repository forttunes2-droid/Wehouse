import { useState } from 'react';
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
  const isCreator = adminProfile?.role === 'creator' || adminProfile?.role === 'creator_admin';
  const isOperator = isAdmin || isCreator;

  // Admin branch
  const adminState = adminProfile?.assigned_state || adminProfile?.state || '';
  const adminLga = (adminProfile as any)?.assigned_lga || (adminProfile as any)?.local_government || (adminProfile as any)?.city || '';

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

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0E0E14] w-full sm:w-[420px] sm:rounded-3xl rounded-t-3xl max-h-[85vh] overflow-y-auto border border-[#232330]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="relative bg-gradient-to-br from-indigo-900/30 to-[#0E0E14] px-5 pt-6 pb-8">
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-xl font-bold mb-3">
              {user.avatar_url ? <img src={user.avatar_url} className="w-full h-full rounded-2xl object-cover" /> : initials}
            </div>
            <h3 className="text-base font-bold text-white">@{user.username || 'unknown'}</h3>
            <p className="text-xs text-[#5C5E72] mt-0.5">{user.email}</p>
            <span className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">
              {user.role === 'user' ? 'User' : user.role === 'worker' ? 'Worker' : user.role === 'property_partner' ? 'Partner' : user.role === 'staff' ? 'Staff' : user.role === 'admin' ? 'Admin' : user.role}
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="px-5 pb-4 space-y-3">
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
            {(user as any).bio && (
              <p className="text-[10px] text-[#8A8B9C] pt-2 border-t border-[#1E1E2C]">{(user as any).bio}</p>
            )}
          </div>

          {/* Management Actions — only for Admin viewing a User in their branch */}
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

          {/* Info: why no appoint button */}
          {isAdmin && user.role === 'user' && !inBranch && (
            <p className="text-[10px] text-amber-400/70 text-center">
              This user is outside your branch ({userState || 'no state'} / {userLga || 'no LGA'}). Cannot appoint.
            </p>
          )}
        </div>
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );
}