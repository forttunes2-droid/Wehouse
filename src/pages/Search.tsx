import { useEffect, useMemo, useState } from 'react';
import { getAllListings } from '@/lib/supabase';
import { NIGERIA_STATES, getCitiesForState } from '@/data/nigeria-locations';
import ListingCard from '@/components/ListingCard';
import type { Listing } from '@/types';

interface SearchProps {
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
}

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function typeValue(listing: Listing) {
  return String(listing.sub_type || listing.property_type || '').trim();
}

function typeLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

export default function Search({ onNavigate, savedIds, onToggleSave }: SearchProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [priceMax, setPriceMax] = useState<number | ''>('');
  const [bedrooms, setBedrooms] = useState<number | ''>('');
  const [filterState, setFilterState] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const savedType = sessionStorage.getItem('search_property_type');
    if (savedType && savedType !== 'hotel') setPropertyType(savedType);
    sessionStorage.removeItem('search_property_type');
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      const { listings: data } = await getAllListings();
      if (!active) return;
      setListings(data || []);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const citiesForState = useMemo(() => getCitiesForState(filterState), [filterState]);

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    listings.forEach(listing => {
      const value = typeValue(listing);
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: typeLabel(value), count }));
  }, [listings]);

  const stateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    listings.forEach(listing => {
      if (listing.state) counts.set(listing.state, (counts.get(listing.state) || 0) + 1);
    });
    return counts;
  }, [listings]);

  const filtered = useMemo(() => {
    const needle = normalize(query);
    return listings.filter(listing => {
      const haystack = [listing.title, listing.address, listing.city, listing.state, listing.property_type, listing.sub_type]
        .map(normalize)
        .join(' ');
      if (needle && !haystack.includes(needle)) return false;
      if (priceMax && Number(listing.price || 0) > priceMax) return false;
      if (bedrooms && Number(listing.bedrooms || 0) < bedrooms) return false;
      if (filterState && normalize(listing.state) !== normalize(filterState)) return false;
      if (filterCity && normalize(listing.city) !== normalize(filterCity)) return false;
      if (propertyType && normalize(typeValue(listing)) !== normalize(propertyType)) return false;
      return true;
    });
  }, [listings, query, priceMax, bedrooms, filterState, filterCity, propertyType]);

  const hasFilters = Boolean(query || priceMax || bedrooms || filterState || filterCity || propertyType);

  function clearFilters() {
    setQuery('');
    setPriceMax('');
    setBedrooms('');
    setFilterState('');
    setFilterCity('');
    setPropertyType('');
  }

  return (
    <div className="min-h-screen bg-[#09090D] pb-24 text-white">
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#09090D]/95 px-4 pb-4 pt-5 backdrop-blur-xl lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate('home')} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-[#85879A] hover:text-white" aria-label="Back home">←</button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold">Find an apartment</h1>
              <p className="text-[10px] text-[#686A7D]">Only available WeHouse listings are shown.</p>
            </div>
            <button onClick={() => onNavigate('hotels')} className="rounded-xl border border-rose-500/20 bg-rose-500/[0.08] px-3 py-2 text-[10px] font-semibold text-rose-300">Hotels</button>
          </div>

          <div className="mt-4 flex gap-2">
            <div className="relative flex-1">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#5C5E72]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search apartment, area or location" className="h-11 w-full rounded-xl border border-white/[0.07] bg-[#14141D] pl-10 pr-4 text-sm outline-none placeholder:text-[#55576A] focus:border-violet-500/40" />
            </div>
            <button onClick={() => setShowFilters(value => !value)} className={`h-11 rounded-xl border px-4 text-xs font-medium ${showFilters ? 'border-violet-500/30 bg-violet-500/15 text-violet-300' : 'border-white/[0.07] bg-[#14141D] text-[#85879A]'}`}>Filters</button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <select value={filterState} onChange={event => { setFilterState(event.target.value); setFilterCity(''); }} className="h-10 rounded-xl border border-white/[0.07] bg-[#14141D] px-3 text-xs outline-none focus:border-violet-500/40">
              <option value="">All states</option>
              {NIGERIA_STATES.map(item => <option key={item.state} value={item.state}>{item.state}{stateCounts.get(item.state) ? ` (${stateCounts.get(item.state)})` : ''}</option>)}
            </select>
            <select value={filterCity} onChange={event => setFilterCity(event.target.value)} disabled={!filterState} className="h-10 rounded-xl border border-white/[0.07] bg-[#14141D] px-3 text-xs outline-none disabled:opacity-40 focus:border-violet-500/40">
              <option value="">All LGAs</option>
              {citiesForState.map(city => <option key={city} value={city}>{city}</option>)}
            </select>
          </div>

          {showFilters && (
            <div className="mt-3 grid gap-3 rounded-2xl border border-white/[0.06] bg-[#111119] p-4 md:grid-cols-3">
              <div><label className="mb-1 block text-[9px] uppercase tracking-wide text-[#66687B]">Apartment type</label><select value={propertyType} onChange={event => setPropertyType(event.target.value)} className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#181822] px-3 text-xs outline-none"><option value="">All apartment types</option>{types.map(item => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}</select></div>
              <div><label className="mb-1 block text-[9px] uppercase tracking-wide text-[#66687B]">Maximum price</label><input type="number" min="0" value={priceMax} onChange={event => setPriceMax(event.target.value ? Number(event.target.value) : '')} placeholder="Any price" className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#181822] px-3 text-xs outline-none" /></div>
              <div><label className="mb-1 block text-[9px] uppercase tracking-wide text-[#66687B]">Minimum bedrooms</label><select value={bedrooms} onChange={event => setBedrooms(event.target.value ? Number(event.target.value) : '')} className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#181822] px-3 text-xs outline-none"><option value="">Any</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option></select></div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 lg:px-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><p className="text-sm font-semibold">{loading ? 'Loading apartments…' : `${filtered.length} apartment${filtered.length === 1 ? '' : 's'}`}</p><p className="mt-1 text-[10px] text-[#66687B]">State and LGA use the location recorded on each approved listing.</p></div>
          {hasFilters && <button onClick={clearFilters} className="text-[10px] font-medium text-violet-300">Clear filters</button>}
        </div>

        {loading ? (
          <div className="grid min-h-56 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>
        ) : filtered.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-16 text-center"><h2 className="text-sm font-semibold">No available apartments match this search</h2><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#66687B]">Change the location or filters. Pending, reserved, unavailable and deleted listings are not part of discovery.</p>{hasFilters && <button onClick={clearFilters} className="mt-5 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold">Show all available apartments</button>}</section>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map(listing => <ListingCard key={listing.id} listing={listing} onClick={() => onNavigate('detail', listing.id)} isSaved={savedIds.has(listing.id)} onToggleSave={event => { event.stopPropagation(); onToggleSave(listing.id); }} />)}
          </div>
        )}
      </main>
    </div>
  );
}
