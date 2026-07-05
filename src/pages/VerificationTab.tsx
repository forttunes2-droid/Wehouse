import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function VerificationTab() {
  const [pendingWorkers, setPendingWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPendingVerifications();
  }, []);

  async function loadPendingVerifications() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'worker')
      .in('worker_status', ['pending', 'approved_for_verification', 'reviewing'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (!error && data) {
      setPendingWorkers(data);
    }
    setLoading(false);
  }

  async function handleApprove(userId: string) {
    const { error } = await supabase.rpc('admin_update_role', {
      target_user_id: userId,
      new_role: 'worker'
    });
    if (error) {
      alert('Failed: ' + error.message);
      return;
    }
    await supabase.from('profiles').update({ worker_status: 'verified' }).eq('user_id', userId);
    loadPendingVerifications();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (pendingWorkers.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sm text-[#5C5E72]">No pending verifications</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Pending Verifications</h3>
        <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">{pendingWorkers.length} pending</span>
      </div>
      {pendingWorkers.map(w => (
        <div key={w.user_id} className="glass rounded-xl p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-bold">
                {(w.username || 'W').charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-xs font-medium text-white">@{w.username}</p>
                <p className="text-[10px] text-[#5C5E72]">{w.worker_occupation || 'Worker'}</p>
              </div>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
              w.worker_status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
              w.worker_status === 'reviewing' ? 'bg-blue-500/10 text-blue-400' :
              'bg-purple-500/10 text-purple-400'
            }`}>{w.worker_status}</span>
          </div>
          {w.worker_status === 'reviewing' && (
            <button
              onClick={() => handleApprove(w.user_id)}
              className="mt-2 w-full h-8 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-medium border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
            >
              Approve Verification
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
