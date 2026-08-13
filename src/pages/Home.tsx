import { useEffect, useMemo, useState } from 'react';
import { getAllListings } from '@/lib/supabase';
import ListingCard from '@/components/ListingCard';
import type { Listing, Profile } from '@/types';

interface HomeProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
}

type UserLocation = { lat: number; lng: number };

function distanceKm(a: UserLocation, b: { lat: number; lng: number }) {
  const r = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const q = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(q));
}

function coords(listing: Listing) {
  const row = listing as Listing & { gps_latitude?: number | null; gps_longitude?: number | null };
  const lat = Number(row.gps_latitude);
  const lng = Number(row.gps_longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export default function Home({ profile, onNavigate, savedIds, onToggleSave }: HomeProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loc, setLoc] = useState<UserLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { listings: rows } = await getAllListings();
      if (active) {
        setListings(rows || []);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const recent = listings.slice(0, 8);
  const areas = useMemo(() => new Set(listings.map(item => item.city).filter(Boolean)).size, [listings]);

  function useLocation() {
    if (!navigator.geolocation) {
      setLocError('Location is not available on this device');
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      position => {
        setLoc({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setLocError('We could not get your location. Check your browser permission and try again.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  return <div className="min-h-[100dvh] overflow-x-hidden bg-[#09090D] pb-[calc(6rem+env(safe-area-inset-bottom))] text-white">
    <section className="border-b border-white/[.05] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,.15),transparent_40%),#09090D] px-4 py-7 sm:px-6 lg:px-8 lg:py-12">
      <div className="mx-auto max-w-7xl">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-violet-300">WeHouse</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">Find a place that fits how you want to live.</h1>
          <p className="mt-3 max-w-xl text-xs leading-relaxed text-[#8A8C9E] sm:text-sm">Browse available homes, compare locations and use WeHouse services from one place.</p>
        </div>
        <button onClick={() => onNavigate('search')} className="mt-6 flex min-h-14 w-full max-w-2xl items-center gap-3 rounded-2xl border border-white/[.08] bg-white/[.045] px-4 text-left text-sm text-[#737588] sm:px-5">
          <span>⌕</span><span className="min-w-0 flex-1">Search by state, LGA, type or price</span><span className="text-violet-300">→</span>
        </button>
        <div className="mt-4 flex flex-wrap gap-2">
          <Quick active label="Apartments" onClick={() => onNavigate('search')} />
          <Quick label="Hotels" onClick={() => onNavigate('hotels')} />
          <Quick label="Find workers" onClick={() => onNavigate('worker_categories')} />
          <Quick label="Roommates" onClick={() => onNavigate('roommate')} />
        </div>
      </div>
    </section>

    <main className="mx-auto max-w-7xl space-y-7 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Homes available" value={listings.length} />
        <Metric label="Areas with homes" value={areas} />
        <div className="col-span-2 sm:col-span-1"><Metric label="Listings" value="Checked by WeHouse" /></div>
      </section>

      <section className="rounded-2xl border border-blue-500/10 bg-blue-500/[.035] p-4 sm:p-5">
        <p className="text-sm font-semibold">See homes near you</p>
        <p className="mt-1 text-[11px] leading-relaxed text-[#74788B]">Share your location only when you want distance estimates. Your browser handles the permission.</p>
        {locError && <p className="mt-2 text-[10px] text-red-300">{locError}</p>}
        <button onClick={useLocation} disabled={locating} className="mt-4 min-h-11 w-full rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 text-xs font-semibold text-blue-300 disabled:opacity-50 sm:w-auto">{locating ? 'Finding your location…' : loc ? 'Update my location' : 'Use my location'}</button>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div><h2 className="text-xl font-bold sm:text-2xl">Recently available</h2><p className="mt-1 text-[11px] text-[#66687B]">Homes currently available to explore.</p></div>
          <button onClick={() => onNavigate('search')} className="shrink-0 text-xs font-semibold text-violet-300">View all</button>
        </div>
        {loading ? <div className="grid min-h-52 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>
          : recent.length === 0 ? <div className="rounded-3xl border border-dashed border-white/[.08] bg-white/[.015] px-5 py-14 text-center"><p className="text-base font-semibold">No homes are available right now</p><p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-[#66687B]">New homes will appear here when they become available.</p></div>
            : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{recent.map(listing => {
              const listingCoords = coords(listing);
              const distance = loc && listingCoords ? distanceKm(loc, listingCoords) : null;
              return <ListingCard key={listing.id} listing={listing} distanceKm={distance} onClick={() => onNavigate('detail', listing.id)} isSaved={savedIds.has(listing.id)} onToggleSave={event => { event.stopPropagation(); onToggleSave(listing.id); }} />;
            })}</div>}
      </section>
    </main>
  </div>;
}

function Quick({ label, onClick, active = false }: { label: string; onClick: () => void; active?: boolean }) {
  return <button onClick={onClick} className={`min-h-10 rounded-xl px-4 text-xs font-semibold ${active ? 'bg-violet-500 text-white' : 'border border-white/[.07] bg-white/[.035] text-[#C2C3CE]'}`}>{label}</button>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="h-full min-w-0 rounded-2xl border border-white/[.06] bg-[#111119] p-4"><p className="text-[10px] leading-snug text-[#66687B]">{label}</p><p className="mt-2 break-words text-base font-bold lg:text-xl">{value}</p></div>;
}
