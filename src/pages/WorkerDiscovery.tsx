import { useState, useEffect, useMemo } from 'react';
import { getAllWorkers, getCategoryWithSubcategories, getOrCreateConversation, supabase } from '@/lib/supabase';
import { WORKER_OCCUPATION_LABELS } from '@/types';
import type { Profile, ServiceCategory } from '@/types';
import { toast, Toaster } from 'sonner';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';
import WorkerBookingFlow from '@/components/WorkerBookingFlow';

interface WorkerDiscoveryProps {
  userCity?: string | null;
  profile?: Profile | null;
  onGoToChat?: (convId: string) => void;
  onNavigate?: (page: string) => void;
  preSelectedCategory?: string | null;
}

export default function WorkerDiscovery({ userCity, profile, onGoToChat, onNavigate, preSelectedCategory }: WorkerDiscoveryProps) {
  const [allWorkers, setAllWorkers] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<(ServiceCategory & { subcategories: any[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(preSelectedCategory || null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [expandedBio, setExpandedBio] = useState<Set<string>>(new Set());

  // Booking modal
  const [bookingWorker, setBookingWorker] = useState<Profile | null>(null);
  // Track which workers user has sent booking requests to
  const [bookedWorkers, setBookedWorkers] = useState<Set<string>>(new Set());

  // Apply pre-selected category when navigating from WorkerCategories
  useEffect(() => {
    if (preSelectedCategory) {
      setSelectedCategory(preSelectedCategory);
    }
  }, [preSelectedCategory]);

  // ─── FETCH WORKERS ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setFetchError(null);

      try {
        // Use getAllWorkers — same function Creator Dashboard uses (proven working)
        const { workers: data, error: wErr } = await getAllWorkers();

        if (cancelled) return;

        if (wErr) {
          setFetchError(wErr.message || 'Failed to load workers');
          setAllWorkers([]);
        } else {
          setAllWorkers(data || []);
        }

        // Fetch categories separately — don't block workers if this fails
        try {
          const { categories: cats } = await getCategoryWithSubcategories();
          if (!cancelled) setCategories(cats || []);
        } catch {
          // Categories are optional — don't fail if this errors
        }
      } catch (err: any) {
        if (!cancelled) setFetchError(err?.message || 'Unexpected error loading workers');
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ─── FILTER WORKERS ───────────────────────────────────
  const filteredWorkers = useMemo(() => {
    // ONLY show verified workers to the public
    let result = allWorkers.filter(w => w.worker_status === 'verified');

    // State filter
    if (selectedState) {
      const citiesInState = getCitiesForState(selectedState);
      result = result.filter(w => citiesInState.includes(w.city || ''));
    }

    // City/LGA filter
    if (selectedCity) {
      result = result.filter(w => (w.city || '').toLowerCase().trim() === selectedCity.toLowerCase().trim());
    }

    // Category filter
    if (selectedCategory) {
      const catLower = selectedCategory.toLowerCase();
      result = result.filter(w => {
        const occ = (w.worker_occupation || '').toLowerCase();
        const bio = (w.worker_bio || '').toLowerCase();
        return occ.includes(catLower) || bio.includes(catLower);
      });
    }

    // Subcategory filter
    if (selectedSubcategory) {
      const subLower = selectedSubcategory.toLowerCase();
      result = result.filter(w => {
        const occ = (w.worker_occupation || '').toLowerCase();
        const skills = ((w.worker_skills as string[]) || []).join(' ').toLowerCase();
        const bio = (w.worker_bio || '').toLowerCase();
        return occ.includes(subLower) || skills.includes(subLower) || bio.includes(subLower);
      });
    }

    // Free-text search
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

    // Sort: same city first, then by name
    result.sort((a, b) => {
      if (userCity) {
        const aSameCity = (a.city || '').toLowerCase().trim() === userCity.toLowerCase().trim();
        const bSameCity = (b.city || '').toLowerCase().trim() === userCity.toLowerCase().trim();
        if (aSameCity && !bSameCity) return -1;
        if (!aSameCity && bSameCity) return 1;
      }
      return (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '');
    });

    return result;
  }, [allWorkers, searchQuery, selectedState, selectedCity, selectedCategory, selectedSubcategory, userCity]);

  // ─── HANDLERS ─────────────────────────────────────────
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

  // ─── Worker Stats (jobs done + rating) ──────────
function WorkerStats({ workerId }: { workerId: string }) {
  const [stats, setStats] = useState({ completedJobs: 0, avgRating: 0 });

  useEffect(() => {
    async function load() {
      const { count: jobs } = await supabase
        .from('worker_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('worker_id', workerId)
        .eq('status', 'approved_released');

      const { data: reviews } = await supabase
        .from('reviews')
        .select('rating')
        .eq('reviewee_id', workerId);

      const avg = reviews && reviews.length > 0
        ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length)
        : 0;

      setStats({ completedJobs: jobs || 0, avgRating: avg });
    }
    load();
  }, [workerId]);

  return (
    <div className="flex items-center gap-3 mt-1">
      <span className="text-[9px] text-[#5C5E72] flex items-center gap-0.5">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
        {stats.avgRating > 0 ? stats.avgRating.toFixed(1) : 'No ratings'}
      </span>
      <span className="text-[9px] text-[#5C5E72]">·</span>
      <span className="text-[9px] text-[#5C5E72]">{stats.completedJobs} jobs done</span>
    </div>
  );
}

const citiesForSelectedState = useMemo(() => getCitiesForState(selectedState), [selectedState]);
  const hasActiveFilters = selectedState !== '' || selectedCity !== '' || selectedCategory !== null || selectedSubcategory !== null || searchQuery.trim() !== '';

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-4">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => onNavigate?.('worker_categories')}
              className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white transition-colors flex-shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="text-lg font-bold text-white">Find Workers</h1>
          </div>
          <p className="text-xs text-[#5C5E72]">
            {loading ? 'Loading workers...' : `${filteredWorkers.length} of ${allWorkers.length} workers`}
            {selectedCategory ? ` · Category: ${selectedCategory}${selectedSubcategory ? ` › ${selectedSubcategory}` : ''}` : ''}
            {userCity ? ` · Near: ${userCity}` : ''}
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
            placeholder="Search by name, occupation, skill..."
            className="w-full h-11 pl-10 pr-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C5E72] hover:text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        {/* ─── LOCATION: State → City cascading dropdowns ─── */}
        <div className="space-y-2">
          <label className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">Location</label>
          <div className="flex gap-2">
            <select
              value={selectedState}
              onChange={e => { setSelectedState(e.target.value); setSelectedCity(''); }}
              className="flex-1 h-9 px-3 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs outline-none focus:border-[#3B82F6]/50"
            >
              <option value="">All Nigeria</option>
              {NIGERIA_STATES.map(s => (
                <option key={s.state} value={s.state}>{s.state}</option>
              ))}
            </select>
            {selectedState && (
              <select
                value={selectedCity}
                onChange={e => setSelectedCity(e.target.value)}
                className="flex-1 h-9 px-3 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs outline-none focus:border-[#3B82F6]/50"
              >
                <option value="">All in {selectedState}</option>
                {citiesForSelectedState.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
          </div>
          {selectedState && !selectedCity && (
            <p className="text-[10px] text-[#3B82F6]">Showing all workers in {selectedState}</p>
          )}
          {selectedCity && (
            <p className="text-[10px] text-[#3B82F6]">Showing workers in {selectedCity}, {selectedState}</p>
          )}
          {!selectedState && (
            <p className="text-[10px] text-[#5C5E72]">Showing workers from all locations</p>
          )}
        </div>

        {/* ─── CATEGORY CHIPS ─── */}
        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
            <button
              onClick={() => setSelectedCategory(null)}
              className={!selectedCategory
                ? 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white'
                : 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
              }
            >All</button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => {
                  if (selectedCategory === cat.name) {
                    setSelectedCategory(null);
                    setSelectedSubcategory(null);
                  } else {
                    setSelectedCategory(cat.name);
                    setSelectedSubcategory(null);
                  }
                }}
                className={selectedCategory === cat.name
                  ? 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white'
                  : 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }
              >{cat.icon} {cat.name}</button>
            ))}
          </div>
        )}

        {/* ─── SUBCATEGORY CHIPS (when category selected) ─── */}
        {selectedCategory && categories.length > 0 && (() => {
          const cat = categories.find(c => c.name === selectedCategory);
          const subs = cat?.subcategories || [];
          if (subs.length === 0) return null;
          return (
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
              <button
                onClick={() => setSelectedSubcategory(null)}
                className={!selectedSubcategory
                  ? 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white'
                  : 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#8B5CF6]/30'
                }
              >All {selectedCategory}</button>
              {subs.map((sub: any) => (
                <button
                  key={sub.id}
                  onClick={() => setSelectedSubcategory(selectedSubcategory === sub.name ? null : sub.name)}
                  className={selectedSubcategory === sub.name
                    ? 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white'
                    : 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#8B5CF6]/30'
                  }
                >{sub.name}</button>
              ))}
            </div>
          );
        })()}

        {/* ─── COUNT & CLEAR ─── */}
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">
            {loading ? 'Loading...' : `${filteredWorkers.length} found`}
          </p>
          {hasActiveFilters && (
            <button
              onClick={() => { setSearchQuery(''); setSelectedState(''); setSelectedCity(''); setSelectedCategory(null); setSelectedSubcategory(null); }}
              className="text-[10px] text-[#3B82F6] hover:text-[#60A5FA]"
            >Clear all</button>
          )}
        </div>

        {/* ─── ERROR ─── */}
        {fetchError && (
          <div className="rounded-2xl bg-red-500/5 border border-red-500/20 p-4 text-center">
            <p className="text-xs text-red-400 mb-2">{fetchError}</p>
            <button onClick={() => window.location.reload()} className="text-[10px] text-[#3B82F6]">Retry</button>
          </div>
        )}

        {/* ─── LOADING ─── */}
        {loading && !fetchError && (
          <div className="space-y-3 pt-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-2xl p-4 bg-[#12121A] border border-[#1E1E2C] flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#1A1A24] animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-[#1A1A24] animate-pulse rounded w-1/3" />
                  <div className="h-2.5 bg-[#1A1A24] animate-pulse rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ─── EMPTY ─── */}
        {!loading && !fetchError && filteredWorkers.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            </div>
            {allWorkers.length === 0 ? (
              <>
                <p className="text-sm text-[#8A8B9C]">No workers registered yet</p>
                <p className="text-xs text-[#8A8B9C]/70 mt-1">Workers will appear here after signing up</p>
              </>
            ) : (
              <>
                <p className="text-sm text-[#8A8B9C]">No workers match your filters</p>
                <p className="text-xs text-[#8A8B9C]/70 mt-1">Try clearing filters or searching differently</p>
                <button
                  onClick={() => { setSearchQuery(''); setSelectedState(''); setSelectedCity(''); setSelectedCategory(null); setSelectedSubcategory(null); }}
                  className="mt-3 px-4 py-2 rounded-xl bg-[#3B82F6]/15 text-[#3B82F6] text-xs font-medium"
                >Show all workers</button>
              </>
            )}
          </div>
        )}

        {/* ─── RESULTS — sorted: online first ─── */}
        {!loading && !fetchError && filteredWorkers.length > 0 && (
          <div className="space-y-3">
            {/* Sort: online workers first */}
            {[...filteredWorkers].sort((a, b) => {
              if (a.is_online && !b.is_online) return -1;
              if (!a.is_online && b.is_online) return 1;
              return 0;
            }).map(w => {
              const isNearby = userCity && (w.city || '').toLowerCase().trim() === userCity.toLowerCase().trim();
              const skills = (w.worker_skills as string[]) || [];
              return (
                <div key={w.user_id} className={`rounded-2xl p-4 bg-[#12121A] border hover:border-[#3B82F6]/20 transition-colors ${w.is_online ? 'border-green-500/20' : 'border-[#1E1E2C] opacity-80'}`}>
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold overflow-hidden">
                        {w.avatar_url ? <img src={w.avatar_url} alt="" className="w-full h-full object-cover" /> : (w.full_name || w.username || 'W').charAt(0).toUpperCase()}
                      </div>
                      {/* Online dot on avatar */}
                      {w.is_online && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-400 border-2 border-[#12121A]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">{w.full_name || w.username || 'Worker'}</span>
                        {isNearby && w.city && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F4] border border-[#3B82F6]/20">In {w.city}</span>
                        )}
                        {/* Online/Offline */}
                        {w.is_online ? (
                          <span className="flex items-center gap-0.5 text-[8px] font-medium text-green-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            Online now
                          </span>
                        ) : w.last_seen ? (
                          <span className="text-[8px] text-[#5C5E72]">{getTimeAgo(w.last_seen)}</span>
                        ) : (
                          <span className="text-[8px] text-[#5C5E72]">Offline</span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#5C5E72] flex items-center gap-1 flex-wrap mt-0.5">
                        <span className="px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20 text-[9px] font-medium">
                          {WORKER_OCCUPATION_LABELS[w.worker_occupation || ''] || w.worker_occupation || 'General'}
                        </span>
                        {/* Multiple skills */}
                        {skills.slice(0, 3).map(s => (
                          <span key={s} className="px-1.5 py-0.5 rounded-full bg-[#1A1A24] text-[#8A8B9C] border border-[#232330] text-[9px]">{s}</span>
                        ))}
                        {skills.length > 3 && <span className="text-[9px] text-[#5C5E72]">+{skills.length - 3}</span>}
                        {w.city && (
                          <span className="flex items-center gap-0.5">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                            {w.city}{w.state ? `, ${w.state}` : ''}
                          </span>
                        )}
                      </div>
                      {/* Job count + star rating */}
                      <WorkerStats workerId={w.user_id} />
                    </div>
                  </div>
                  {w.worker_bio && (
                    <div className="mt-2">
                      <p className={`text-xs text-[#8A8B9C] ${expandedBio.has(w.user_id) ? '' : 'line-clamp-2'}`}>{w.worker_bio}</p>
                      {w.worker_bio.length > 80 && (
                        <button
                          onClick={() => {
                            setExpandedBio(prev => {
                              const next = new Set(prev);
                              if (next.has(w.user_id)) next.delete(w.user_id); else next.add(w.user_id);
                              return next;
                            });
                          }}
                          className="text-[10px] text-[#3B82F6] hover:text-[#60A5FA] mt-0.5"
                        >
                          {expandedBio.has(w.user_id) ? 'Show less' : 'Read more'}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    {/* Book — opens booking modal (always visible if logged in) */}
                    {profile && (
                      <button
                        onClick={() => setBookingWorker(w)}
                        className="inline-flex items-center gap-1 text-[11px] text-[#3B82F6] hover:text-[#60A5FA] transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2zM10 4h4v3h-4V4z" /></svg>
                        Book
                      </button>
                    )}
                    {/* Chat — only visible after booking request sent */}
                    {profile && bookedWorkers.has(w.user_id) && (
                      <button onClick={() => handleChatWithWorker(w.user_id)} className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                        Chat
                      </button>
                    )}
                    {!profile && (
                      <button
                        onClick={() => toast.info('Please log in to book a worker')}
                        className="inline-flex items-center gap-1 text-[11px] text-[#5C5E72]"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2zM10 4h4v3h-4V4z" /></svg>
                        Book
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── BOOKING MODAL ─── */}
      {bookingWorker && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setBookingWorker(null)}>
          <div className="w-full max-w-sm bg-[#12121A] border border-[#1E1E2C] rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Book {bookingWorker.full_name || bookingWorker.username || 'Worker'}</h3>
              <button onClick={() => setBookingWorker(null)} className="w-8 h-8 rounded-lg bg-[#1A1A24] flex items-center justify-center text-[#5C5E72] hover:text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <WorkerBookingFlow
              workerName={bookingWorker.full_name || bookingWorker.username || 'Worker'}
              workerService={WORKER_OCCUPATION_LABELS[bookingWorker.worker_occupation || ''] || bookingWorker.worker_occupation || ''}
              workerId={bookingWorker.user_id}
              userId={profile?.user_id || ''}
              onBook={({ description, address, date }) => {
                // Create booking request in database
                supabase.from('worker_bookings').insert({
                  worker_id: bookingWorker.user_id,
                  user_id: profile?.user_id,
                  description,
                  address,
                  preferred_date: date || null,
                  status: 'pending_approval',
                  created_at: new Date().toISOString(),
                }).then(({ error }) => {
                  if (error) {
                    toast.error('Failed to send booking request');
                    console.error('Booking error:', error);
                  } else {
                    toast.success('Booking request sent!');
                    setBookedWorkers(prev => new Set(prev).add(bookingWorker.user_id));
                  }
                });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Helper: format last_seen as "2m ago", "1h ago", etc.
function getTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
