import { useState, useEffect } from 'react';
import { findMatches } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster } from 'sonner';

interface RoommateMatchesProps {
  profile: Profile;
}

export default function RoommateMatches({ profile }: RoommateMatchesProps) {
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { matches: data } = await findMatches(profile.user_id);
      setMatches(data || []);
      setLoading(false);
    }
    load();
  }, [profile.user_id, profile.auth_id]);

  function getScoreColor(score: number) {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-red-400';
  }

  function getScoreLabel(score: number) {
    if (score >= 70) return 'High Match';
    if (score >= 40) return 'Medium Match';
    return 'Low Match';
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4">
        <h1 className="text-base font-semibold">Your Matches</h1>
        <p className="text-[10px] text-[#8A8B9C]">@{profile.username}</p>
      </header>

      <div className="max-w-lg mx-auto px-5 py-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-[#12121A] border border-white/[0.04] rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#1A1A24] shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-[#1A1A24] shimmer rounded w-1/3" />
                    <div className="h-2.5 bg-[#1A1A24] shimmer rounded w-1/2" />
                  </div>
                </div>
                <div className="h-2 bg-[#1A1A24] shimmer rounded w-full" />
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-2 bg-[#1A1A24] shimmer rounded" />
                  <div className="h-2 bg-[#1A1A24] shimmer rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : matches.length === 0 ? (
          <div className="text-center py-16 bg-[#12121A] border border-white/[0.04] rounded-2xl">
            <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
            <p className="text-sm text-[#8A8B9C]">No matches yet</p>
            <p className="text-xs text-[#8A8B9C]/70 mt-1">Complete your roommate profile to find matches</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[#8A8B9C] mb-2">{matches.length} match{matches.length !== 1 ? 'es' : ''} found</p>
            {matches.map((m, i) => (
              <div key={i} className="bg-[#12121A] border border-white/[0.04] rounded-2xl p-4 hover:border-[#3B82F6]/20 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#1E3A5F] flex items-center justify-center text-white text-sm font-bold">
                    {(m.profiles?.username || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">@{m.profiles?.username || 'user'}</div>
                    <div className="text-[10px] text-[#8A8B9C] capitalize">{m.gender} · {m.study_level || 'Student'}</div>
                  </div>
                  <div className={`text-white text-[10px] font-bold px-2 py-1 rounded-full ${getScoreColor(m.match_score)}`}>
                    {m.match_score}%
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 rounded-full bg-[#1A1A24] overflow-hidden">
                    <div className={`h-full rounded-full ${getScoreColor(m.match_score)}`} style={{ width: `${m.match_score}%` }} />
                  </div>
                  <span className="text-[10px] text-[#8A8B9C]">{getScoreLabel(m.match_score)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-[#8A8B9C]">
                  <div><span className="text-white font-medium">Budget:</span> ₦{m.budget_min?.toLocaleString()}-₦{m.budget_max?.toLocaleString()}</div>
                  <div><span className="text-white font-medium">Area:</span> {m.area_preference || 'Any'}</div>
                  <div><span className="text-white font-medium">Noise:</span> {m.noise_level}</div>
                  <div><span className="text-white font-medium">Clean:</span> {m.cleanliness}</div>
                  <div><span className="text-white font-medium">Sleep:</span> {m.sleep_time}</div>
                  <div><span className="text-white font-medium">Visitors:</span> {m.visitors}</div>
                </div>

                {m.bio && <p className="text-[10px] text-[#8A8B9C] mt-2 italic">{m.bio}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
