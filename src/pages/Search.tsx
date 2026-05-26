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

        {/* Filters */}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">State</label>
                <select value={filterState} onChange={(e) => { setFilterState(e.target.value); setFilterCity(''); }} className="w-full h-9 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]">
                  <option value="">All States</option>
                  {NIGERIA_STATES.map((s) => <option key={s.state} value={s.state}>{s.state}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">City</label>
                <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)} disabled={!filterState} className="w-full h-9 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6] disabled:opacity-50">
                  <option value="">All Cities</option>
                  {citiesForState.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <button onClick={() => { setPriceMax(''); setBedrooms(''); setFilterState(''); setFilterCity(''); }} className="text-[10px] text-[#3B82F6] font-medium">Clear all filters</button>
          </div>
        )}
      </header>

      {/* Results */}
      <div className="px-5 pt-4">
        <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider mb-3">{filtered.length} Result{filtered.length !== 1 ? 's' : ''}</div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-sm text-[#5C5E72]">No listings match your search</div>
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
