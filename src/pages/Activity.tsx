import { useState, useEffect, useCallback } from 'react';
import { getAllListings, supabase } from '@/lib/supabase';
import type { Listing, Profile } from '@/types';

interface ActivityProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
}

export default function Activity({ profile: _profile, onNavigate, savedIds: _savedIds, onToggleSave: _onToggleSave }: ActivityProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentUsers, setRecentUsers] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const { listings: data } = await getAllListings();
      setListings(data || []);

      // Get recent user activity
      const { data: users } = await supabase
        .from('profiles')
        .select('username, city, state, created_at')
        .eq('deleted', false)
        .order('created_at', { ascending: false })
        .limit(5);
      setRecentUsers(users || []);
    } catch {
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const availableListings = listings.filter(l => l.status === 'available');
  const newThisWeek = listings.filter(l => {
    const created = new Date(l.created_at);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return created > weekAgo;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] pb-24">
        <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
          <div className="h-7 w-32 rounded-lg shimmer" />
        </header>
        <div className="px-5 space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-2xl shimmer" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <h1 className="text-lg font-bold text-white">Activity</h1>
        <p className="text-xs text-[#5C5E72] mt-1">What&apos;s happening on WeHouse</p>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Listings', value: listings.length, color: 'text-[#3B82F6]' },
            { label: 'Available', value: availableListings.length, color: 'text-green-400' },
            { label: 'New This Week', value: newThisWeek.length, color: 'text-amber-400' },
          ].map(stat => (
            <div key={stat.label} className="glass rounded-2xl p-3 text-center">
              <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-[9px] text-[#5C5E72] mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Recently Added Listings */}
        {newThisWeek.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-white">New This Week</h2>
              <button onClick={() => onNavigate('search')} className="text-[10px] text-[#3B82F6] font-semibold">View all</button>
            </div>
            <div className="space-y-2.5">
              {newThisWeek.slice(0, 4).map(l => (
                <button
                  key={l.id}
                  onClick={() => onNavigate('detail', l.id)}
                  className="w-full glass rounded-2xl p-3 flex items-center gap-3 text-left card-hover group"
                >
                  <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-[#1A1A24]">
                    <img src={l.images?.[0] || 'https://placehold.co/200x200/1A1A24/5C5E72?text=No+Image'} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate group-hover:text-[#3B82F6] transition-colors">{l.title}</p>
                    <p className="text-[10px] text-[#5C5E72] truncate">{l.city}{l.state ? `, ${l.state}` : ''}</p>
                    <p className="text-xs font-bold text-white mt-0.5">
                      {l.price >= 1000000 ? `₦${(l.price / 1000000).toFixed(1)}M` : `₦${(l.price / 1000).toFixed(0)}k`}
                      <span className="text-[8px] text-[#5C5E72] font-normal">/yr</span>
                    </p>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* New Users */}
        {recentUsers.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-white mb-3">New Members</h2>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
              {recentUsers.map((u, i) => (
                <div key={i} className="flex-shrink-0 glass rounded-2xl p-3 text-center w-[100px]">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-sm font-bold mx-auto mb-2">
                    {(u.username || 'U').charAt(0).toUpperCase()}
                  </div>
                  <p className="text-[10px] text-white font-medium truncate">@{u.username || 'user'}</p>
                  <p className="text-[8px] text-[#5C5E72] truncate">{u.city || 'Nigeria'}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {listings.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <p className="text-sm text-[#5C5E72]">No activity yet</p>
            <p className="text-xs text-[#5C5E72] mt-1">Check back soon for new listings</p>
          </div>
        )}
      </div>
    </div>
  );
}
