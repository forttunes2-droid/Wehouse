import { useState, useEffect } from 'react';
import { getAllListings } from '@/lib/supabase';
import ListingCard from '@/components/ListingCard';
import type { Listing, Profile } from '@/types';

interface HomeProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
}

export default function Home({ profile, onNavigate, savedIds, onToggleSave }: HomeProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { listings: data } = await getAllListings();
      setListings(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const featured = listings.slice(0, 5);
  const recent = listings.slice(0, 8);
  const student = listings.filter(l => l.bedrooms >= 1 && l.price <= 300000).slice(0, 8);
  const nearby = listings.slice(0, 8);

  function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
    return (
      <div className="flex items-center justify-between mb-3 px-5">
        <h2 className="text-base font-semibold text-[#0F1724]">{title}</h2>
        {onSeeAll && (
          <button onClick={onSeeAll} className="text-xs text-[#C8A45A] font-medium">
            See all
          </button>
        )}
      </div>
    );
  }

  function HorizontalScroll({ children }: { children: React.ReactNode }) {
    return (
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 px-5 pb-2" style={{ minWidth: 'max-content' }}>
          {children}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF8F5] pb-20">
      {/* Header */}
      <header className="bg-[#0F1724] text-white px-5 pt-4 pb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#C8A45A] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0F1724" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <span className="font-semibold text-sm">WeHouse</span>
          </div>
          <span className="text-xs text-white/50">@{profile.username}</span>
        </div>

        {/* Search bar */}
        <button
          onClick={() => onNavigate('search')}
          className="w-full h-10 bg-white/10 rounded-xl flex items-center px-4 gap-2 text-white/50 text-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          Search houses, locations...
        </button>
      </header>

      {/* Featured */}
      {featured.length > 0 && (
        <section className="mt-5">
          <SectionHeader title="Featured Homes" onSeeAll={() => onNavigate('search')} />
          <HorizontalScroll>
            {featured.map(l => (
              <div key={l.id} className="w-[280px] flex-shrink-0">
                <ListingCard
                  listing={l}
                  onClick={() => onNavigate('detail', l.id)}
                  isSaved={savedIds.has(l.id)}
                  onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }}
                />
              </div>
            ))}
          </HorizontalScroll>
        </section>
      )}

      {/* Recent */}
      {recent.length > 0 && (
        <section className="mt-6">
          <SectionHeader title="Recent Listings" onSeeAll={() => onNavigate('search')} />
          <div className="px-5 grid grid-cols-2 gap-3">
            {recent.map(l => (
              <ListingCard
                key={l.id}
                listing={l}
                onClick={() => onNavigate('detail', l.id)}
                isSaved={savedIds.has(l.id)}
                onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Student Housing */}
      {student.length > 0 && (
        <section className="mt-6">
          <SectionHeader title="Student Housing" onSeeAll={() => onNavigate('search')} />
          <HorizontalScroll>
            {student.map(l => (
              <div key={l.id} className="w-[240px] flex-shrink-0">
                <ListingCard
                  listing={l}
                  onClick={() => onNavigate('detail', l.id)}
                  isSaved={savedIds.has(l.id)}
                  onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }}
                />
              </div>
            ))}
          </HorizontalScroll>
        </section>
      )}

      {/* Nearby */}
      {nearby.length > 0 && (
        <section className="mt-6 mb-6">
          <SectionHeader title="Nearby Homes" onSeeAll={() => onNavigate('search')} />
          <div className="px-5 grid grid-cols-2 gap-3">
            {nearby.map(l => (
              <ListingCard
                key={l.id}
                listing={l}
                onClick={() => onNavigate('detail', l.id)}
                isSaved={savedIds.has(l.id)}
                onToggleSave={(e) => { e.stopPropagation(); onToggleSave(l.id); }}
              />
            ))}
          </div>
        </section>
      )}

      {listings.length === 0 && (
        <div className="text-center py-20 text-[#8B8680] text-sm">
          No listings yet. Check back soon!
        </div>
      )}
    </div>
  );
}
