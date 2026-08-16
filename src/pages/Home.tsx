import { useEffect, useMemo, useState } from 'react';
import { getAllListings } from '@/lib/supabase';
import ListingCard from '@/components/ListingCard';
import type { Listing, Profile } from '@/types';

interface HomeProps { profile: Profile; onNavigate: (page: string, listingId?: string) => void; savedIds: Set<string>; onToggleSave: (listingId: string) => void; }

export default function Home({ onNavigate, savedIds, onToggleSave }: HomeProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; void (async () => { const { listings: rows } = await getAllListings(); if (active) { setListings(rows || []); setLoading(false); } })(); return () => { active = false; }; }, []);
  const recent = listings.slice(0, 8);
  const areas = useMemo(() => new Set(listings.map(item => item.city).filter(Boolean)).size, [listings]);

  return <div className="min-h-[100dvh] overflow-x-hidden bg-[#0A0A0F] pb-[calc(6rem+env(safe-area-inset-bottom))] text-white">
    <section className="border-b border-white/[.05] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,.15),transparent_40%),#0A0A0F] px-4 py-7 sm:px-6 lg:px-8 lg:py-12">
      <div className="mx-auto max-w-7xl">
        <p className="text-[9px] font-bold uppercase tracking-[.22em] text-violet-400">WEHOUSE</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">Living, short stays and local help in one place.</h1>
        <p className="mt-3 max-w-xl text-xs leading-relaxed text-[#858B9C] sm:text-sm">Explore homes, roommates, hotels and reviewed local professionals without jumping between different products.</p>
        <button onClick={() => onNavigate('explore')} className="mt-6 flex min-h-14 w-full max-w-2xl items-center gap-3 rounded-2xl border border-violet-500/15 bg-violet-500/[.06] px-4 text-left text-sm text-[#AEB3C1] sm:px-5"><span className="text-violet-300">⌕</span><span className="min-w-0 flex-1">Explore WeHouse</span><span className="text-violet-300">→</span></button>
        <div className="mt-4 flex flex-wrap gap-2"><Quick label="Homes" onClick={() => onNavigate('search')} /><Quick label="Roommates" onClick={() => onNavigate('roommate')} /><Quick label="Hotels" onClick={() => onNavigate('hotels')} /><Quick label="Local Services" onClick={() => onNavigate('worker_discovery')} /></div>
      </div>
    </section>

    <main className="mx-auto max-w-7xl space-y-7 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Metric label="Homes available" value={listings.length} /><Metric label="Areas with homes" value={areas} /><div className="col-span-2 sm:col-span-1"><Metric label="Discovery" value="One Explore hub" /></div></section>
      <section className="rounded-3xl border border-white/[.06] bg-[#10141C] p-5 sm:p-6"><div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="text-[9px] font-bold uppercase tracking-[.17em] text-violet-400">NEARBY SEARCH</p><h2 className="mt-2 text-lg font-bold">Location belongs inside Explore</h2><p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-[#717889]">Use real device location inside Homes or Hotels. Local Services uses your saved State/LGA until Worker GPS coverage exists.</p></div><button onClick={() => onNavigate('explore')} className="h-11 rounded-xl bg-violet-500 px-5 text-[10px] font-semibold">Open Explore</button></div></section>
      <section><div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-xl font-bold sm:text-2xl">Recently available</h2><p className="mt-1 text-[11px] text-[#666D7E]">A quick look at current homes.</p></div><button onClick={() => onNavigate('search')} className="shrink-0 text-xs font-semibold text-violet-300">View homes</button></div>{loading?<div className="grid min-h-52 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>:recent.length===0?<div className="rounded-3xl border border-dashed border-white/[.08] bg-white/[.015] px-5 py-14 text-center"><p className="text-base font-semibold">No homes are available right now</p><p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-[#666D7E]">New homes will appear here when they become available.</p></div>:<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{recent.map(listing=><ListingCard key={listing.id} listing={listing} onClick={()=>onNavigate('detail',listing.id)} isSaved={savedIds.has(listing.id)} onToggleSave={event=>{event.stopPropagation();onToggleSave(listing.id)}}/>)}</div>}</section>
    </main>
  </div>;
}

function Quick({label,onClick}:{label:string;onClick:()=>void}){return <button onClick={onClick} className="min-h-10 rounded-xl border border-white/[.07] bg-white/[.035] px-4 text-xs font-semibold text-[#C2C6D0] transition hover:border-violet-500/20 hover:text-white">{label}</button>}
function Metric({label,value}:{label:string;value:string|number}){return <div className="h-full min-w-0 rounded-2xl border border-white/[.06] bg-[#11141C] p-4"><p className="text-[10px] leading-snug text-[#666D7E]">{label}</p><p className="mt-2 break-words text-base font-bold lg:text-xl">{value}</p></div>}
