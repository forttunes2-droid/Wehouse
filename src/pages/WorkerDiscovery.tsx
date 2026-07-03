import { useState, useEffect } from 'react';
import { getWorkers, getCategoryWithSubcategories, getOrCreateConversation } from '@/lib/supabase';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile, ServiceCategory } from '@/types';
import { toast, Toaster } from 'sonner';

interface WorkerDiscoveryProps {
  userCity?: string | null;
  profile?: Profile | null;
  onGoToChat?: (convId: string) => void;
}

export default function WorkerDiscovery({ userCity, profile, onGoToChat }: WorkerDiscoveryProps) {
  const [allWorkers, setAllWorkers] = useState<Profile[]>([]);
  const [filteredWorkers, setFilteredWorkers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [nearbyOnly, setNearbyOnly] = useState(true);
  const [categories, setCategories] = useState<(ServiceCategory & { subcategories: any[] })[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Fetch all workers and categories on mount
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      // Fetch workers
      const { workers: data, error: wErr } = await getWorkers({});
      if (wErr) {
        setError('Failed to load workers: ' + wErr.message);
        setLoading(false);
        return;
      }

      const workerList = data || [];
      setAllWorkers(workerList);

      // Fetch service categories for quick filters
      const { categories: cats } = await getCategoryWithSubcategories();
      setCategories(cats || []);

      setLoading(false);
    }
    load();
  }, []);

  // Filter workers whenever search, nearby, or category changes
  useEffect(() => {
    let result = [...allWorkers];

    // Filter by user's city if nearby mode is on
    if (nearbyOnly && userCity) {
      result = result.filter(w =>
        w.city?.toLowerCase().trim() === userCity.toLowerCase().trim()
      );
    }

    // Filter by selected category
    if (selectedCategory) {
      result = result.filter(w => {
        const occ = (w.worker_occupation || '').toLowerCase();
        const bio = (w.worker_bio || '').toLowerCase();
        const catName = selectedCategory.toLowerCase();
        return occ.includes(catName) || bio.includes(catName);
      });
    }

    // Free-text search (name, occupation, bio, city)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(w => {
        const name = (w.full_name || w.username || '').toLowerCase();
        const occ = (w.worker_occupation || '').toLowerCase();
        const occLabel = (WORKER_OCCUPATION_LABELS[w.worker_occupation || ''] || '').toLowerCase();
        const bio = (w.worker_bio || '').toLowerCase();
        const city = (w.city || '').toLowerCase();
        return name.includes(q) || occ.includes(q) || occLabel.includes(q) || bio.includes(q) || city.includes(q);
      });
    }

    // Sort: nearby first, then by name
    result.sort((a, b) => {
      if (userCity) {
        const aNear = a.city?.toLowerCase().trim() === userCity.toLowerCase().trim();
        const bNear = b.city?.toLowerCase().trim() === userCity.toLowerCase().trim();
        if (aNear && !bNear) return -1;
        if (!aNear && bNear) return 1;
      }
      return (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '');
    });

    setFilteredWorkers(result);
  }, [allWorkers, searchQuery, nearbyOnly, selectedCategory, userCity]);

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

  const activeFiltersCount = (nearbyOnly && userCity ? 1 : 0) + (selectedCategory ? 1 : 0) + (searchQuery.trim() ? 1 : 0);

  const clearAllFilters = () => {
    setSearchQuery('');
    setNearbyOnly(false);
    setSelectedCategory(null);
  };

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-4">
        <div className="max-w-lg mx-auto">
          <h1 className="text-lg font-bold text-white mb-1">Find Workers</h1>
          <p className="text-xs text-[#5C5E72]">
            {userCity ? `Searching in ${userCity}` : 'Search verified workers'}
          </p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-4">
        {/* ─── SEARCH BAR ─── */}
        <div className="relative">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className="absolute left-3.5 top-1/2 -translate-y-1/2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by name, occupation, or skill..."
            className="w-full h-11 pl-10 pr-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C5E72] hover:text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        {/* ─── LOCATION BAR ─── */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs text-white truncate">
              {userCity || 'No location set'}
            </span>
          </div>
          <button
            onClick={() => setNearbyOnly(!nearbyOnly)}
            className={`px-3 py-2 rounded-xl text-[11px] font-medium transition-all border ${
              nearbyOnly
                ? 'bg-[#3B82F6]/15 border-[#3B82F6]/30 text-[#3B82F6]'
                : 'bg-[#1A1A24] border-[#2A2A3A] text-[#5C5E72] hover:text-white'
            }`}
          >
            {nearbyOnly ? 'Nearby' : 'All Locations'}
          </button>
        </div>

        {/* ─── CATEGORY CHIPS ─── */}
        {categories.length > 0 && (
          <div>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={!selectedCategory
                  ? 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white'
                  : 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(selectedCategory === cat.name ? null : cat.name)}
                  className={selectedCategory === cat.name
                    ? 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white'
                    : 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                  }
                >
                  {cat.icon} {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── ACTIVE FILTERS & COUNT ─── */}
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">
            {!loading && `${filteredWorkers.length} worker${filteredWorkers.length !== 1 ? 's' : ''} found`}
            {loading && 'Loading...'}
          </p>
          {activeFiltersCount > 0 && (
            <button onClick={clearAllFilters} className="text-[10px] text-[#3B82F6] hover:text-[#60A5FA]">
              Clear filters
            </button>
          )}
        </div>

        {/* ─── ERROR STATE ─── */}
        {error && (
          <div className="rounded-2xl bg-red-500/5 border border-red-500/20 p-4 text-center">
            <p className="text-xs text-red-400">{error}</p>
            <button onClick={() => window.location.reload()} className="mt-2 text-[10px] text-[#3B82F6]">Retry</button>
          </div>
        )}

        {/* ─── RESULTS ─── */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-2xl p-4 bg-[#12121A] border border-[#1E1E2C] flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#1A1A24] shimmer flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-[#1A1A24] shimmer rounded w-1/3" />
                  <div className="h-2.5 bg-[#1A1A24] shimmer rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredWorkers.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            </div>
            <p className="text-sm text-[#8A8B9C]">No workers found</p>
            <p className="text-xs text-[#8A8B9C]/70 mt-1">
              {allWorkers.length === 0
                ? 'No workers have signed up yet'
                : nearbyOnly && userCity
                  ? `No workers in ${userCity}. Try "All Locations"`
                  : 'Try adjusting your search'
              }
            </p>
            {allWorkers.length > 0 && nearbyOnly && userCity && (
              <button onClick={() => setNearbyOnly(false)} className="mt-3 px-4 py-2 rounded-xl bg-[#3B82F6]/15 text-[#3B82F6] text-xs font-medium">
                Show all locations
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredWorkers.map(w => (
              <div key={w.user_id} className="rounded-2xl p-4 bg-[#12121A] border border-[#1E1E2C] hover:border-[#3B82F6]/20 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold flex-shrink-0 overflow-hidden">
                    {w.avatar_url ? <img src={w.avatar_url} alt="" className="w-full h-full object-cover" /> : (w.full_name || w.username || 'W').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">{w.full_name || w.username || 'Worker'}</div>
                    <div className="text-[10px] text-[#5C5E72] flex items-center gap-1 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20 text-[9px] font-medium">
                        {WORKER_OCCUPATION_LABELS[w.worker_occupation || ''] || w.worker_occupation || 'General'}
                      </span>
                      {w.city && (
                        <span className="flex items-center gap-0.5">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                          {w.city}
                          {userCity && w.city?.toLowerCase().trim() === userCity.toLowerCase().trim() && (
                            <span className="text-[8px] text-emerald-400 ml-0.5">· Nearby</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {w.worker_bio && <p className="text-xs text-[#8A8B9C] mt-2 line-clamp-2">{w.worker_bio}</p>}
                <div className="flex items-center gap-3 mt-2">
                  {w.phone && (
                    <a href={`tel:${w.phone}`} className="inline-flex items-center gap-1 text-[11px] text-[#3B82F6] hover:text-[#60A5FA] transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                      Call
                    </a>
                  )}
                  {profile && (
                    <button onClick={() => handleChatWithWorker(w.user_id)} className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors">
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
