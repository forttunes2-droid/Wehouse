import { useState, useEffect, useMemo } from 'react';
import { getAllListings } from '@/lib/supabase';
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
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    async function load() {
      const { listings: data } = await getAllListings();
      setListings(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    return listings.filter(l => {
      const q = query.toLowerCase();
      const matchesQuery = !q ||
        l.title.toLowerCase().includes(q) ||
        l.city?.toLowerCase().includes(q) ||
        l.state?.toLowerCase().includes(q) ||
        l.address?.toLowerCase().includes(q);
      const matchesPrice = !priceMax || l.price <= priceMax;
      const matchesBed = !bedrooms || l.bedrooms >= bedrooms;
      const matchesLoc = !location || l.city === location || l.state === location;
      const matchesStatus = !status || l.availability_status === status;
      return matchesQuery && matchesPrice && matchesBed && matchesLoc && matchesStatus;
    });
  }, [listings, query, priceMax, bedrooms, location, status]);

  const locations = useMemo(() => {
    const cities = new Set(listings.map(l => l.city).filter((c): c is string => !!c));
    return Array.from(cities);
  }, [listings]);

  return (
    <div className="min-h-screen bg-[#FAF8F5] pb-20">
      {/* Header */}
      <header className="bg-[#0F1724] text-white px-5 pt-4 pb-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => onNavigate('home')} className="text-white/70">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search houses, locations..."
              className="w-full h-10 bg-white/10 rounded-xl pl-10 pr-4 text-sm text-white placeholder:text-white/40"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
              showFilters ? 'bg-[#C8A45A] text-[#0F1724]' : 'bg-white/10 text-white/70'
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
        </div>
      </header>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white px-5 py-4 border-b border-[#f0eeea] space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#8B8680] mb-1 block">Max Price (₦)</label>
              <input
                type="number"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value ? Number(e.target.value) : '')}
                placeholder="Any"
                className="w-full h-9 rounded-lg border border-[#e5e2dd] px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#8B8680] mb-1 block">Min Bedrooms</label>
              <select
                value={bedrooms}
                onChange={(e) => setBedrooms(e.target.value ? Number(e.target.value) : '')}
                className="w-full h-9 rounded-lg border border-[#e5e2dd] px-3 text-sm bg-white"
              >
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
              <label className="text-[10px] text-[#8B8680] mb-1 block">Location</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full h-9 rounded-lg border border-[#e5e2dd] px-3 text-sm bg-white"
              >
                <option value="">All</option>
                {locations.map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#8B8680] mb-1 block">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full h-9 rounded-lg border border-[#e5e2dd] px-3 text-sm bg-white"
              >
                <option value="">All</option>
                <option value="available">Available</option>
                <option value="reserved">Reserved</option>
              </select>
            </div>
          </div>
          <button
            onClick={() => { setPriceMax(''); setBedrooms(''); setLocation(''); setStatus(''); }}
            className="text-xs text-[#C8A45A] font-medium"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Results */}
      <div className="px-5 pt-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[#8B8680]">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[#8B8680] text-sm">
            No listings match your search.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map(l => (
              <ListingCard
                key={l.id}
                listing={l}
                onClick={() => onNavigate('detail', l.id)}
                isSaved={savedIds.has(l.id)}
                onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
