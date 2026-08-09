import { useEffect, useMemo, useState } from 'react';
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

function dashboardPage(role: string) {
  if (role === 'worker') return 'worker_dashboard';
  if (role === 'property_partner') return 'property_partner';
  if (role === 'staff') return 'staff_dashboard';
  if (role === 'admin') return 'admin';
  if (role === 'creator') return 'creator';
  return null;
}

export default function Home({ profile, onNavigate, savedIds, onToggleSave }: HomeProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const { listings: rows } = await getAllListings();
      if (!active) return;
      setListings(rows || []);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const recent = listings.slice(0, 8);
  const locations = useMemo(() => new Set(listings.map(item => item.city).filter(Boolean)).size, [listings]);
  const roleDashboard = dashboardPage(profile.role);
  const isCustomer = profile.role === 'user';

  return (
    <div className="min-h-screen bg-[#09090D] pb-24 text-white">
      <section className="border-b border-white/[0.05] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,.16),transparent_38%),#09090D] px-4 py-8 lg:px-8 lg:py-12">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">WeHouse</p>
              <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight lg:text-5xl">Find a place that fits how you want to live.</h1>
              <p className="mt-3 max-w-xl text-xs leading-relaxed text-[#8A8C9E] lg:text-sm">Browse available apartments, find hotels through the dedicated hotel flow, or use the services built for your WeHouse account.</p>
            </div>
            {roleDashboard && <button onClick={() => onNavigate(roleDashboard)} className="shrink-0 rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-2.5 text-xs font-semibold text-violet-300">Dashboard</button>}
          </div>

          <button onClick={() => onNavigate('search')} className="mt-7 flex h-14 w-full max-w-2xl items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.045] px-5 text-left text-sm text-[#737588] transition hover:border-violet-500/30 hover:bg-white/[0.06]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <span>Search apartments by state, LGA, type or price</span><span className="ml-auto text-violet-300">→</span>
          </button>

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => onNavigate('search')} className="rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold">Apartments</button>
            <button onClick={() => onNavigate('hotels')} className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-4 py-2.5 text-xs font-semibold text-[#C2C3CE]">Hotels</button>
            {isCustomer && <button onClick={() => onNavigate('worker_discovery')} className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-4 py-2.5 text-xs font-semibold text-[#C2C3CE]">Find workers</button>}
            {isCustomer && <button onClick={() => onNavigate('roommate')} className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-4 py-2.5 text-xs font-semibold text-[#C2C3CE]">Roommates</button>}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-7 lg:px-8">
        <section className="grid grid-cols-3 gap-3">
          <Metric label="Available apartments" value={listings.length} />
          <Metric label="LGAs represented" value={locations} />
          <Metric label="Public status" value="Available only" />
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Recently available</h2><p className="mt-1 text-[10px] text-[#66687B]">Approved listings currently open for reservation.</p></div><button onClick={() => onNavigate('search')} className="text-[10px] font-semibold text-violet-300">View all</button></div>
          {loading ? <div className="grid min-h-52 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div> : recent.length === 0 ? <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-14 text-center"><p className="text-sm font-semibold">No apartments are available right now</p><p className="mt-2 text-[10px] text-[#66687B]">Only listings approved and marked available appear here.</p></div> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{recent.map(listing => <ListingCard key={listing.id} listing={listing} onClick={() => onNavigate('detail', listing.id)} isSaved={savedIds.has(listing.id)} onToggleSave={event => { event.stopPropagation(); onToggleSave(listing.id); }} />)}</div>}
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] text-[#66687B]">{label}</p><p className="mt-2 text-sm font-bold lg:text-xl">{value}</p></div>;
}
