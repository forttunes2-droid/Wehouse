import { useState, useEffect, useMemo } from 'react';
import { getAllListings } from '@/lib/supabase';
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
    return () => { cancelled = true };
  }, []);

  const cityListings = useMemo(() => {
    if (!cityFilter) return listings;
    return [...listings].sort((a, b) => {
      const aMatch = a.city === cityFilter;
      const bMatch = b.city === cityFilter;
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });
  }, [listings, cityFilter]);

  const availableListings = cityFilter
    ? cityListings.filter(l => l.city === cityFilter)
    : cityListings;

  const featured = availableListings.filter(l => (l.images?.length || 0) > 0).slice(0, 5);
  const recent = availableListings.slice(0, 6);

  // Popular cities (from listings)
  const popularCities = useMemo(() => {
    const cityCount: Record<string, number> = {};
    listings.forEach(l => { if (l.city) cityCount[l.city] = (cityCount[l.city] || 0) + 1; });
    return Object.entries(cityCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([city]) => city);
  }, [listings]);

  const availableCities = useMemo(() => {
    const cities = new Set<string>();
    listings.forEach(l => { if (l.city) cities.add(l.city); });
    return Array.from(cities).sort();
  }, [listings]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] pb-24">
        <div className="h-[200px] w-full shimmer" />
        <div className="px-5 mt-5 space-y-4">
          <div className="h-6 w-32 rounded shimmer" />
          <div className="flex gap-3">
            {[1, 2, 3].map(i => <div key={i} className="w-[280px] h-[220px] rounded-2xl shimmer flex-shrink-0" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      {/* ─── HERO SECTION ─────────────────────────────── */}
      <div className="relative">
        {/* Hero background image */}
        <div className="relative h-[220px] overflow-hidden">
          <img
            src="/hero-bg.jpg"
            alt="Modern housing"
            className="w-full h-full object-cover"
          />
          {/* Dark overlay gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0F]/60 via-[#0A0A0F]/40 to-[#0A0A0F]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0F]/70 to-transparent" />

          {/* Hero content */}
          <div className="absolute inset-0 flex flex-col justify-end p-5 pb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              </div>
              <span className="text-xs font-medium text-white/80 tracking-wide">WeHouse</span>
            </div>
            <h1 className="text-xl font-bold text-white leading-tight mb-1">
              Find Your<br />Perfect Home
            </h1>
            <p className="text-[11px] text-[#8A8B9C]">
              Houses · Roommates · Rentals in {profile.city || 'Nigeria'}
            </p>
          </div>
        </div>

        {/* Floating search bar */}
        <div className="px-5 -mt-4 relative z-10">
          <button
            onClick={() => onNavigate('search')}
            className="w-full h-12 glass rounded-xl flex items-center px-4 gap-3 text-[#5C5E72] text-sm hover:border-[#3B82F6]/30 transition-all shadow-lg"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <span>Search houses, locations...</span>
          </button>
        </div>
      </div>

      {/* ─── POPULAR LOCATIONS ────────────────────────── */}
      {popularCities.length > 0 && (
        <section className="mt-5 px-5">
          <h2 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3">Popular Locations</h2>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {popularCities.map(city => {
              const count = listings.filter(l => l.city === city).length;
              const isActive = cityFilter === city;
              return (
                <button
                  key={city}
                  onClick={() => setCityFilter(isActive ? null : city)}
                  className={`flex-shrink-0 flex flex-col items-start px-4 py-3 rounded-xl min-w-[100px] transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
                      : 'bg-[#12121A] border border-[#1E1E2C] text-white hover:border-[#3B82F6]/30'
                  }`}
                >
                  <span className="text-xs font-semibold">{city}</span>
                  <span className={`text-[10px] ${isActive ? 'text-white/70' : 'text-[#5C5E72]'}`}>{count} listings</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── CITY FILTER CHIPS ────────────────────────── */}
      {availableCities.length > 0 && (
        <section className="mt-4 px-5">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setCityFilter(null)}
              className={`flex-shrink-0 h-8 px-4 rounded-full text-[11px] font-medium transition-all ${
                cityFilter === null
                  ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white'
                  : 'bg-[#12121A] border border-[#1E1E2C] text-[#8A8B9C] hover:border-[#3B82F6]/30'
              }`}
            >
              All Cities
            </button>
            {availableCities.map(city => (
              <button
                key={city}
                onClick={() => setCityFilter(cityFilter === city ? null : city)}
                className={`flex-shrink-0 h-8 px-4 rounded-full text-[11px] font-medium transition-all ${
                  cityFilter === city
                    ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white'
                    : 'bg-[#12121A] border border-[#1E1E2C] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }`}
              >
                {city}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ─── FEATURED PROPERTIES ──────────────────────── */}
      {featured.length > 0 && (
        <section className="mt-6">
          <div className="flex items-center justify-between mb-3 px-5">
            <div>
              <h2 className="text-sm font-semibold text-white">Featured Properties</h2>
              <p className="text-[10px] text-[#5C5E72]">Handpicked for you</p>
            </div>
            <button onClick={() => onNavigate('search')} className="text-[10px] text-[#3B82F6] font-medium">See all</button>
          </div>
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex gap-3 px-5" style={{ minWidth: 'max-content' }}>
              {featured.map(l => (
                <div key={l.id} className="w-[280px] flex-shrink-0">
                  <ListingCard listing={l} onClick={() => onNavigate('detail', l.id)} isSaved={savedIds.has(l.id)} onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── RECENTLY ADDED ───────────────────────────── */}
      {recent.length > 0 && (
        <section className="mt-6 px-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Recently Added</h2>
              <p className="text-[10px] text-[#5C5E72]">New properties available</p>
            </div>
            <button onClick={() => onNavigate('search')} className="text-[10px] text-[#3B82F6] font-medium">See all</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {recent.map(l => (
              <ListingCard key={l.id} listing={l} onClick={() => onNavigate('detail', l.id)} isSaved={savedIds.has(l.id)} onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }} />
            ))}
          </div>
        </section>
      )}

      {/* ─── ROOMMATES CTA ────────────────────────────── */}
      <section className="mt-6 px-5">
        <button onClick={() => onNavigate('roommate')} className="w-full glass rounded-2xl p-4 border border-[#3B82F6]/10 flex items-center gap-3 text-left card-hover group">
          <div className="w-12 h-12 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#3B82F6]/20 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Find a Roommate</p>
            <p className="text-[11px] text-[#5C5E72]">Connect with people looking to share housing</p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className="ml-auto flex-shrink-0"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </section>

      {/* ─── VERIFIED HOUSING ─────────────────────────── */}
      <section className="mt-4 px-5">
        <div className="glass rounded-2xl p-4 border border-green-500/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="1.5"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-white">Verified Housing</p>
            <p className="text-[10px] text-[#5C5E72]">All listings are reviewed by our team</p>
          </div>
        </div>
      </section>

      {/* Empty state */}
      {listings.length === 0 && (
        <div className="text-center py-20 px-5">
          <div className="w-16 h-16 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
          </div>
          <p className="text-sm text-[#5C5E72]">No listings yet</p>
          <p className="text-xs text-[#5C5E72] mt-1">{isAdmin ? 'Be the first to post a listing' : 'Check back soon for available properties'}</p>
          {isAdmin && onGoToNewListing && (
            <button onClick={onGoToNewListing} className="mt-4 h-10 px-5 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-xs font-semibold shadow-lg shadow-blue-500/20 inline-flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              Post a Listing
            </button>
          )}
        </div>
      )}

      {/* ─── ADD LISTING FAB ──────────────────────────── */}
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
