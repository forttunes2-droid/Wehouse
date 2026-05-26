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

// ─── QUICK STAT CARD ──────────────────────────────────────
function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-sm font-bold text-white leading-none">{value}</p>
        <p className="text-[10px] text-white/60 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ─── LOCATION CARD ────────────────────────────────────────
function LocationCard({ city, count, image, onClick }: { city: string; count: number; image: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative flex-shrink-0 w-[140px] h-[100px] rounded-2xl overflow-hidden group card-hover"
    >
      <img src={image} alt={city} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" loading="lazy" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-3 text-left">
        <p className="text-xs font-bold text-white leading-tight">{city}</p>
        <p className="text-[9px] text-white/70">{count} {count === 1 ? 'listing' : 'listings'}</p>
      </div>
    </button>
  );
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

  // Filter listings with images for featured
  const featured = availableListings.filter(l => (l.images?.length || 0) > 0).slice(0, 8);
  const recent = availableListings.slice(0, 8);

  // Popular cities from listings
  const popularCities = useMemo(() => {
    const cityCount: Record<string, number> = {};
    listings.forEach(l => { if (l.city) cityCount[l.city] = (cityCount[l.city] || 0) + 1; });
    return Object.entries(cityCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([city]) => city);
  }, [listings]);

  // Stats
  const totalListings = listings.length;
  const totalCities = popularCities.length;
  const availableCount = listings.filter(l => l.status === 'available').length;

  // Location images cycling
  const locationImages = ['/hero-city.jpg', '/hero-main.jpg', '/locations-bg.jpg', '/roommate-bg.jpg'];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] pb-24">
        {/* Hero shimmer */}
        <div className="h-[320px] w-full shimmer" />
        <div className="px-5 mt-6 space-y-6">
          <div className="h-5 w-40 rounded shimmer" />
          <div className="flex gap-3">
            {[1, 2, 3].map(i => <div key={i} className="w-[280px] h-[220px] rounded-2xl shimmer flex-shrink-0" />)}
          </div>
          <div className="h-5 w-32 rounded shimmer" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-[200px] rounded-2xl shimmer" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      {/* ═══════════════════════════════════════════════════
          HERO SECTION — Full-width property imagery
          ═══════════════════════════════════════════════════ */}
      <div className="relative h-[320px] overflow-hidden">
        {/* Background image */}
        <img
          src="/hero-main.jpg"
          alt="Modern luxury apartments"
          className="w-full h-full object-cover"
        />
        {/* Dark overlay — multi-layer for depth */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0F]/70 via-[#0A0A0F]/50 to-[#0A0A0F]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0F]/80 via-transparent to-[#0A0A0F]/40" />

        {/* Hero content */}
        <div className="absolute inset-0 flex flex-col justify-between p-5">
          {/* Top: Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center shadow-lg shadow-blue-500/30">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
            </div>
            <span className="text-sm font-bold text-white tracking-wide">WeHouse</span>
            <span className="ml-auto text-[10px] font-medium text-white/50 bg-white/10 backdrop-blur-md px-2.5 py-1 rounded-full">
              {profile.city || 'Nigeria'}
            </span>
          </div>

          {/* Middle: Headline + Search */}
          <div className="mt-auto">
            <h1 className="text-2xl font-bold text-white leading-tight mb-1">
              Find Your<br />
              <span className="text-[#3B82F6]">Perfect Home</span>
            </h1>
            <p className="text-xs text-white/60 mb-4">
              Houses, apartments & roommates in Nigeria
            </p>

            {/* Search bar — integrated on hero */}
            <button
              onClick={() => onNavigate('search')}
              className="w-full h-12 glass-strong rounded-xl flex items-center px-4 gap-3 text-white/50 text-sm hover:border-[#3B82F6]/40 transition-all shadow-xl"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <span>Search by location, price, type...</span>
              <div className="ml-auto w-8 h-8 rounded-lg bg-[#3B82F6] flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* ─── STATS BAR ────────────────────────────────────── */}
      <div className="px-5 -mt-5 relative z-10">
        <div className="glass-strong rounded-2xl p-4 flex items-center justify-around">
          <StatCard
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>}
            value={totalListings.toString()}
            label="Listings"
          />
          <div className="w-px h-8 bg-white/10" />
          <StatCard
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>}
            value={totalCities.toString()}
            label="Cities"
          />
          <div className="w-px h-8 bg-white/10" />
          <StatCard
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>}
            value={availableCount.toString()}
            label="Available"
          />
        </div>
      </div>

      {/* ─── POPULAR LOCATIONS ────────────────────────────── */}
      {popularCities.length > 0 && (
        <section className="mt-7 px-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-white">Popular Locations</h2>
              <p className="text-[10px] text-[#5C5E72] mt-0.5">Explore top cities</p>
            </div>
            <button onClick={() => onNavigate('search')} className="text-[10px] text-[#3B82F6] font-semibold">View all</button>
          </div>
          <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1 -mx-5 px-5">
            {popularCities.map((city, i) => {
              const count = listings.filter(l => l.city === city).length;
              const isActive = cityFilter === city;
              return (
                <LocationCard
                  key={city}
                  city={city}
                  count={count}
                  image={locationImages[i % locationImages.length]}
                  onClick={() => setCityFilter(isActive ? null : city)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* ─── CITY FILTER CHIPS ────────────────────────────── */}
      {popularCities.length > 0 && (
        <section className="mt-4 px-5">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setCityFilter(null)}
              className={`flex-shrink-0 h-9 px-4 rounded-full text-[11px] font-semibold transition-all ${
                cityFilter === null
                  ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
                  : 'bg-[#12121A] border border-[#1E1E2C] text-[#8A8B9C] hover:border-[#3B82F6]/30'
              }`}
            >
              All
            </button>
            {popularCities.map(city => (
              <button
                key={city}
                onClick={() => setCityFilter(cityFilter === city ? null : city)}
                className={`flex-shrink-0 h-9 px-4 rounded-full text-[11px] font-semibold transition-all ${
                  cityFilter === city
                    ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
                    : 'bg-[#12121A] border border-[#1E1E2C] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }`}
              >
                {city}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ─── FEATURED PROPERTIES ──────────────────────────── */}
      {featured.length > 0 && (
        <section className="mt-7">
          <div className="flex items-center justify-between mb-3 px-5">
            <div>
              <h2 className="text-sm font-bold text-white">Featured Properties</h2>
              <p className="text-[10px] text-[#5C5E72] mt-0.5">Premium handpicked listings</p>
            </div>
            <button onClick={() => onNavigate('search')} className="text-[10px] text-[#3B82F6] font-semibold">See all</button>
          </div>
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex gap-3.5 px-5" style={{ minWidth: 'max-content' }}>
              {featured.map(l => (
                <div key={l.id} className="w-[300px] flex-shrink-0">
                  <ListingCard listing={l} onClick={() => onNavigate('detail', l.id)} isSaved={savedIds.has(l.id)} onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── ROOMMATE CTA — Full-width with image ─────────── */}
      <section className="mt-7 px-5">
        <button
          onClick={() => onNavigate('roommate')}
          className="relative w-full h-[140px] rounded-2xl overflow-hidden group text-left card-hover"
        >
          <img
            src="/roommate-bg.jpg"
            alt="Shared apartment"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0F]/90 via-[#0A0A0F]/60 to-transparent" />
          <div className="absolute inset-0 flex items-center p-5">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-xl bg-[#3B82F6]/20 backdrop-blur-md flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                </div>
                <span className="text-[10px] font-semibold text-[#3B82F6] uppercase tracking-wider">Roommate Match</span>
              </div>
              <p className="text-base font-bold text-white leading-tight">Find a Roommate</p>
              <p className="text-[11px] text-white/60 mt-1 max-w-[200px]">Connect with people looking to share housing costs</p>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="flex-shrink-0 opacity-60"><path d="M9 18l6-6-6-6" /></svg>
          </div>
        </button>
      </section>

      {/* ─── VERIFIED HOUSING BANNER ──────────────────────── */}
      <section className="mt-4 px-5">
        <div className="glass-strong rounded-2xl p-4 border border-green-500/10 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="1.5"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">Verified Housing</p>
            <p className="text-[11px] text-[#5C5E72] mt-0.5">All listings are reviewed by our team before going live</p>
          </div>
          <div className="flex -space-x-2 flex-shrink-0">
            {['bg-blue-500', 'bg-green-500', 'bg-amber-500'].map((color, i) => (
              <div key={i} className={`w-7 h-7 rounded-full ${color} border-2 border-[#0A0A0F] flex items-center justify-center`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── RECENTLY ADDED ───────────────────────────────── */}
      {recent.length > 0 && (
        <section className="mt-7 px-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-white">Recently Added</h2>
              <p className="text-[10px] text-[#5C5E72] mt-0.5">Newest properties on the market</p>
            </div>
            <button onClick={() => onNavigate('search')} className="text-[10px] text-[#3B82F6] font-semibold">See all</button>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            {recent.map(l => (
              <ListingCard key={l.id} listing={l} onClick={() => onNavigate('detail', l.id)} isSaved={savedIds.has(l.id)} onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }} />
            ))}
          </div>
        </section>
      )}

      {/* ─── EXPLORE CITIES — Large visual section ────────── */}
      {popularCities.length > 0 && (
        <section className="mt-7 px-5">
          <div className="relative rounded-2xl overflow-hidden h-[160px]">
            <img
              src="/locations-bg.jpg"
              alt="Explore cities"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0F]/90 via-[#0A0A0F]/50 to-[#0A0A0F]/70" />
            <div className="absolute inset-0 flex flex-col justify-center p-5">
              <p className="text-[10px] font-semibold text-[#3B82F6] uppercase tracking-wider mb-1">Explore</p>
              <p className="text-lg font-bold text-white leading-tight">Housing across<br />Nigeria</p>
              <p className="text-[11px] text-white/60 mt-1.5">From Lagos to Abuja, find your next home</p>
              <button
                onClick={() => onNavigate('search')}
                className="mt-3 h-8 px-4 rounded-xl bg-[#3B82F6] text-white text-[11px] font-semibold self-start inline-flex items-center gap-1.5 hover:bg-[#2563EB] transition-colors"
              >
                Browse all
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ─── EMPTY STATE ──────────────────────────────────── */}
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

      {/* ─── ADD LISTING FAB ──────────────────────────────── */}
      {isAdmin && onGoToNewListing && listings.length > 0 && (
        <button
          onClick={onGoToNewListing}
          className="fixed bottom-20 right-5 w-13 h-13 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white flex items-center justify-center shadow-xl shadow-blue-500/30 hover:scale-105 active:scale-95 transition-transform z-40 w-14 h-14"
          aria-label="Add listing"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      )}
    </div>
  );
}
