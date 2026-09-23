import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAllListings, getListing } from '@/lib/supabase/listings';
import { getHotels, getHotelById } from '@/lib/supabase/hotels';
import { listingDisplayTitle } from '@/lib/listingPresentation';
import { propertyShareUrl, type SharedProperty } from '@/lib/propertyShare';
import { savePropertyLinkIntent } from '@/lib/propertyLinkIntent';
import { publicPropertyImages } from '@/lib/publicPropertyMedia';
import { withTimeout } from '@/lib/withTimeout';
import { useRecordScreenBack } from '@/hooks/useRecordScreenBack';
import { useDialogInteraction } from '@/hooks/useDialogInteraction';
import PropertyMediaCarousel from '@/components/PropertyMediaCarousel';
import BackButton from '@/components/BackButton';
import type { Hotel, HotelRoom, Listing } from '@/types';

type PublicRoom = Pick<HotelRoom, "room_id" | "room_type" | "price_per_night"> & Partial<HotelRoom>;
type Place = { ref: SharedProperty; title: string; area: string; images: string[]; label: string; rate: string; description?: string | null; amenities: string[]; rooms?: PublicRoom[] };
const money = (value: number) => Number.isFinite(value) && value > 0 ? `₦${value.toLocaleString()}` : '';
const home = (item: Listing): Place => ({ ref: { kind: 'listing', id: String(item.id) }, title: listingDisplayTitle(item), area: [item.city, item.state].filter(Boolean).join(', '), images: publicPropertyImages(item.images), label: item.sub_type === 'short_let' ? 'Short Let' : 'Long Let', rate: money(Number(item.price)) ? `${money(Number(item.price))} / ${item.sub_type === 'short_let' ? 'night' : 'year'}` : 'Price unavailable', description: item.description, amenities: item.amenities || [] });
const hotel = (item: Hotel & { hotel_rooms?: PublicRoom[] }): Place => {
  const prices = (item.hotel_rooms || []).map(room => Number(room.price_per_night)).filter(price => Number.isFinite(price) && price > 0);
  return { ref: { kind: 'hotel', id: String(item.hotel_id) }, title: item.name, area: [item.city, item.state].filter(Boolean).join(', '), images: publicPropertyImages(item.images), label: 'Hotel', rate: prices.length ? `From ${money(Math.min(...prices))} / night` : 'Choose a room to see rates', description: item.description, amenities: item.amenities || [], rooms: item.hotel_rooms?.map(room => ({ ...room, images: publicPropertyImages(room.images) })) };
};
const action = 'min-h-12 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white';

/** Read-only entry using the same redacted public RPCs as discovery. No fake
 * Profile, anonymous Auth account, raw private table read, or booking mutation. */
