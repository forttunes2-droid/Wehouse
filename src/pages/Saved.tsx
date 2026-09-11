import { useEffect, useState } from 'react';
import { getAllListings } from '@/lib/supabase';
import ListingCard from '@/components/ListingCard';
import type { Listing, Profile } from '@/types';
import { Toaster, toast } from 'sonner';
import BackButton from '@/components/BackButton';
import {
  getMySavedSearches,
  removeSavedSearch,
  setSavedSearchAlerts,
  type SavedSearch,
} from '@/lib/supabase/saved-searches';

interface SavedProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
  onBack: () => void;
}

export default function Saved({ profile, onNavigate, savedIds, onToggleSave, onBack }: SavedProps) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySearch, setBusySearch] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const [{ listings: available }, followed] = await Promise.all([
        savedIds.size ? getAllListings() : Promise.resolve({ listings: [] }),
        getMySavedSearches(),
      ]);
      if (!active) return;
      setListings((available || []).filter(listing => savedIds.has(listing.id)));
      setSearches(followed.searches);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [profile.user_id, savedIds]);

  async function toggleAlerts(search: SavedSearch) {
    setBusySearch(search.id);
    const { error } = await setSavedSearchAlerts(search.id, !search.notifications_enabled);
    setBusySearch(null);
    if (error) return toast.error(error.message);
    setSearches(current => current.map(item => item.id === search.id ? { ...item, notifications_enabled: !item.notifications_enabled } : item));
    toast.success(search.notifications_enabled ? 'Search alerts paused' : 'Search alerts resumed');
  }

  async function removeSearch(search: SavedSearch) {
    setBusySearch(search.id);
    const { error } = await removeSavedSearch(search.id);
    setBusySearch(null);
    if (error) return toast.error(error.message);
    setSearches(current => current.filter(item => item.id !== search.id));
    toast.success('Followed search removed');
  }

  return (
    <div className="min-h-screen bg-[#090B10] pb-24 text-white">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-30 border-b border-white/[0.055] bg-[#090B10]/95 px-4 py-4 backdrop-blur-xl sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-5xl items-start gap-3">
          <BackButton onClick={onBack} />
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[.22em] text-violet-400">WEHOUSE · ACCOUNT</p>
            <h1 className="mt-1 text-xl font-bold">Saved</h1>
            <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-[#777A8C]">Saved apartments and followed-search alerts.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-5 sm:px-5 lg:px-8">
        <section>
        <div className="mb-3"><h2 className="text-sm font-semibold">Saved apartments</h2><p className="mt-1 text-[9px] text-[#707687]">Saving keeps an apartment here. It does not start a booking.</p></div>
        {loading ? (
          <div className="grid min-h-56 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>
        ) : listings.length === 0 ? (
          <section className="border-y border-white/[0.07] px-6 py-16 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-violet-500/[0.08]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#66687B" strokeWidth="1.6"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
            </div>
            <h2 className="mt-4 text-sm font-semibold">No saved apartments yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-[#66687B]">Tap the heart on an apartment to keep it here for later.</p>
            <button onClick={() => onNavigate('search')} className="mt-5 rounded-full bg-violet-500 px-5 py-3 text-xs font-semibold">Browse apartments</button>
          </section>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map(listing => (
              <ListingCard key={listing.id} listing={listing} onClick={() => onNavigate('detail', listing.id)} isSaved onToggleSave={event => { event.stopPropagation(); onToggleSave(listing.id); }} />
            ))}
          </div>
        )}
        </section>
        {!loading ? <section>
          <div className="mb-3"><h2 className="text-sm font-semibold">Followed searches</h2><p className="mt-1 text-[9px] text-[#707687]">Alerts appear in Inbox Activity when a newly published property matches.</p></div>
          {searches.length ? <div className="divide-y divide-white/[.06] border-y border-white/[.06]">{searches.map(search => <article key={search.id} className="py-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-xs font-semibold">{search.name}</p><p className="mt-1 text-[9px] text-[#707687]">{search.search_kind === 'hotels' ? 'Hotels' : 'Apartments'} · {searchCriteriaSummary(search.criteria)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold ${search.notifications_enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/[.05] text-[#777D8D]'}`}>{search.notifications_enabled ? 'Alerts on' : 'Paused'}</span></div><div className="mt-3 flex gap-2"><button disabled={busySearch === search.id} onClick={() => void toggleAlerts(search)} className="h-9 rounded-xl border border-violet-500/20 px-3 text-[9px] font-semibold text-violet-300 disabled:opacity-40">{search.notifications_enabled ? 'Pause alerts' : 'Resume alerts'}</button><button disabled={busySearch === search.id} onClick={() => void removeSearch(search)} className="h-9 rounded-xl border border-red-500/15 px-3 text-[9px] font-semibold text-red-300 disabled:opacity-40">Remove</button></div></article>)}</div> : <div className="border-y border-dashed border-white/[.07] py-10 text-center"><p className="text-xs font-semibold">No followed searches</p><p className="mt-2 text-[9px] text-[#707687]">Set filters in Explore, then choose Follow search.</p></div>}
        </section> : null}
      </main>
    </div>
  );
}

function searchCriteriaSummary(criteria: Record<string, unknown>) {
  const parts = [criteria.query ? `“${criteria.query}”` : null, criteria.city, criteria.state, criteria.sub_type === 'short_let' ? 'Short stay' : criteria.sub_type === 'long_stay' ? 'Long term' : null].filter(Boolean).map(String);
  const min = Number(criteria.min_price || 0), max = Number(criteria.max_price || 0);
  if (min || max) parts.push(`${min ? `from ₦${min.toLocaleString()}` : ''}${min && max ? ' ' : ''}${max ? `to ₦${max.toLocaleString()}` : ''}`);
  const amenities = Array.isArray(criteria.amenities) ? criteria.amenities.length : 0;
  if (amenities) parts.push(`${amenities} amenit${amenities === 1 ? 'y' : 'ies'}`);
  if (Number(criteria.radius_km || 0)) parts.push(`within ${Number(criteria.radius_km).toLocaleString()} km`);
  return parts.join(' · ') || 'Any location';
}
