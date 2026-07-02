import { ROLE_LABELS } from '@/types';
import type { Profile } from '@/types';

interface UserProfileModalProps {
  user: Profile | null;
  onClose: () => void;
}

const ROLE_COLORS: Record<string, string> = {
  creator: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  creator_admin: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  admin: 'text-[#3B82F6] bg-[#3B82F6]/10 border-[#3B82F6]/20',
  staff: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  user: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  worker: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
  property_partner: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
};

export default function UserProfileModal({ user, onClose }: UserProfileModalProps) {
  if (!user) return null;

  const roleLabel = ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] || user.role;
  const roleColor = ROLE_COLORS[user.role] || ROLE_COLORS.user;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Card */}
      <div
        className="relative w-full max-w-lg bg-[#12121A] border border-white/[0.06] rounded-t-3xl max-h-[85vh] overflow-y-auto animate-slideUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Profile Header */}
        <div className="px-5 pt-2 pb-5 text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3 shadow-lg shadow-blue-500/20">
            {(user.username || user.email[0]).charAt(0).toUpperCase()}
          </div>
          <h2 className="text-lg font-bold text-white">@{user.username || 'user'}</h2>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${roleColor}`}>{roleLabel}</span>
            {user.deleted && <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">Deleted</span>}
          </div>
        </div>

        {/* Info Grid */}
        <div className="px-5 pb-6 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <InfoCard label="User ID" value={user.user_id} copyable />
            <InfoCard label="Role" value={roleLabel} />
            <InfoCard label="State" value={user.state || '—'} />
            <InfoCard label="City/LGA" value={user.city || '—'} />
            <InfoCard label="Joined" value={new Date(user.created_at).toLocaleDateString()} />
            <InfoCard label="Status" value={user.deleted ? 'Deleted' : 'Active'} />
          </div>

          {user.bio && (
            <div className="glass rounded-xl p-3">
              <span className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Bio</span>
              <p className="text-xs text-[#8A8B9C] mt-1 leading-relaxed">{user.bio}</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slideUp {
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </div>
  );
}

function InfoCard({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  const handleCopy = () => {
    if (copyable) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
  };

  return (
    <div
      className={`glass rounded-xl p-3 ${copyable ? 'cursor-pointer active:scale-[0.97] transition-transform' : ''}`}
      onClick={handleCopy}
    >
      <span className="text-[10px] text-[#5C5E72] uppercase tracking-wider">{label}</span>
      <p className={`text-xs text-white font-medium mt-1 truncate ${copyable ? 'font-mono' : ''}`} title={value}>
        {value}
      </p>
      {copyable && <span className="text-[8px] text-[#3B82F6]/60">Tap to copy</span>}
    </div>
  );
}