export default function GuestBrowseEntry({ onSignIn }: { onSignIn: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="mt-3 min-h-11 w-full text-sm font-semibold text-violet-300">Explore places first</button>
    {open && <PublicPlaces onClose={() => setOpen(false)} onSignIn={onSignIn} />}
  </>;
}

function PublicPlaces({ onClose, onSignIn }: { onClose: () => void; onSignIn: () => void }) {
  const [places, setPlaces] = useState<Place[]>([]), [target, setTarget] = useState<SharedProperty | null>(null), [detail, setDetail] = useState<Place | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [query, setQuery] = useState(''), [kind, setKind] = useState('all');
  const dismiss = useRecordScreenBack(onClose);
  const returnToList = useRecordScreenBack(() => setTarget(null), Boolean(target));
  const back = target ? returnToList : dismiss;
  const dialogRef = useDialogInteraction(back);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setDetail(null);
    void (async () => {
      if (target) {
        let place: Place | null = null;
        if (target.kind === 'listing') {
          const result = await withTimeout(getListing(target.id), 15000, 'Property took too long to load.');
          if (result.error) throw result.error;
          if (result.listing && String(result.listing.id) === target.id) place = home(result.listing);
        } else {
          const result = await withTimeout(getHotelById(Number(target.id)), 15000, 'Hotel took too long to load.');
          if (result.error) throw result.error;
          if (result.hotel && String(result.hotel.hotel_id) === target.id) place = hotel(result.hotel);
        }
        if (active) { setDetail(place); if (!place) setError('This property is not currently available.'); }
      } else {
        const results = await Promise.allSettled([
          withTimeout(getAllListings(), 15000, 'Homes took too long to load.'),
          withTimeout(getHotels(), 15000, 'Hotels took too long to load.'),
        ]);
        if (!active) return;
        const [homes, hotels] = results;
        const next: Place[] = [];
        if (homes.status === 'fulfilled' && !homes.value.error) next.push(...homes.value.listings.map(home));
        if (hotels.status === 'fulfilled' && !hotels.value.error) next.push(...hotels.value.hotels.map(hotel));
        setPlaces(next);
        if (results.some(result => result.status === 'rejected' || result.value.error)) setError('Some places could not be loaded. Please try again.');
      }
    })().catch(() => { if (active) setError('Places could not be loaded. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [target, attempt]);
  function signIn() {
    if (target) {
      // Retain only a public property reference. Sign-in never starts a payment.
      try { savePropertyLinkIntent(target, sessionStorage); } catch { /* Continue without stored intent. */ }
      const hash = new URL(propertyShareUrl(target)).hash;
      history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    onClose(); onSignIn();
  }
  const visible = places.filter(place => (kind === 'all' || place.label === kind) && `${place.title} ${place.area}`.toLowerCase().includes(query.trim().toLowerCase()));
  return createPortal(<div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Explore WeHouse" className="fixed inset-0 z-[100070] flex flex-col bg-[#090B10] text-white">
    <header className="shrink-0 border-b border-white/10 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]"><div className="mx-auto flex max-w-5xl items-center gap-3"><BackButton onClick={back} ariaLabel={target ? 'Back to places' : 'Back to welcome'} /><div className="min-w-0 flex-1"><p className="text-xs font-semibold tracking-widest text-violet-300">WEHOUSE</p><h1 className="mt-1 text-lg font-semibold">{target ? 'Property details' : 'Explore places'}</h1></div><button onClick={signIn} className="min-h-11 px-2 text-sm font-semibold text-violet-300">Sign in</button></div></header>
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"><div className="mx-auto max-w-5xl py-5">
      {!target && <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_180px]"><label className="text-sm text-[#AAA3B3]">Find a place<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, city or state" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#151822] px-3 text-base text-white" /></label><label className="text-sm text-[#AAA3B3]">Type<select value={kind} onChange={event => setKind(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#151822] px-3 text-base text-white"><option value="all">All places</option>{['Short Let', 'Long Let', 'Hotel'].map(type => <option key={type}>{type}</option>)}</select></label></div>}
      {loading ? <p role="status" className="py-10 text-sm text-[#AAA3B3]">Loading places…</p> : <>
        {error && <div role="alert" className="mb-5 text-sm leading-6 text-[#AAA3B3]"><p>{error}</p><button className="min-h-11 font-semibold text-violet-300" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
        {target && detail ? <article className="mx-auto max-w-3xl">
          <PropertyMediaCarousel images={detail.images} title={detail.title} />
          <div className="space-y-5 py-5"><p className="text-sm text-violet-300">{detail.label}</p><h2 className="text-2xl font-semibold">{detail.title}</h2><p className="text-base text-[#AAA3B3]">{detail.area}</p><p className="text-lg font-semibold">{detail.rate}</p>
          {detail.description && <p className="whitespace-pre-wrap text-base leading-7 text-[#CBC7D3]">{detail.description}</p>}
          {!!detail.amenities.length && <p className="text-sm leading-6 text-[#AAA3B3]">{detail.amenities.join(' · ')}</p>}
          {!!detail.rooms?.length && <section className="divide-y divide-white/10"><h3 className="pb-3 text-lg font-semibold">Room types</h3>{detail.rooms.map(room => <div key={room.room_id} className="flex gap-4 py-4">{room.images?.[0] && <img src={room.images[0]} alt="" loading="lazy" className="h-24 w-24 shrink-0 rounded-xl object-cover" />}<div className="min-w-0"><h4 className="text-base font-semibold">{room.room_type}</h4><p className="mt-1 text-sm text-[#AAA3B3]">{[room.bed_type, room.max_guests ? `Up to ${room.max_guests} guests` : null].filter(Boolean).join(' · ')}</p><p className="mt-2 text-sm">{money(Number(room.price_per_night)) || 'Rate unavailable'}{money(Number(room.price_per_night)) ? ' / night' : ''}</p></div></div>)}</section>}
          <p className="text-sm leading-6 text-[#AAA3B3]">These are published rates, not a confirmed booking total. Sign in to choose your dates and review availability, the full price and cancellation terms before payment.</p><button className={`${action} w-full`} onClick={signIn}>Sign in to continue</button></div>
        </article> : !target ? <div className="divide-y divide-white/10">{visible.map(place => <button key={`${place.ref.kind}:${place.ref.id}`} type="button" aria-label={`View ${place.title}`} onClick={() => setTarget(place.ref)} className="flex min-h-32 w-full items-center gap-4 py-4 text-left"><div className="h-24 w-28 shrink-0 overflow-hidden rounded-xl bg-[#1C1929]">{place.images[0] && <img src={place.images[0]} alt="" loading="lazy" className="h-full w-full object-cover" />}</div><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-violet-300">{place.label}</p><h2 className="mt-1 break-words text-base font-semibold">{place.title}</h2><p className="mt-1 text-sm text-[#AAA3B3]">{place.area}</p><p className="mt-2 text-sm">{place.rate}</p></div><span aria-hidden="true" className="text-violet-300">›</span></button>)}{!visible.length && !error && <p className="py-10 text-sm text-[#AAA3B3]">No published places match this search.</p>}</div> : null}
      </>}
    </div></main>
  </div>, document.body);
}
