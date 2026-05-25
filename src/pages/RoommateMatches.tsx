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
    <div className="min-h-screen bg-[#FAF8F5] pb-20">
      <Toaster position="top-center" richColors />
      <header className="bg-[#0F1724] text-white px-5 py-4">
        <h1 className="text-base font-semibold">Your Matches</h1>
        <p className="text-[10px] text-white/50">@{profile.username}</p>
      </header>

      <div className="max-w-lg mx-auto px-5 py-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : matches.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl">
            <div className="w-14 h-14 rounded-full bg-[#f0eeea] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8B8680" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
            <p className="text-sm text-[#8B8680]">No matches yet</p>
            <p className="text-xs text-[#8B8680] mt-1">Complete your roommate profile to find matches</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[#8B8680] mb-2">{matches.length} match{matches.length !== 1 ? 'es' : ''} found</p>
            {matches.map((m, i) => (
              <div key={i} className="bg-white rounded-2xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full bg-[#0F1724] flex items-center justify-center text-[#C8A45A] text-sm font-bold">
                    {(m.profiles?.username || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#0F1724]">@{m.profiles?.username || 'user'}</div>
                    <div className="text-[10px] text-[#8B8680] capitalize">{m.gender} · {m.study_level || 'Student'}</div>
                  </div>
                  <div className={`text-white text-[10px] font-bold px-2 py-1 rounded-full ${getScoreColor(m.match_score)}`}>
                    {m.match_score}%
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 rounded-full bg-[#f0eeea] overflow-hidden">
                    <div className={`h-full rounded-full ${getScoreColor(m.match_score)}`} style={{ width: `${m.match_score}%` }} />
                  </div>
                  <span className="text-[10px] text-[#8B8680]">{getScoreLabel(m.match_score)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-[#8B8680]">
                  <div><span className="text-[#0F1724] font-medium">Budget:</span> ₦{m.budget_min?.toLocaleString()}-₦{m.budget_max?.toLocaleString()}</div>
                  <div><span className="text-[#0F1724] font-medium">Area:</span> {m.area_preference || 'Any'}</div>
                  <div><span className="text-[#0F1724] font-medium">Noise:</span> {m.noise_level}</div>
                  <div><span className="text-[#0F1724] font-medium">Clean:</span> {m.cleanliness}</div>
                  <div><span className="text-[#0F1724] font-medium">Sleep:</span> {m.sleep_time}</div>
                  <div><span className="text-[#0F1724] font-medium">Visitors:</span> {m.visitors}</div>
                </div>

                {m.bio && <p className="text-[10px] text-[#8B8680] mt-2 italic">{m.bio}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
