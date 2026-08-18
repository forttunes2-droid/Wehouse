import { useEffect, useState } from 'react';
import { getAllListings } from '@/lib/supabase';
import ListingCard from '@/components/ListingCard';
import type { Listing, Profile } from '@/types';

interface SavedProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
}

export default function Saved({ profile, onNavigate, savedIds, onToggleSave }: SavedProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (savedIds.size === 0) {
        if (active) { setListings([]); setLoading(false); }
        return;
      }
      setLoading(true);
      const { listings: available } = await getAllListings();
      if (!active) return;
      setListings((available || []).filter(listing => savedIds.has(listing.id)));
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [savedIds]);

  return (
    <div className="min-h-screen bg-[#09090D] pb-24 text-white">
      <header className="border-b border-white/[0.05] bg-[#0D0D13] px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-lg font-bold">Saved properties</h1>
          <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-[#777A8C]">Your private shortlist of properties to compare or revisit later. Saving does not reserve a property or remove it from availability.</p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 lg:px-8">
        {loading ? (
          <div className="grid min-h-56 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>
        ) : listings.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-16 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/[0.05] bg-[#15151E]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#66687B" strokeWidth="1.6"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
            </div>
            <h2 className="mt-4 text-sm font-semibold">No saved properties yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-[#66687B]">Tap the heart on a property to keep it in this private shortlist. Use Reservations for properties you have actually started reserving.</p>
            <button onClick={() => onNavigate('search')} className="mt-5 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold">Browse apartments</button>
          </section>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map(listing => (
              <ListingCard key={listing.id} listing={listing} onClick={() => onNavigate('detail', listing.id)} isSaved onToggleSave={event => { event.stopPropagation(); onToggleSave(listing.id); }} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
