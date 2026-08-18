import { useEffect, useState } from 'react';
import { getAllListings } from '@/lib/supabase';
import ListingCard from '@/components/ListingCard';
import type { Listing, Profile } from '@/types';

interface HomeProps { profile: Profile; onNavigate: (page: string, listingId?: string) => void; savedIds: Set<string>; onToggleSave: (listingId: string) => void; }

export default function Home({ profile, onNavigate, savedIds, onToggleSave }: HomeProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { listings: rows } = await getAllListings();
      if (active) { setListings(rows || []); setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const recent = listings.slice(0, 6);
  const firstName = String(profile.full_name || profile.username || '').trim().split(/\s+/)[0];

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#0A0A0F] pb-[calc(6rem+env(safe-area-inset-bottom))] text-white">
      <section className="border-b border-white/[.05] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,.16),transparent_44%),#0A0A0F] px-4 py-7 sm:px-6 lg:px-8 lg:py-11">
        <div className="mx-auto max-w-7xl">
          <p className="text-[9px] font-bold uppercase tracking-[.22em] text-violet-400">WEHOUSE</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">{firstName ? `Welcome, ${firstName}` : 'Welcome home'}</h1>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-[#858B9C] sm:text-sm">Find a home, roommate, short stay or local professional from one place.</p>
          <button onClick={() => onNavigate('search')} className="mt-5 flex min-h-13 w-full max-w-2xl items-center gap-3 rounded-2xl border border-violet-500/20 bg-violet-500/[.08] px-4 text-left text-sm text-[#C9CDD6] sm:px-5">
            <SearchIcon />
            <span className="min-w-0 flex-1">Search WeHouse</span>
            <span className="text-violet-300">→</span>
          </button>
        </div>
      </section>

      <main className="mx-auto max-w-7xl space-y-7 px-4 py-6 sm:px-6 lg:px-8">
        <section>
          <div className="mb-3"><h2 className="text-lg font-bold sm:text-xl">Find what you need</h2><p className="mt-1 text-[10px] text-[#666D7E]">Choose a WeHouse service.</p></div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ExploreCard title="Homes" text="Find available places" icon={<HomeIcon />} onClick={() => onNavigate('search')} />
            <ExploreCard title="Roommates" text="Find compatible people" icon={<PeopleIcon />} onClick={() => onNavigate('roommate')} />
            <ExploreCard title="Hotels" text="Book short stays" icon={<HotelIcon />} onClick={() => onNavigate('hotels')} />
            <ExploreCard title="Local Services" text="Hire reviewed professionals" icon={<ToolsIcon />} onClick={() => onNavigate('worker_discovery')} />
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div><h2 className="text-lg font-bold sm:text-xl">Recently available</h2><p className="mt-1 text-[10px] text-[#666D7E]">Homes added to WeHouse.</p></div>
            <button onClick={() => onNavigate('search')} className="shrink-0 text-[10px] font-semibold text-violet-300">View all</button>
          </div>
          {loading ? (
            <div className="grid min-h-44 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>
          ) : recent.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/[.08] bg-white/[.015] px-5 py-12 text-center">
              <p className="text-sm font-semibold">No homes available yet</p>
              <p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#666D7E]">New listings will appear here when they become available.</p>
              <button onClick={() => onNavigate('roommate')} className="mt-4 rounded-xl border border-white/[.08] px-4 py-2.5 text-[10px] font-semibold text-[#C0C4CE]">Find a roommate</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{recent.map(listing => <ListingCard key={listing.id} listing={listing} onClick={() => onNavigate('detail', listing.id)} isSaved={savedIds.has(listing.id)} onToggleSave={event => { event.stopPropagation(); onToggleSave(listing.id); }} />)}</div>
          )}
        </section>
      </main>
    </div>
  );
}

function ExploreCard({ title, text, icon, onClick }: { title: string; text: string; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-h-28 rounded-2xl border border-white/[.07] bg-[#11141C] p-4 text-left transition hover:border-violet-500/25 hover:bg-violet-500/[.04]"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/10 text-violet-300">{icon}</span><p className="mt-3 text-xs font-semibold">{title}</p><p className="mt-1 text-[9px] leading-snug text-[#6D7384]">{text}</p></button>;
}

function SearchIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-violet-300"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>}
function HomeIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/></svg>}
function PeopleIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20c.5-4 2.4-6 5.5-6s5 2 5.5 6M14.5 15c2.9-.5 5 .9 6 4"/></svg>}
function HotelIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 21V5h11v16M15 10h5v11M8 9h3M8 13h3M8 17h3"/></svg>}
function ToolsIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m14 6 4-4 4 4-4 4M4 20l8-8M3 7l4-4 4 4-4 4z"/></svg>}
