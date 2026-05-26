import { useState, useEffect, useMemo } from 'react';
import { getAllListings } from '@/lib/supabase';
// Location filtering is done inline via city comparison
import ListingCard from '@/components/ListingCard';
import type { Listing, Profile } from '@/types';

interface HomeProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
  isAdmin?: boolean;
  onGoToNewListing?: () => void;
}

export default function Home({ profile, onNavigate, savedIds, onToggleSave, isAdmin, onGoToNewListing }: HomeProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [cityFilter, setCityFilter] = useState<string | null>(profile.city || null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { listings: data } = await getAllListings();
        if (!cancelled) setListings(data || []);
      } catch {
        if (!cancelled) setListings([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Location-aware filtering: prioritize user's city
  const cityListings = useMemo(() => {
    if (!cityFilter) return listings;
    // Sort: same city first, then others
    return [...listings].sort((a, b) => {
      const aMatch = a.city === cityFilter;
      const bMatch = b.city === cityFilter;
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });
  }, [listings, cityFilter]);

  const featured = cityListings.slice(0, 5);
  const recent = cityListings.slice(0, 8);

  // Unique cities from listings for filter
  const availableCities = useMemo(() => {
    const cities = new Set<string>();
    listings.forEach((l) => { if (l.city) cities.add(l.city); });
    return Array.from(cities).sort();
  }, [listings]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] pb-24">
        <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
          <div className="h-8 w-32 rounded-lg shimmer mb-3" />
          <div className="h-10 w-full rounded-xl shimmer" />
        </header>
        <div className="px-5 mt-5 space-y-4">
          <div className="h-6 w-24 rounded shimmer" />
          <div className="flex gap-3 overflow-hidden">
            {[1, 2, 3].map(i => <div key={i} className="w-[260px] h-[200px] rounded-2xl shimmer flex-shrink-0" />)}
          </div>
          <div className="h-6 w-32 rounded shimmer mt-6" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-48 rounded-2xl shimmer" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5 sticky top-0 z-30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center glow-blue-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
            </div>
            <div>
              <span className="font-semibold text-sm text-white block leading-tight">WeHouse</span>
              {profile.city && (
                <span className="text-[9px] text-[#5C5E72] flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  {profile.city}{profile.state ? `, ${profile.state}` : ''}
                </span>
              )}
            </div>
          </div>
          <span className="text-[10px] text-[#5C5E72]">@{profile.username}</span>
        </div>

        {/* Search bar */}
        <button onClick={() => onNavigate('search')} className="w-full h-10 glass rounded-xl flex items-center px-4 gap-2 text-[#5C5E72] text-sm hover:border-[#3B82F6]/30 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          Search houses, locations...
        </button>

        {/* City filter chips */}
        {availableCities.length > 0 && (
          <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setCityFilter(null)}
              className={`flex-shrink-0 h-7 px-3 rounded-full text-[10px] font-medium transition-all ${
                cityFilter === null
                  ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white'
                  : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
              }`}
            >
              All
            </button>
            {availableCities.map((city) => (
              <button
                key={city}
                onClick={() => setCityFilter(cityFilter === city ? null : city)}
                className={`flex-shrink-0 h-7 px-3 rounded-full text-[10px] font-medium transition-all ${
                  cityFilter === city
                    ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white'
                    : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }`}
              >
                {city}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Featured */}
      {featured.length > 0 && (
        <section className="mt-3">
          <div className="flex items-center justify-between mb-3 px-5">
            <h2 className="text-sm font-semibold text-white">Featured</h2>
            <button onClick={() => onNavigate('search')} className="text-[10px] text-[#3B82F6] font-medium hover:text-[#60A5FA] transition-colors">See all</button>
          </div>
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex gap-3 px-5" style={{ minWidth: 'max-content' }}>
              {featured.map(l => (
                <div key={l.id} className="w-[260px] flex-shrink-0">
                  <ListingCard listing={l} onClick={() => onNavigate('detail', l.id)} isSaved={savedIds.has(l.id)} onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Recent */}
      {recent.length > 0 && (
        <section className="mt-6">
          <div className="flex items-center justify-between mb-3 px-5">
            <h2 className="text-sm font-semibold text-white">Recent Listings</h2>
            <button onClick={() => onNavigate('search')} className="text-[10px] text-[#3B82F6] font-medium hover:text-[#60A5FA] transition-colors">See all</button>
          </div>
          <div className="px-5 grid grid-cols-2 gap-3">
            {recent.map(l => (
              <ListingCard key={l.id} listing={l} onClick={() => onNavigate('detail', l.id)} isSaved={savedIds.has(l.id)} onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }} />
            ))}
          </div>
        </section>
      )}

      {listings.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
          </div>
          <p className="text-sm text-[#5C5E72]">No listings yet</p>
          <p className="text-xs text-[#5C5E72] mt-1">
            {isAdmin ? 'Be the first to post a listing' : 'Check back soon for available properties'}
          </p>
          {isAdmin && onGoToNewListing && (
            <button
              onClick={onGoToNewListing}
              className="mt-4 h-10 px-5 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/20 inline-flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              Post a Listing
            </button>
          )}
        </div>
      )}

      {/* Add Listing FAB for admins */}
      {isAdmin && onGoToNewListing && listings.length > 0 && (
        <button
          onClick={onGoToNewListing}
          className="fixed bottom-20 right-5 w-12 h-12 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white flex items-center justify-center shadow-lg shadow-blue-500/30 hover:scale-105 active:scale-95 transition-transform z-40"
          aria-label="Add listing"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      )}
    </div>
  );
}
