import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Search, MapPin, ArrowLeft } from 'lucide-react';
import { getAllListings, getListing } from '@/lib/supabase/listings';
import { getHotels, getHotelById } from '@/lib/supabase/hotels';
import { listingDisplayTitle } from '@/lib/listingPresentation';
import { propertyShareUrl, type SharedProperty } from '@/lib/propertyShare';
import { savePropertyLinkIntent } from '@/lib/propertyLinkIntent';
import { publicPropertyImages } from '@/lib/publicPropertyMedia';
import { withTimeout } from '@/lib/withTimeout';
import { useRecordScreenBack } from '@/hooks/useRecordScreenBack';
import { isTestEnvironment } from '@/lib/supabase/client';
import PropertyMediaCarousel from '@/components/PropertyMediaCarousel';
import type { Hotel, HotelRoom, Listing } from '@/types';

type PublicRoom = Pick<HotelRoom, 'room_id' | 'room_type' | 'price_per_night'> & Partial<HotelRoom>;
type Place = { ref: SharedProperty; title: string; area: string; images: string[]; label: string; rate: string; description?: string | null; amenities: string[]; rooms?: PublicRoom[] };
const money = (value: number) => Number.isFinite(value) && value > 0 ? `₦${value.toLocaleString()}` : '';
const home = (item: Listing): Place => ({ ref: { kind: 'listing', id: String(item.id) }, title: listingDisplayTitle(item), area: [item.city, item.state].filter(Boolean).join(', '), images: publicPropertyImages(item.images), label: item.sub_type === 'short_let' ? 'Short Let' : 'Long Let', rate: money(Number(item.price)) ? `${money(Number(item.price))} / ${item.sub_type === 'short_let' ? 'night' : 'year'}` : 'Price unavailable', description: item.description, amenities: item.amenities || [] });
const hotel = (item: Hotel & { hotel_rooms?: PublicRoom[] }): Place => {
  const prices = (item.hotel_rooms || []).map(room => Number(room.price_per_night)).filter(price => Number.isFinite(price) && price > 0);
  return { ref: { kind: 'hotel', id: String(item.hotel_id) }, title: item.name, area: [item.city, item.state].filter(Boolean).join(', '), images: publicPropertyImages(item.images), label: 'Hotel', rate: prices.length ? `From ${money(Math.min(...prices))} / night` : 'Choose a room to see rates', description: item.description, amenities: item.amenities || [], rooms: item.hotel_rooms?.map(room => ({ ...room, images: publicPropertyImages(room.images) })) };
};
type Props = { active: boolean; onSignIn: () => void; onOpenLegal: (page: 'privacy_policy' | 'terms_of_service') => void; notice?: string; children: ReactNode };

/** The signed-out landing page, not a tab or another dialog over authentication.
 * Uses only existing redacted discovery APIs. It never creates a guest account,
 * booking, payment or authorisation grant. Auth children replace its DOM while
 * the search and selected property are retained for the return journey. */
