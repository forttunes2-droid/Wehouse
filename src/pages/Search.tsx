import { useState, useEffect, useMemo } from 'react';
import { getAllListings } from '@/lib/supabase';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';
import ListingCard from '@/components/ListingCard';
import type { Listing } from '@/types';

interface SearchProps {
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
}

// Popular states for quick browse
const POPULAR_STATES = ['Lagos', 'Abuja (FCT)', 'Rivers', 'Kano', 'Oyo', 'Enugu', 'Delta', 'Kaduna'];

export default function Search({ onNavigate, savedIds, onToggleSave }: SearchProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [priceMax, setPriceMax] = useState<number | ''>('');
  const [bedrooms, setBedrooms] = useState<number | ''>('');
  const [filterState, setFilterState] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    async function load() {
      const { listings: data } = await getAllListings();
      setListings(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const citiesForState = useMemo(() => getCitiesForState(filterState), [filterState]);

  const filtered = useMemo(() => {
    return listings.filter(l => {
      const q = query.toLowerCase();
      const matchesQuery = !q || l.title.toLowerCase().includes(q) || l.city?.toLowerCase().includes(q) || l.state?.toLowerCase().includes(q);
      const matchesPrice = !priceMax || l.price <= priceMax;
      const matchesBed = !bedrooms || l.bedrooms >= bedrooms;
      const matchesState = !filterState || l.state === filterState;
      const matchesCity = !filterCity || l.city === filterCity;
      return matchesQuery && matchesPrice && matchesBed && matchesState && matchesCity;
    });
  }, [listings, query, priceMax, bedrooms, filterState, filterCity]);

  // Group listings by state for counts
  const listingsByState = useMemo(() => {
    const map: Record<string, number> = {};
    listings.forEach(l => {
      if (l.state) map[l.state] = (map[l.state] || 0) + 1;
    });
    return map;
  }, [listings]);

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => onNavigate('home')} className="text-[#5C5E72] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex-1 relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search houses, locations..."
              className="w-full h-10 glass rounded-xl pl-10 pr-4 text-sm text-white placeholder:text-[#5C5E72] outline-none focus:ring-2 focus:ring-[#3B82F6]/30"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5C5E72]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          </div>
          <button onClick={() => setShowFilters(!showFilters)} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${showFilters ? 'bg-[#3B82F6] text-white' : 'glass text-[#5C5E72]'}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
          </button>
        </div>

        {/* State + LGA — Always visible for easy browsing */}
        <div className="mt-3 flex gap-2">
          <select
            value={filterState}
            onChange={(e) => { setFilterState(e.target.value); setFilterCity(''); }}
            className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%235C5E72' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', appearance: 'none' }}
          >
            <option value="">All States</option>
            {NIGERIA_STATES.map((s) => (
              <option key={s.state} value={s.state}>{s.state} {listingsByState[s.state] ? `(${listingsByState[s.state]})` : ''}</option>
            ))}
          </select>
          <select
            value={filterCity}
            onChange={(e) => setFilterCity(e.target.value)}
            disabled={!filterState}
            className={`flex-1 h-10 rounded-xl border text-white text-sm px-3 outline-none ${
              filterState ? 'bg-[#1A1A24] border-[#232330] focus:border-[#3B82F6]' : 'bg-[#12121A] border-[#1E1E2C] text-[#5C5E72]'
            }`}
            style={filterState ? { backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%235C5E72' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', appearance: 'none' } : {}}
          >
            <option value="">All LGAs</option>
            {citiesForState.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Advanced filters (price, bedrooms) */}
        {showFilters && (
          <div className="mt-3 glass rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">Max Price (N)</label>
                <input type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value ? Number(e.target.value) : '')} placeholder="Any" className="w-full h-9 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" />
              </div>
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">Min Bedrooms</label>
                <select value={bedrooms} onChange={(e) => setBedrooms(e.target.value ? Number(e.target.value) : '')} className="w-full h-9 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]">
                  <option value="">Any</option>
                  <option value="1">1+</option>
                  <option value="2">2+</option>
                  <option value="3">3+</option>
                  <option value="4">4+</option>
                </select>
              </div>
            </div>
            <button onClick={() => { setPriceMax(''); setBedrooms(''); setFilterState(''); setFilterCity(''); }} className="text-[10px] text-[#3B82F6] font-medium">Clear all filters</button>
          </div>
        )}
      </header>

      {/* Browse by State — Quick access */}
      {!filterState && !query && (
        <div className="px-5 pt-4">
          <p className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-2">Browse by State</p>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
            {POPULAR_STATES.map((s) => (
              <button
                key={s}
                onClick={() => setFilterState(s)}
                className="flex-shrink-0 h-8 px-3 rounded-lg bg-[#1A1A24] border border-[#232330] text-xs text-[#8A8B9C] hover:border-[#3B82F6]/50 hover:text-white transition-colors"
              >
                {s.replace(' (FCT)', '')}
                {listingsByState[s] ? (
                  <span className="ml-1 text-[9px] text-[#5C5E72]">{listingsByState[s]}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active filter indicator */}
      {(filterState || filterCity) && (
        <div className="px-5 pt-3 flex items-center gap-2">
          <span className="text-[10px] text-[#5C5E72]">Showing:</span>
          {filterState && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] font-medium">
              {filterState}{filterCity ? ` · ${filterCity}` : ''}
            </span>
          )}
          <button onClick={() => { setFilterState(''); setFilterCity(''); }} className="text-[10px] text-red-400 hover:text-red-300 ml-auto">Clear</button>
        </div>
      )}

      {/* Results */}
      <div className="px-5 pt-4">
        <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-3">{filtered.length} Result{filtered.length !== 1 ? 's' : ''}</div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            </div>
            <p className="text-sm text-[#8A8B9C]">No listings found</p>
            <p className="text-xs text-[#5C5E72] mt-1">Try a different state or city</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map(l => (
              <ListingCard key={l.id} listing={l} onClick={() => onNavigate('detail', l.id)} isSaved={savedIds.has(l.id)} onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
