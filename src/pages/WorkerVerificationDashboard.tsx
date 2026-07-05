import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import { Toaster, toast } from 'sonner';

interface WorkerVerificationDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
}

type WorkerTab = 'pending' | 'approved_for_verification' | 'suspended' | 'all';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved_for_verification: 'Blue Tick',
  reviewing: 'Reviewing',
  verified: 'Verified',
  suspended: 'Suspended',
  rejected: 'Rejected',
};

export default function WorkerVerificationDashboard({ profile }: WorkerVerificationDashboardProps) {
  const [activeTab, setActiveTab] = useState<WorkerTab>('pending');
  const [workers, setWorkers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  async function loadWorkers() {
    setLoading(true);
    let query = supabase
      .from('profiles')
      .select('*')
      .eq('role', 'worker');

    if (activeTab !== 'all') {
      query = query.eq('worker_status', activeTab);
    }

    const { data } = await query.order('created_at', { ascending: false });
    setWorkers(data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadWorkers();
  }, [activeTab]);

  async function updateStatus(userId: string, status: 'approved_for_verification' | 'suspended' | 'rejected') {
    const { error } = await supabase
      .from('profiles')
      .update({ worker_status: status, worker_verified: status === 'approved_for_verification', updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      toast.error('Failed: ' + error.message);
      return;
    }

    toast.success(`Worker ${status}`);
    loadWorkers();
  }

  const filteredWorkers = workers.filter(w =>
    !search ||
    w.email?.toLowerCase().includes(search.toLowerCase()) ||
    w.username?.toLowerCase().includes(search.toLowerCase()) ||
    w.full_name?.toLowerCase().includes(search.toLowerCase())
  );

  const counts: Record<string, number> = {
    pending: workers.filter(w => w.worker_status === 'pending').length,
    approved_for_verification: workers.filter(w => w.worker_status === 'approved_for_verification').length,
    suspended: workers.filter(w => w.worker_status === 'suspended').length,
    all: workers.length,
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      <Toaster position="top-center" richColors />
      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <h1 className="text-lg font-bold text-white">Worker Verification</h1>
        <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 px-5 py-4">
        {(['pending', 'approved_for_verification', 'suspended'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-2xl p-3 text-center transition-all ${
              activeTab === tab
                ? 'bg-[#3B82F6]/10 border border-[#3B82F6]/30'
                : 'bg-[#12121A]/60 border border-white/[0.04]'
            }`}
          >
            <p className={`text-lg font-bold ${activeTab === tab ? 'text-[#3B82F6]' : 'text-white'}`}>{counts[tab] ?? 0}</p>
            <p className="text-[9px] text-[#5C5E72]">{STATUS_LABELS[tab] || tab}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-5 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search workers..."
          className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 placeholder:text-[#5C5E72] outline-none focus:border-[#3B82F6]"
        />
      </div>

      {/* Worker List */}
      <main className="px-5 space-y-3">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredWorkers.length === 0 ? (
          <div className="text-center py-10 text-[#5C5E72] text-sm">No {activeTab} workers</div>
        ) : (
          filteredWorkers.map(w => (
            <WorkerCard key={w.user_id} worker={w} onUpdateStatus={updateStatus} />
          ))
        )}
      </main>
    </div>
  );
}

// ─── WORKER CARD ───────────────────────────────────
function WorkerCard({ worker, onUpdateStatus }: { worker: Profile; onUpdateStatus: (id: string, status: 'approved_for_verification' | 'suspended' | 'rejected') => void }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = worker.worker_status === 'approved_for_verification' ? 'text-emerald-400 bg-emerald-500/10' :
    worker.worker_status === 'pending' ? 'text-amber-400 bg-amber-500/10' :
    'text-red-400 bg-red-500/10';

  return (
    <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full p-4 text-left">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1A1A24] flex items-center justify-center text-sm font-bold text-[#5C5E72]">
            {(worker.full_name || worker.username || worker.email)[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white truncate">{worker.full_name || worker.username || 'Unnamed'}</p>
              <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${statusColor}`}>
                {STATUS_LABELS[worker.worker_status || ''] || worker.worker_status}
              </span>
            </div>
            <p className="text-[10px] text-[#5C5E72]">{worker.email}</p>
            <p className="text-[9px] text-[#5C5E72]">
              {WORKER_OCCUPATION_LABELS[worker.worker_occupation || ''] || worker.worker_occupation || 'No occupation'} &middot; {worker.city || 'No location'}
            </p>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.04] pt-3">
          {worker.worker_bio && (
            <p className="text-[11px] text-[#8A8B9C]">{worker.worker_bio}</p>
          )}
          <div className="grid grid-cols-2 gap-2 text-[10px] text-[#5C5E72]">
            <span>Phone: {worker.phone || 'N/A'}</span>
            <span>State: {worker.state || 'N/A'}</span>
            <span>Verified: {worker.worker_verified ? 'Yes' : 'No'}</span>
            <span>Joined: {new Date(worker.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex gap-2">
            {worker.worker_status !== 'approved_for_verification' && (
              <button
                onClick={() => onUpdateStatus(worker.user_id, 'approved_for_verification')}
                className="flex-1 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold hover:bg-emerald-500/20"
              >
                Verify
              </button>
            )}
            {worker.worker_status !== 'suspended' && (
              <button
                onClick={() => onUpdateStatus(worker.user_id, 'suspended')}
                className="flex-1 h-9 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-[11px] font-semibold hover:bg-red-500/20"
              >
                Suspend
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
