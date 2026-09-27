import { useEffect, useMemo, useRef, useState } from 'react';
import { getListing } from '@/lib/supabase/listings';
import { getHotelById } from '@/lib/supabase/hotels';
import { getMySavedHotelIds, unsaveHotel } from '@/lib/supabase/saved-hotels';
import { listingDisplayTitle } from '@/lib/listingPresentation';
import { locationLabel } from '@/lib/locationPresentation';
import { withTimeout } from '@/lib/withTimeout';
import { mapConcurrent } from '@/lib/mapConcurrent';
import { savedHomePrice, SAVED_TYPE_LABELS, visibleSavedPlaces, type SavedPlace, type SavedPlaceType } from '@/lib/savedPlacePresentation';
import BackButton from '@/components/BackButton';
import type { Profile } from '@/types';
import { toast } from 'sonner';

interface SavedProps {
  profile: Profile;
  onNavigate: (page: string, id?: string) => void;
  savedIds: Set<string>;
  onToggleSave: (listingId: string) => void;
  onBack: () => void;
}
type Snapshot = { key: string; places: SavedPlace[]; loading: boolean; error: string };
type SavedRef = { kind: 'listing' | 'hotel'; id: string };

export default function Saved({ profile, onNavigate, savedIds, onToggleSave, onBack }: SavedProps) {
  const idsKey = JSON.stringify([...savedIds].sort());
  const loadKey = `${profile.user_id}:${idsKey}`;
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: '', places: [], loading: true, error: '' });
  const [filter, setFilter] = useState<'all' | SavedPlaceType>('all');
  const [retry, setRetry] = useState(0);
  const [busyHotel, setBusyHotel] = useState<number | null>(null);
  const busyHotelRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    setSnapshot({ key: loadKey, places: [], loading: true, error: '' });
    void (async () => {
      try {
        const savedHotels = await withTimeout(getMySavedHotelIds(), 15000, 'Saved places took too long to load.');
        if (!active) return;
        if (savedHotels.error) throw savedHotels.error;
        const refs: SavedRef[] = (JSON.parse(idsKey) as string[]).map(id => ({ kind: 'listing', id }));
        for (const hotelId of new Set(savedHotels.hotelIds)) {
          const value = Number(hotelId);
          if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid saved hotel response.');
          refs.push({ kind: 'hotel', id: String(value) });
        }
        const places = await mapConcurrent(refs, 4, async (ref): Promise<SavedPlace> => {
          // Read the exact saved record through the existing public, redacted API.
          // A discovery filter must not silently remove a saved record.
          if (ref.kind === 'listing') {
            const result = await withTimeout(getListing(ref.id), 15000, 'A saved home took too long to load.');
            if (result.error) throw result.error;
            const listing = result.listing;
            if (!listing) return unavailablePlace(ref);
            if (String(listing.id) !== ref.id) throw new Error('Saved home response did not match.');
            const shortLet = listing.sub_type === 'short_let';
            return {
              key: `listing:${ref.id}`, id: ref.id, type: shortLet ? 'short_let' : 'long_let',
              title: listingDisplayTitle(listing),
              location: locationLabel(listing.address, listing.city, listing.state) || 'Location unavailable',
              image: listing.images?.[0] || null,
              detail: savedHomePrice(listing.price, shortLet), unavailable: false,
            };
          }
          const result = await withTimeout(getHotelById(Number(ref.id)), 15000, 'A saved hotel took too long to load.');
          if (result.error) throw result.error;
          const hotel = result.hotel;
          if (!hotel) return unavailablePlace(ref);
          if (String(hotel.hotel_id) !== ref.id) throw new Error('Saved hotel response did not match.');
          return {
            key: `hotel:${ref.id}`, id: ref.id, type: 'hotel', title: hotel.name,
            location: [hotel.area, hotel.city, hotel.state].filter(Boolean).join(', ') || 'Location unavailable',
            image: hotel.images?.[0] || null, detail: 'View rooms and dates', unavailable: false,
          };
        }, () => active);
        if (active) setSnapshot({ key: loadKey, places, loading: false, error: '' });
      } catch {
        // Failure is not an empty Saved list. Do not show another account's cache.
        if (active) setSnapshot({ key: loadKey, places: [], loading: false,
          error: 'Saved places could not be loaded. Your saved items have not been removed.' });
      }
    })();
    return () => { active = false; };
  }, [idsKey, loadKey, retry]);

  const loading = snapshot.key !== loadKey || snapshot.loading;
  const places = snapshot.key === loadKey ? snapshot.places : [];
  const visible = useMemo(() => visibleSavedPlaces(places, filter), [places, filter]);

  async function removeHotel(id: number) {
    if (busyHotelRef.current !== null) return;
    busyHotelRef.current = id;
    setBusyHotel(id);
    try {
      const result = await withTimeout(unsaveHotel(id), 15000, 'The hotel could not be removed. Try again.');
      if (result.error) throw result.error;
      setSnapshot(current => current.key === loadKey
        ? { ...current, places: current.places.filter(place => place.key !== `hotel:${id}`) }
        : current);
      toast.success('Hotel removed from Saved');
    } catch { toast.error('The hotel could not be removed. Try again.'); }
    finally { busyHotelRef.current = null; setBusyHotel(null); }
  }

  return <div className="min-h-screen bg-[#090B10] pb-12 text-white">
    <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#090B10]/95 px-4 py-4 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <BackButton onClick={onBack} />
        <div><h1 className="text-xl font-semibold">Saved</h1><p className="mt-1 text-sm text-[#AAA3B3]">Places you want to come back to.</p></div>
      </div>
    </header>
    <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
      {loading ? <p role="status" className="py-10 text-sm text-[#AAA3B3]">Loading saved places…</p>
        : snapshot.error ? <div role="alert" className="space-y-3 py-8">
          <p className="text-sm leading-6">{snapshot.error}</p>
          <button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 rounded-xl border border-violet-400/30 px-4 text-sm text-violet-300">Try again</button>
        </div> : <>
          {places.length > 0 && <label className="mb-3 flex items-center justify-between gap-4 border-b border-white/[.06] pb-4 text-sm">
            <span className="text-[#AAA3B3]">Property type</span>
            <select value={filter} onChange={event => setFilter(event.target.value as 'all' | SavedPlaceType)}
              className="min-h-11 max-w-full rounded-xl border border-white/[.1] bg-[#11141C] px-3 text-base text-white">
              <option value="all">All places</option><option value="long_let">Long Let</option>
              <option value="short_let">Short Let</option><option value="hotel">Hotels</option>
            </select>
          </label>}
          {visible.length ? <ul className="divide-y divide-white/[.06]">
            {visible.map(place => <SavedPlaceRow key={place.key} place={place}
              busy={place.type === 'hotel' && busyHotel !== null}
              onOpen={() => onNavigate(place.type === 'hotel' ? 'hotel_detail' : 'detail', place.id)}
              onRemove={() => place.type === 'hotel' ? void removeHotel(Number(place.id)) : onToggleSave(place.id)} />)}
          </ul> : <div className="py-12 text-center">
            <h2 className="text-base font-semibold">{places.length ? 'No saved places of this type' : 'No saved places yet'}</h2>
            <p className="mt-2 text-sm leading-6 text-[#AAA3B3]">{places.length ? 'Choose All places to see the rest.' : 'Tap the heart on a home or hotel to keep it here.'}</p>
            <button type="button" onClick={() => places.length ? setFilter('all') : onNavigate('search')}
              className="mt-4 min-h-11 rounded-xl border border-violet-400/30 px-4 text-sm text-violet-300">{places.length ? 'Show all places' : 'Explore places'}</button>
          </div>}
        </>}
    </main>
  </div>;
}