export default function GuestBrowseEntry({ active, onSignIn, onOpenLegal, notice, children }: Props) {
  const [places, setPlaces] = useState<Place[]>([]), [target, setTarget] = useState<SharedProperty | null>(null), [detail, setDetail] = useState<Place | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [query, setQuery] = useState(''), [kind, setKind] = useState('all');
  const viewport = useRef<HTMLElement>(null), queryField = useRef<HTMLInputElement>(null);
  const scroll = useRef({ list: 0, detail: 0 });
  const back = useRecordScreenBack(() => { setTarget(null); }, active && Boolean(target));
  useLayoutEffect(() => {
    if (active && viewport.current) viewport.current.scrollTop = target ? scroll.current.detail : scroll.current.list;
  }, [active, target]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoading(true); setError('');
    void (async () => {
      if (target) {
        setDetail(null);
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
        if (current) { setDetail(place); if (!place) setError('This property is not currently available.'); }
      } else {
        const results = await Promise.allSettled([
          withTimeout(getAllListings(), 15000, 'Homes took too long to load.'),
          withTimeout(getHotels(), 15000, 'Hotels took too long to load.'),
        ]);
        if (!current) return;
        const [homes, hotels] = results;
        const next: Place[] = [];
        if (homes.status === 'fulfilled' && !homes.value.error) next.push(...homes.value.listings.map(home));
        if (hotels.status === 'fulfilled' && !hotels.value.error) next.push(...hotels.value.hotels.map(hotel));
        setPlaces(next);
        if (results.some(result => result.status === 'rejected' || result.value.error)) setError('Some places could not be loaded. Please try again.');
      }
    })().catch(() => { if (current) setError('Places could not be loaded. Please try again.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, target, attempt]);
  useLayoutEffect(() => {
    // The list may have been revalidated while authentication was visible.
    if (active && !loading && viewport.current) viewport.current.scrollTop = target ? scroll.current.detail : scroll.current.list;
  }, [active, loading, target]);
  function signIn() {
    if (target) {
      try { savePropertyLinkIntent(target, sessionStorage); } catch { /* Sign-in still works without browser storage. */ }
      const hash = new URL(propertyShareUrl(target)).hash;
      history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    onSignIn();
  }
  if (!active) return <>{children}</>;
  const visible = places.filter(place => (kind === 'all' || place.label === kind) && `${place.title} ${place.area}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="wh-public-entry">
    <header className="wh-public-header"><div className="wh-public-container wh-public-masthead">
      <a href="#" onClick={event => { event.preventDefault(); if (target) back(); else viewport.current?.scrollTo({ top: 0, behavior: 'auto' }); }} className="wh-public-brand" aria-label="WeHouse home"><img src="/app-icon.svg?v=3" alt="" width="36" height="36" /><span>WeHouse</span></a>
      <button type="button" onClick={signIn} className="wh-public-signin">Sign in</button>
    </div></header>
    <main ref={viewport} className="wh-public-body" onScroll={event => { if (!loading) scroll.current[target ? 'detail' : 'list'] = event.currentTarget.scrollTop; }}>
      <div className="wh-public-container">
        {isTestEnvironment && <p className="wh-public-preview">Test preview · Live accounts don’t work here. <a href="https://www.wehouse.com.ng/">Open live WeHouse</a></p>}
        {notice && <p role="status" className="wh-public-notice">{notice}</p>}
        {!target ? <>
          <section className="wh-public-intro"><p>Find. Connect. Live better.</p><h1>Find your next place.</h1></section>
          <form role="search" className="wh-public-search" onSubmit={event => { event.preventDefault(); queryField.current?.blur(); document.getElementById('wh-public-results')?.scrollIntoView({ block: 'start' }); }}>
            <label className="wh-public-location"><span>Where do you want to live?</span><div><MapPin size={19} aria-hidden="true" /><input ref={queryField} value={query} onChange={event => setQuery(event.target.value)} placeholder="City, area or property" aria-label="Find a place" /></div></label>
            <label className="wh-public-type"><span>Property type</span><select value={kind} onChange={event => setKind(event.target.value)} aria-label="Property type"><option value="all">All places</option>{['Short Let', 'Long Let', 'Hotel'].map(type => <option key={type}>{type}</option>)}</select></label>
            <button type="submit" className="wh-public-search-button"><Search size={18} aria-hidden="true" />Search</button>
          </form>
        </> : <button type="button" onClick={back} className="wh-public-back"><ArrowLeft size={20} aria-hidden="true" />Back to places</button>}
        <section id="wh-public-results" className="wh-public-results" aria-label={target ? 'Property details' : 'Places to explore'}>
          {!target && <h2>Places to explore</h2>}
          {loading && <div role="status" className="wh-public-loading" aria-label="Loading places"><span className="sr-only">Loading places…</span><div /><div /><div /></div>}
          {!loading && error && <div role="alert" className="wh-public-error"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
          {!loading && target && detail ? <article className="wh-public-detail">
            <PropertyMediaCarousel images={detail.images} title={detail.title} />
            <p className="wh-public-kind">{detail.label}</p><h1>{detail.title}</h1><p className="wh-public-area">{detail.area}</p><p className="wh-public-rate">{detail.rate}</p>
            {detail.description && <p className="wh-public-description">{detail.description}</p>}
            {!!detail.amenities.length && <p className="wh-public-amenities">{detail.amenities.join(' · ')}</p>}
            {!!detail.rooms?.length && <section className="wh-public-rooms"><h2>Room types</h2>{detail.rooms.map(room => <div key={room.room_id}>{room.images?.[0] && <img src={room.images[0]} alt="" loading="lazy" />}<div><h3>{room.room_type}</h3><p>{[room.bed_type, room.max_guests ? `Up to ${room.max_guests} guests` : null].filter(Boolean).join(' · ')}</p><p>{money(Number(room.price_per_night)) || 'Rate unavailable'}{money(Number(room.price_per_night)) ? ' / night' : ''}</p></div></div>)}</section>}
            <div className="wh-public-continue"><p>Published rates. Review availability and the full price before payment.</p><button type="button" onClick={signIn}>Sign in to continue</button></div>
          </article> : !loading && !target ? <div className="wh-public-grid">{visible.map(place => <button key={`${place.ref.kind}:${place.ref.id}`} type="button" aria-label={`View ${place.title}`} onClick={() => { scroll.current.detail = 0; setTarget(place.ref); }} className="wh-public-place">
            <div className="wh-public-image">{place.images[0] ? <img src={place.images[0]} alt="" loading="lazy" /> : <span>Photo unavailable</span>}</div>
            <p className="wh-public-kind">{place.label}</p><h3>{place.title}</h3><p className="wh-public-area">{place.area}</p><p className="wh-public-rate">{place.rate}</p>
          </button>)}{!visible.length && !error && <p className="wh-public-empty">No published places match this search.</p>}</div> : null}
        </section>
        <footer className="wh-public-footer"><button type="button" onClick={() => onOpenLegal('terms_of_service')}>Terms of Service</button><button type="button" onClick={() => onOpenLegal('privacy_policy')}>Privacy Policy</button></footer>
      </div>
    </main>
  </div>;
}
