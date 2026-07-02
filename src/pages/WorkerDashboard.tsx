import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile } from '@/types';
import { Toaster } from 'sonner';

interface WorkerDashboardProps {
  profile: Profile;
  onGoToSetup: () => void;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string; desc: string; icon: string }> = {
  pending: {
    color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20',
    label: 'Pending Verification', desc: 'Your profile is being reviewed. You will be notified once approved.',
    icon: 'M12 8v4M12 16h.01',
  },
  verified: {
    color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20',
    label: 'Verified', desc: 'You are discoverable. Users in your area can find and book you.',
    icon: 'M20 6L9 17l-5-5',
  },
  suspended: {
    color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20',
    label: 'Suspended', desc: 'Contact support@wehouse.com.ng for more information.',
    icon: 'M18 6L6 18M6 6l12 12',
  },
  rejected: {
    color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20',
    label: 'Rejected', desc: 'Update your profile and try again.',
    icon: 'M18 6L6 18M6 6l12 12',
  },
};

export default function WorkerDashboard({ profile, onGoToSetup, onLogout, onNavigate }: WorkerDashboardProps) {
  const status = profile.worker_status || 'pending';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const isIncomplete = !profile.worker_occupation || !profile.city;
  const occupationLabel = profile.worker_occupation ? (WORKER_OCCUPATION_LABELS[profile.worker_occupation] || profile.worker_occupation) : 'Not set';
  const [viewCount, setViewCount] = useState(0);
  const [jobCount, setJobCount] = useState(0);

  useEffect(() => {
    async function loadStats() {
      const { count: views } = await supabase
        .from('worker_views').select('*', { count: 'exact', head: true })
        .eq('worker_id', profile.user_id);
      const { count: jobs } = await supabase
        .from('conversations').select('*', { count: 'exact', head: true })
        .or(`participant_a.eq.${profile.user_id},participant_b.eq.${profile.user_id}`);
      setViewCount(views || 0);
      setJobCount(jobs || 0);
    }
    loadStats();
  }, [profile.user_id]);

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => onNavigate?.('home')}
            className="w-9 h-9 rounded-xl bg-[#1A1A24] border border-[#232330] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-all">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">Worker Dashboard</h1>
            <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
          </div>
          <button onClick={onLogout} className="text-[10px] text-[#5C5E72] hover:text-white px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors">Logout</button>
        </div>
      </header>

      <div className="px-5 py-4 space-y-4 max-w-lg mx-auto">
        {/* Status Banner */}
        <div className={`rounded-2xl ${config.bg} border ${config.border} p-4`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${config.bg} flex items-center justify-center flex-shrink-0`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={config.color}>
                <circle cx="12" cy="12" r="10" /><path d={config.icon} /></svg>
            </div>
            <div>
              <h2 className={`text-sm font-semibold ${config.color}`}>{config.label}</h2>
              <p className="text-[10px] text-[#5C5E72]">{config.desc}</p>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Views" value={viewCount} color="blue" />
          <StatCard label="Jobs" value={jobCount} color="emerald" />
          <StatCard label="Rating" value="—" color="amber" />
        </div>

        {/* Profile Card */}
        <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">My Profile</h2>
            <button onClick={onGoToSetup}
              className="text-[10px] text-[#3B82F6] font-semibold px-3 py-1.5 rounded-lg bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 transition-colors">
              Edit Profile
            </button>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold overflow-hidden">
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
            <InfoCell label="Occupation" value={occupationLabel} />
            <InfoCell label="Location" value={`${profile.city || '—'}${profile.state ? `, ${profile.state}` : ''}`} />
            <InfoCell label="Phone" value={profile.phone || 'Not set'} />
            <InfoCell label="Email" value={profile.email} />
          </div>

          {profile.worker_bio && (
            <div className="mt-3 pt-3 border-t border-white/[0.04]">
              <div className="text-[10px] text-[#5C5E72] mb-1">About</div>
              <p className="text-xs text-[#8A8B9C] leading-relaxed">{profile.worker_bio}</p>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <ActionButton label="Edit Profile" icon="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" onClick={onGoToSetup} />
            <ActionButton label="Find Work" icon="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" onClick={() => onNavigate?.('worker_discovery')} />
          </div>
        </div>

        {/* Visibility Note */}
        {status === 'verified' && (
          <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/10 p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-400">You are discoverable</p>
              <p className="text-[11px] text-[#5C5E72] mt-0.5">Users in {profile.city || 'your area'} can find you when searching for {occupationLabel.toLowerCase()}s.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500/10 to-blue-600/5 text-blue-400 border-blue-500/20',
    emerald: 'from-emerald-500/10 to-emerald-600/5 text-emerald-400 border-emerald-500/20',
    amber: 'from-amber-500/10 to-amber-600/5 text-amber-400 border-amber-500/20',
  };
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${colorMap[color]} border p-4 text-center`}>
      <p className="text-lg font-extrabold">{value}</p>
      <p className="text-[9px] mt-1 opacity-70">{label}</p>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#1A1A24] rounded-xl p-3">
      <div className="text-[10px] text-[#5C5E72]">{label}</div>
      <div className="text-xs text-white font-medium truncate">{value}</div>
    </div>
  );
}

function ActionButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 flex flex-col items-center gap-2 text-center hover:bg-white/[0.02] transition-colors active:scale-[0.98]">
      <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d={icon} /></svg>
      </div>
      <span className="text-xs font-semibold text-white">{label}</span>
    </button>
  );
}