function unavailablePlace(ref: SavedRef): SavedPlace {
  return { key: `${ref.kind}:${ref.id}`, id: ref.id, type: ref.kind === 'hotel' ? 'hotel' : 'home',
    title: ref.kind === 'hotel' ? 'Saved hotel unavailable' : 'Saved home unavailable',
    location: '', image: null, detail: 'This place cannot be viewed right now.', unavailable: true };
}

function SavedPlaceRow({ place, busy, onOpen, onRemove }: {
  place: SavedPlace; busy: boolean; onOpen: () => void; onRemove: () => void;
}) {
  return <li className="flex items-center gap-2 py-4 sm:gap-4">
    <button type="button" onClick={onOpen} disabled={place.unavailable}
      aria-label={`View ${place.title}`} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60 sm:gap-4">
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-[#171B24]">
        {place.image ? <img src={place.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          : <span className="grid h-full place-items-center px-2 text-center text-xs text-[#AAA3B3]">No photo</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-violet-300">{SAVED_TYPE_LABELS[place.type]}</p>
        <h2 className="mt-1 break-words text-base font-semibold leading-6">{place.title}</h2>
        {place.location && <p className="mt-1 break-words text-sm leading-5 text-[#AAA3B3]">{place.location}</p>}
        <p className="mt-1 text-sm leading-5">{place.detail}</p>
      </div>
    </button>
    <button type="button" disabled={busy} onClick={onRemove} aria-label={`Remove ${place.title} from Saved`}
      aria-pressed="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-violet-300 disabled:opacity-40">
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>
    </button>
  </li>;
}
