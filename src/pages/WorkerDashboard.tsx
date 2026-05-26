import { Toaster } from 'sonner';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile } from '@/types';

interface WorkerDashboardProps {
  profile: Profile;
  onGoToSetup: () => void;
  onLogout: () => void;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string; desc: string; icon: string }> = {
  pending: {
    color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20',
    label: 'Pending Verification', desc: 'Your profile is being reviewed by our team. You will be notified once approved.',
    icon: 'M12 8v4M12 16h.01',
  },
  verified: {
    color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20',
    label: 'Verified', desc: 'Your profile is public. Users can find and contact you.',
    icon: 'M20 6L9 17l-5-5',
  },
  suspended: {
    color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20',
    label: 'Suspended', desc: 'Your profile has been suspended. Contact support for more information.',
    icon: 'M18 6L6 18M6 6l12 12',
  },
  rejected: {
    color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20',
    label: 'Rejected', desc: 'Your application was not approved. You can update your profile and reapply.',
    icon: 'M18 6L6 18M6 6l12 12',
  },
};

export default function WorkerDashboard({ profile, onGoToSetup, onLogout }: WorkerDashboardProps) {
  const status = profile.worker_status || 'pending';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const isIncomplete = !profile.worker_occupation || !profile.city;
  const occupationLabel = profile.worker_occupation ? (WORKER_OCCUPATION_LABELS[profile.worker_occupation] || profile.worker_occupation) : 'Not set';

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />

      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg font-bold text-white">Worker Dashboard</h1>
            <button onClick={onLogout} className="text-[10px] text-[#5C5E72] hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10">Logout</button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-4">
        {/* Status Card */}
        <div className={`glass rounded-2xl p-5 border ${config.border}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-xl ${config.bg} flex items-center justify-center flex-shrink-0`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={config.color}>
                <circle cx="12" cy="12" r="10" /><path d={config.icon} /></svg>
            </div>
            <div>
              <h2 className={`text-sm font-semibold ${config.color}`}>{config.label}</h2>
              <p className="text-[10px] text-[#5C5E72]">ID: {profile.user_id}</p>
            </div>
          </div>
          <p className="text-xs text-[#8A8B9C] leading-relaxed">{config.desc}</p>
        </div>

        {/* Profile Card */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">My Profile</h2>
            <button onClick={onGoToSetup}
              className="text-[10px] text-[#3B82F6] hover:text-[#60A5FA] font-medium px-2.5 py-1 rounded-lg bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 transition-colors">
              Edit
            </button>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold glow-blue-sm overflow-hidden">
              {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : (profile.full_name || profile.username || profile.email[0]).charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{profile.full_name || profile.username || 'Worker'}</div>
              <div className="text-[10px] text-[#5C5E72]">@{profile.username || '...'}</div>
            </div>
          </div>

          {isIncomplete && (
            <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-amber-400">Profile incomplete. Please fill in all required fields.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#1A1A24] rounded-xl p-3">
              <div className="text-[10px] text-[#5C5E72]">Occupation</div>
              <div className="text-xs text-white font-medium">{occupationLabel}</div>
            </div>
            <div className="bg-[#1A1A24] rounded-xl p-3">
              <div className="text-[10px] text-[#5C5E72]">Location</div>
              <div className="text-xs text-white font-medium">{profile.city || 'Not set'}{profile.state ? `, ${profile.state}` : ''}</div>
            </div>
            <div className="bg-[#1A1A24] rounded-xl p-3">
              <div className="text-[10px] text-[#5C5E72]">Phone</div>
              <div className="text-xs text-white font-medium">{profile.phone || 'Not set'}</div>
            </div>
            <div className="bg-[#1A1A24] rounded-xl p-3">
              <div className="text-[10px] text-[#5C5E72]">Email</div>
              <div className="text-xs text-white font-medium truncate">{profile.email}</div>
            </div>
          </div>

          {profile.worker_bio && (
            <div className="mt-3">
              <div className="text-[10px] text-[#5C5E72] mb-1">About</div>
              <p className="text-xs text-[#8A8B9C] leading-relaxed">{profile.worker_bio}</p>
            </div>
          )}
        </div>

        {/* Visibility Note */}
        {status === 'verified' && (
          <div className="glass rounded-2xl p-4 border border-green-500/10 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            </div>
            <div>
              <p className="text-sm font-medium text-green-400">You are discoverable</p>
              <p className="text-[11px] text-[#5C5E72] mt-0.5">Users in {profile.city || 'your area'} can find you when searching for {occupationLabel.toLowerCase()}s.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
