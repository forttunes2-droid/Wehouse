import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

interface WorkerDetailModalProps {
  worker: Profile | null;
  onClose: () => void;
}

interface WorkerStats {
  skills: string[];
  verificationStatus: string;
  isVerified: boolean;
  totalBookings: number;
  completedBookings: number;
  earnings: number;
  reviewsCount: number;
  avgRating: number;
  pendingPayout: number;
}

export default function WorkerDetailModal({ worker, onClose }: WorkerDetailModalProps) {
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [loading, setLoading] = useState(true);

  const targetWorker = worker;
  useEffect(() => {
    if (!targetWorker) return;
    async function load() {
      setLoading(true);
      const w = targetWorker!;
      const [
        { data: bookings },
        { data: reviews },
        { data: verifications },
      ] = await Promise.all([
        supabase.from('bookings').select('status').eq('worker_id', w.user_id),
        supabase.from('reviews').select('rating').eq('worker_id', w.user_id),
        supabase.from('worker_verifications').select('status').eq('worker_id', w.user_id).order('created_at', { ascending: false }).limit(1),
      ]);

      const completed = (bookings || []).filter(b => b.status === 'completed').length;
      const totalBookings = (bookings || []).length;
      const reviewList = reviews || [];
      const avgRating = reviewList.length > 0
        ? reviewList.reduce((s, r) => s + (r.rating || 0), 0) / reviewList.length
        : 0;

      // Worker data from profile
      const workerData = targetWorker as any;

      setStats({
        skills: workerData.skills ? workerData.skills.split(',').map((s: string) => s.trim()) : [],
        verificationStatus: verifications?.[0]?.status || workerData.verification_status || 'not_submitted',
        isVerified: workerData.is_verified === true,
        totalBookings,
        completedBookings: completed,
        earnings: workerData.total_earnings || 0,
        reviewsCount: reviewList.length,
        avgRating: Math.round(avgRating * 10) / 10,
        pendingPayout: workerData.pending_payout || 0,
      });
      setLoading(false);
    }
    load();
  }, [worker]);

  if (!worker) return null;

  const initials = (worker.username || worker.email[0] || 'W').toUpperCase();
  const workerData = targetWorker as any;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0E0E14] w-full sm:w-[420px] sm:rounded-3xl rounded-t-3xl max-h-[85vh] overflow-y-auto border border-[#232330]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="relative bg-gradient-to-br from-orange-900/30 to-[#0E0E14] px-5 pt-6 pb-8">
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-xl font-bold mb-3">
              {worker.avatar_url ? <img src={worker.avatar_url} className="w-full h-full rounded-2xl object-cover" /> : initials}
            </div>
            <h3 className="text-base font-bold text-white">@{worker.username || 'unknown'}</h3>
            <p className="text-xs text-[#5C5E72] mt-0.5">{worker.email}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
                Worker
              </span>
              {stats?.isVerified && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Verified
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 pb-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Verification Status */}
              <div className="glass rounded-2xl p-4 border border-white/[0.04]">
                <h4 className="text-xs font-semibold text-white mb-2">Verification</h4>
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    stats?.verificationStatus === 'approved' ? 'bg-emerald-400'
                    : stats?.verificationStatus === 'pending' ? 'bg-amber-400'
                    : stats?.verificationStatus === 'rejected' ? 'bg-red-400'
                    : 'bg-[#5C5E72]'
                  }`} />
                  <span className="text-xs text-white/80 capitalize">{stats?.verificationStatus?.replace(/_/g, ' ') || 'Not submitted'}</span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2">
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-white">{stats?.totalBookings || 0}</p>
                  <p className="text-[9px] text-[#5C5E72]">Total Bookings</p>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-emerald-400">{stats?.completedBookings || 0}</p>
                  <p className="text-[9px] text-[#5C5E72]">Completed</p>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-orange-400">₦{(stats?.earnings || 0).toLocaleString()}</p>
                  <p className="text-[9px] text-[#5C5E72]">Earnings</p>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-blue-400">{stats?.avgRating || 0}</p>
                  <p className="text-[9px] text-[#5C5E72]">Rating ({stats?.reviewsCount || 0})</p>
                </div>
              </div>

              {/* Skills */}
              {stats && stats.skills.length > 0 && (
                <div className="glass rounded-2xl p-4">
                  <h4 className="text-xs font-semibold text-white mb-2">Skills</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.skills.map((skill, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-md bg-[#12121A] border border-[#1E1E2C] text-[10px] text-[#8A8B9C]">{skill}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Location */}
              <div className="glass rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-white mb-2">Location</h4>
                <div className="space-y-1.5">
                  {[
                    { label: 'State', value: worker.state || 'Not set' },
                    { label: 'LGA', value: workerData.local_government || workerData.city || 'Not set' },
                    { label: 'Phone', value: workerData.phone || 'Not set' },
                  ].map(item => (
                    <div key={item.label} className="flex justify-between text-xs">
                      <span className="text-[#5C5E72]">{item.label}</span>
                      <span className="text-white/80">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
