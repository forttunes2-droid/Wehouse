import { useEffect, useState } from 'react';
import { getListing } from '@/lib/supabase/listings';
import { getHotelById } from '@/lib/supabase/hotels';
import { listingDisplayTitle } from '@/lib/listingPresentation';
import { locationLabel } from '@/lib/locationPresentation';
import { withTimeout } from '@/lib/withTimeout';
import type { SharedProperty } from '@/lib/propertyShare';

type Preview = { title: string; area: string; image: string | null; label: string };
export default function SharedPropertyCard({ property, onOpen }: { property: SharedProperty; onOpen: (page: string, id: string) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null), [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading'), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setPreview(null); setState('loading');
    void (async () => {
      try {
        let next: Preview | null = null;
        if (property.kind === 'listing') {
          const result = await withTimeout(getListing(property.id), 12000, 'Property preview took too long.');
          if (result.error) throw result.error;
          const listing = result.listing;
          if (listing && String(listing.id) === property.id) next = { title: listingDisplayTitle(listing), area: locationLabel(undefined, listing.city, listing.state), image: listing.images?.[0] || null, label: listing.sub_type === 'short_let' ? 'Short Let' : 'Long Let' };
        } else {
          const result = await withTimeout(getHotelById(Number(property.id)), 12000, 'Property preview took too long.');
          if (result.error) throw result.error;
          const hotel = result.hotel;
          if (hotel && String(hotel.hotel_id) === property.id) next = { title: hotel.name, area: [hotel.city, hotel.state].filter(Boolean).join(', '), image: hotel.images?.[0] || null, label: 'Hotel' };
        }
        if (active) { setPreview(next); setState(next ? 'ready' : 'unavailable'); }
      } catch { if (active) setState('error'); }
    })();
    return () => { active = false; };
  }, [property.kind, property.id, attempt]);
  if (!preview) return <div className="my-1 min-w-[190px] max-w-full rounded-xl border border-white/15 bg-black/15 p-3 text-sm leading-6">
    <p role={state === 'error' ? 'alert' : 'status'}>{state === 'loading' ? 'Loading shared property…' : state === 'error' ? 'Property preview could not be loaded.' : 'This shared property is no longer available.'}</p>
    {state === 'error' && <button type="button" className="min-h-11 font-semibold underline" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
  </div>;
  return <button type="button" aria-label={`View ${preview.title}`} onClick={() => onOpen(property.kind === 'hotel' ? 'hotel_detail' : 'detail', property.id)} className="my-1 block w-64 max-w-full overflow-hidden rounded-xl border border-white/15 bg-black/15 text-left">
    {preview.image && <img src={preview.image} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />}
    <span className="block p-3"><span className="block text-xs font-medium opacity-80">{preview.label} · WeHouse</span><span className="mt-1 block break-words text-base font-semibold">{preview.title}</span><span className="mt-1 block text-sm opacity-80">{preview.area}</span><span className="mt-3 block text-sm font-semibold">View property →</span></span>
  </button>;
}
