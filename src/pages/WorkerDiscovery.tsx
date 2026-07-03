import { useState, useEffect, useMemo } from 'react';
import { getWorkers, getCategoryWithSubcategories, getOrCreateConversation } from '@/lib/supabase';
import { WORKER_OCCUPATION_LABELS, WORKER_STATUS_LABELS } from '@/types';
import type { Profile, ServiceCategory } from '@/types';
import { toast, Toaster } from 'sonner';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';

interface WorkerDiscoveryProps {
  userCity?: string | null;
  userState?: string | null;
  profile?: Profile | null;
  onGoToChat?: (convId: string) => void;
}

type LocationScope = 'all' | 'state' | 'city';

export default function WorkerDiscovery({ userCity, userState, profile, onGoToChat }: WorkerDiscoveryProps) {
  const [allWorkers, setAllWorkers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [locationScope, setLocationScope] = useState<LocationScope>('all');
  const [selectedState, setSelectedState] = useState<string>(userState || '');
  const [selectedCity, setSelectedCity] = useState<string>(userCity || '');
  const [categories, setCategories] = useState<(ServiceCategory & { subcategories: any[] })[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Fetch all workers on mount
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const { workers: data, error: wErr } = await getWorkers({});
      if (wErr) {
        setError('Failed to load workers: ' + wErr.message);
        setLoading(false);
        return;
      }
      setAllWorkers(data || []);
      const { categories: cats } = await getCategoryWithSubcategories();
      setCategories(cats || []);
      setLoading(false);
    }
    load();
  }, []);

  // Derive available cities from selected state
  const availableCities = useMemo(() => {
    return getCitiesForState(selectedState);
  }, [selectedState]);

  // Filter workers
  const filteredWorkers = useMemo(() => {
    let result = [...allWorkers];

    // Location filtering
    if (locationScope === 'state' && selectedState) {
      const citiesInState = getCitiesForState(selectedState);
      result = result.filter(w => citiesInState.includes(w.city || ''));
    } else if (locationScope === 'city' && selectedCity) {
      result = result.filter(w =>
        (w.city || '').toLowerCase().trim() === selectedCity.toLowerCase().trim()
      );
    }
    // locationScope === 'all' shows everyone

    // Category filter
    if (selectedCategory) {
      const catLower = selectedCategory.toLowerCase();
      result = result.filter(w => {
        const occ = (w.worker_occupation || '').toLowerCase();
        const bio = (w.worker_bio || '').toLowerCase();
        return occ.includes(catLower) || bio.includes(catLower);
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
        const state = (w.state || '').toLowerCase();
        return name.includes(q) || occ.includes(q) || occLabel.includes(q) || bio.includes(q) || city.includes(q) || state.includes(q);
      });
    }

    // Sort: nearby workers first (if user has a city), then by name
    result.sort((a, b) => {
      if (userCity) {
        const aNear = (a.city || '').toLowerCase().trim() === userCity.toLowerCase().trim();
        const bNear = (b.city || '').toLowerCase().trim() === userCity.toLowerCase().trim();
        if (aNear && !bNear) return -1;
        if (!aNear && bNear) return 1;
      }
      return (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '');
    });

    return result;
  }, [allWorkers, searchQuery, locationScope, selectedState, selectedCity, selectedCategory, userCity]);

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

  const activeFiltersCount = (locationScope !== 'all' ? 1 : 0) + (selectedCategory ? 1 : 0) + (searchQuery.trim() ? 1 : 0);

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />

      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-4">
        <div className="max-w-lg mx-auto">
          <h1 className="text-lg font-bold text-white mb-1">Find Workers</h1>
          <p className="text-xs text-[#5C5E72]">
            {allWorkers.length > 0 ? `${allWorkers.length} worker${allWorkers.length !== 1 ? 's' : ''} registered` : 'Discover verified workers'}
            {userCity ? ` · Your location: ${userCity}` : ''}
          </p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-4">
        {/* Search */}
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

        {/* Location Scope Selector */}
        <div className="space-y-2">
          {/* Scope tabs */}
          <div className="flex gap-1.5">
            {[
              { key: 'all' as LocationScope, label: 'All Nigeria' },
              { key: 'state' as LocationScope, label: 'By State' },
              { key: 'city' as LocationScope, label: 'By City/LGA' },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setLocationScope(s.key)}
                className={`flex-1 h-8 rounded-lg text-[10px] font-medium transition-colors ${
                  locationScope === s.key
                    ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/20'
                    : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#5C5E72] hover:text-white'
                }`}
              >{s.label}</button>
            ))}
          </div>

          {/* State dropdown */}
          {locationScope === 'state' && (
            <select
              value={selectedState}
              onChange={e => { setSelectedState(e.target.value); setSelectedCity(''); }}
              className="w-full h-9 px-3 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs outline-none focus:border-[#3B82F6]/50"
            >
              <option value="">Select a state</option>
              {NIGERIA_STATES.map(s => (
                <option key={s.state} value={s.state}>{s.state}</option>
              ))}
            </select>
          )}

          {/* City/LGA dropdown */}
          {locationScope === 'city' && (
            <div className="flex gap-2">
              <select
                value={selectedState}
                onChange={e => { setSelectedState(e.target.value); setSelectedCity(''); }}
                className="flex-1 h-9 px-3 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs outline-none focus:border-[#3B82F6]/50"
              >
                <option value="">State</option>
                {NIGERIA_STATES.map(s => (
                  <option key={s.state} value={s.state}>{s.state}</option>
                ))}
              </select>
              <select
                value={selectedCity}
                onChange={e => setSelectedCity(e.target.value)}
                className="flex-1 h-9 px-3 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs outline-none focus:border-[#3B82F6]/50"
              >
                <option value="">City/LGA</option>
                {availableCities.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {/* Show current scope */}
          {locationScope === 'all' && (
            <p className="text-[10px] text-[#5C5E72]">Showing workers from all locations</p>
          )}
          {locationScope === 'state' && selectedState && (
            <p className="text-[10px] text-[#3B82F6]">Showing workers in {selectedState}</p>
          )}
          {locationScope === 'city' && selectedCity && (
            <p className="text-[10px] text-[#3B82F6]">Showing workers in {selectedCity}, {selectedState}</p>
          )}
        </div>

        {/* Category Chips */}
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
                onClick={() => setSelectedCategory(selectedCategory === cat.name ? null : cat.name)}
                className={selectedCategory === cat.name
                  ? 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white'
                  : 'h-7 px-3 rounded-full text-[10px] font-medium whitespace-nowrap bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }
              >{cat.icon} {cat.name}</button>
            ))}
          </div>
        )}

        {/* Count & Clear */}
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">
            {!loading && `${filteredWorkers.length} worker${filteredWorkers.length !== 1 ? 's' : ''}`}
            {loading && 'Loading...'}
          </p>
          {activeFiltersCount > 0 && (
            <button onClick={() => { setSearchQuery(''); setLocationScope('all'); setSelectedCategory(null); }} className="text-[10px] text-[#3B82F6] hover:text-[#60A5FA]">Clear filters</button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-2xl bg-red-500/5 border border-red-500/20 p-4 text-center">
            <p className="text-xs text-red-400">{error}</p>
            <button onClick={() => window.location.reload()} className="mt-2 text-[10px] text-[#3B82F6]">Retry</button>
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="space-y-3">
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
        ) : filteredWorkers.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            </div>
            <p className="text-sm text-[#8A8B9C]">
              {allWorkers.length === 0 ? 'No workers have signed up yet' : 'No workers match your filters'}
            </p>
            <p className="text-xs text-[#8A8B9C]/70 mt-1">
              {allWorkers.length === 0
                ? 'Workers will appear here after signing up'
                : `Try "All Nigeria" or adjust your search`
              }
            </p>
            {allWorkers.length > 0 && locationScope !== 'all' && (
              <button onClick={() => setLocationScope('all')} className="mt-3 px-4 py-2 rounded-xl bg-[#3B82F6]/15 text-[#3B82F6] text-xs font-medium">
                Show all of Nigeria
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredWorkers.map(w => {
              const statusKey = w.worker_status || 'pending';
              const statusLabel = WORKER_STATUS_LABELS[statusKey] || statusKey;
              const isNearby = userCity && (w.city || '').toLowerCase().trim() === userCity.toLowerCase().trim();
              return (
                <div key={w.user_id} className="rounded-2xl p-4 bg-[#12121A] border border-[#1E1E2C] hover:border-[#3B82F6]/20 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold flex-shrink-0 overflow-hidden">
                      {w.avatar_url ? <img src={w.avatar_url} alt="" className="w-full h-full object-cover" /> : (w.full_name || w.username || 'W').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">{w.full_name || w.username || 'Worker'}</span>
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{statusLabel}</span>
                        {isNearby && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F4] border border-[#3B82F6]/20">Nearby</span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#5C5E72] flex items-center gap-1 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20 text-[9px] font-medium">
                          {WORKER_OCCUPATION_LABELS[w.worker_occupation || ''] || w.worker_occupation || 'General'}
                        </span>
                        {w.city && (
                          <span className="flex items-center gap-0.5">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                            {w.city}{w.state ? `, ${w.state}` : ''}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
