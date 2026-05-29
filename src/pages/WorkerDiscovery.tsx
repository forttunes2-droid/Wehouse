import { useState, useEffect } from 'react';
import { getWorkers, getOrCreateConversation } from '@/lib/supabase';
import { WORKER_OCCUPATIONS, WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile } from '@/types';
import { toast, Toaster } from 'sonner';
import VerifiedBadge from '@/components/VerifiedBadge';

interface WorkerDiscoveryProps {
  userCity?: string | null;
  profile?: Profile | null;
  onGoToChat?: (convId: string) => void;
}

export default function WorkerDiscovery({ userCity, profile, onGoToChat }: WorkerDiscoveryProps) {
  const [workers, setWorkers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [occupation, setOccupation] = useState('');
  const [city, setCity] = useState(userCity || '');

  useEffect(() => {
    loadWorkers();
  }, [occupation, city]);

  async function handleChatWithWorker(workerId: string) {
    if (!profile) { toast.error('Please log in to chat'); return; }
    if (workerId === profile.user_id) { toast.error('Cannot chat with yourself'); return; }
    const { conversation, error } = await getOrCreateConversation(profile.user_id, workerId);
    if (error) { toast.error('Failed to start chat'); return; }
    if (conversation && onGoToChat) {
      onGoToChat(conversation.id);
    } else {
      toast.success('Chat started!');
    }
  }

  async function loadWorkers() {
    setLoading(true);
    const { workers: data } = await getWorkers({
      ...(occupation ? { occupation } : {}),
      ...(city ? { city } : {}),
      status: 'verified',
    });
    // Sort: same city first
    const sorted = [...(data || [])].sort((a, b) => {
      if (city) {
        const aMatch = a.city === city;
        const bMatch = b.city === city;
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
      }
      return 0;
    });
    setWorkers(sorted);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto">
          <h1 className="text-lg font-bold text-white mb-1">Find Workers</h1>
          <p className="text-xs text-[#5C5E72]">Book verified service providers near you</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-4">
        {/* Occupation Filter */}
        <div>
          <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-2 block">Filter by Occupation</label>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setOccupation('')}
              className={!occupation ? 'h-8 px-3 rounded-full text-[11px] font-medium transition-all bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white' : 'h-8 px-3 rounded-full text-[11px] font-medium transition-all bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'}>All</button>
            {WORKER_OCCUPATIONS.map(occ => (
              <button key={occ} onClick={() => setOccupation(occupation === occ ? '' : occ)}
                className={occupation === occ ? 'h-8 px-3 rounded-full text-[11px] font-medium transition-all bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white' : 'h-8 px-3 rounded-full text-[11px] font-medium transition-all bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'}>
                {WORKER_OCCUPATION_LABELS[occ]}
              </button>
            ))}
          </div>
        </div>

        {/* City Input */}
        <div>
          <label className="text-[10px] text-[#5C5E72] uppercase tracking-wider font-medium mb-1.5 block">City</label>
          <input value={city} onChange={e => setCity(e.target.value)} placeholder={userCity || 'Enter city...'}
            className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none" />
        </div>

        {/* Results */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="glass rounded-2xl p-4 flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#1A1A24] shimmer flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-[#1A1A24] shimmer rounded w-1/3" />
                  <div className="h-2.5 bg-[#1A1A24] shimmer rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : workers.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            </div>
            <p className="text-sm text-[#8A8B9C]">No workers found</p>
            <p className="text-xs text-[#8A8B9C]/70 mt-1">{city ? `Try a different city or occupation` : 'Enter a city to search'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">{workers.length} worker{workers.length !== 1 ? 's' : ''} found</p>
            {workers.map(w => (
              <div key={w.user_id} className="glass rounded-2xl p-4 hover:border-[#3B82F6]/20 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
                    {w.avatar_url ? <img src={w.avatar_url} alt="" className="w-full h-full object-cover rounded-2xl" /> : (w.full_name || w.username || 'W').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">{w.full_name || w.username || 'Worker'}</div>
                    <div className="text-[10px] text-[#5C5E72] flex items-center gap-1">
                      <span className="px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20 text-[9px] font-medium">
                        {WORKER_OCCUPATION_LABELS[w.worker_occupation || ''] || w.worker_occupation}
                      </span>
                      {w.city && <span>· {w.city}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <VerifiedBadge size={14} />
                    <span className="text-[9px] text-[#1DA1F2] font-medium">Verified</span>
                  </div>
                </div>
                {w.worker_bio && <p className="text-xs text-[#8A8B9C] mt-2 line-clamp-2">{w.worker_bio}</p>}
                <div className="flex items-center gap-2 mt-2">
                  {w.phone && (
                    <a href={`tel:${w.phone}`} className="inline-flex items-center gap-1 text-[11px] text-[#3B82F6] hover:text-[#60A5FA] transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                      Call
                    </a>
                  )}
                  {profile && (
                    <button
                      onClick={() => handleChatWithWorker(w.user_id)}
                      className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                      Chat
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
