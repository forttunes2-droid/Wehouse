import { useEffect, useState } from 'react';
import { ChevronRight, House, X } from 'lucide-react';
import { getListing } from '@/lib/supabase/listings';
import { getHotelById } from '@/lib/supabase/hotels';
import { listingDisplayTitle } from '@/lib/listingPresentation';
import { locationLabel } from '@/lib/locationPresentation';
import { publicPropertyImages } from '@/lib/publicPropertyMedia';
import { withTimeout } from '@/lib/withTimeout';
import { propertyReference, type SharedProperty } from '@/lib/propertyShare';
import './message-attachments.css';

type Preview = { title: string; area: string; image: string | null; label: string };
type Props = { property: SharedProperty; onOpen?: (page: string, id: string) => void; compact?: boolean };
function PropertyPhoto({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return <span className="wh-property-photo">{url && !failed ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <House size={26} aria-hidden="true" />}</span>;
}
export default function SharedPropertyCard(props: Props) {
  return <LoadedPropertyCard key={`${props.property.kind}:${props.property.id}`} {...props} />;
}
function LoadedPropertyCard({ property, onOpen, compact = false }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setPreview(null); setState('loading');
    const ref = propertyReference(property.kind, property.id);
    if (!ref) { setState('unavailable'); return; }
    void (async () => {
      try {
        let next: Preview | null = null;
        if (ref.kind === 'listing') {
          const result = await withTimeout(getListing(ref.id), 12000, 'Property preview took too long.');
          if (result.error) throw result.error;
          const listing = result.listing;
          if (listing && String(listing.id) === ref.id) next = { title: listingDisplayTitle(listing), area: locationLabel(undefined, listing.city, listing.state), image: publicPropertyImages(listing.images)[0] || null, label: listing.sub_type === 'short_let' ? 'Short Let' : 'Long Let' };
        } else {
          const result = await withTimeout(getHotelById(Number(ref.id)), 12000, 'Property preview took too long.');
          if (result.error) throw result.error;
          const hotel = result.hotel;
          if (hotel && String(hotel.hotel_id) === ref.id) next = { title: hotel.name, area: [hotel.city, hotel.state].filter(Boolean).join(', '), image: publicPropertyImages(hotel.images)[0] || null, label: 'Hotel' };
        }
        if (active) { setPreview(next); setState(next ? 'ready' : 'unavailable'); }
      } catch { if (active) setState('error'); }
    })();
    return () => { active = false; };
  }, [property.kind, property.id, attempt]);
  if (!preview) return <div className="wh-attachment-surface wh-attachment-state" data-property-state={state}>
    <House size={22} aria-hidden="true" /><div><p role={state === 'error' ? 'alert' : 'status'}>{state === 'loading' ? 'Loading shared property…' : state === 'error' ? 'Property preview could not be loaded.' : 'This shared property is no longer available.'}</p>
    {state === 'error' && <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}</div>
  </div>;
  const contents = <>
    <PropertyPhoto key={preview.image} url={preview.image} />
    <span className="wh-property-copy"><span className="wh-property-kind">{preview.label}</span><span className="wh-property-title">{preview.title}</span><span className="wh-property-area">{preview.area}</span>{onOpen && !compact && <span className="wh-property-open">View property<ChevronRight size={17} aria-hidden="true" /></span>}</span>
  </>;
  const className = `wh-attachment-surface wh-property-attachment${compact ? ' wh-property-compact' : ''}`;
  return onOpen ? <button type="button" data-message-swipe-surface="true" className={className} aria-label={`View ${preview.title}`} onClick={event => { event.stopPropagation(); onOpen(property.kind === 'hotel' ? 'hotel_detail' : 'detail', property.id); }}>{contents}</button>
    : <div className={className} aria-label={`Property to send: ${preview.title}`}>{contents}</div>;
}

/** Drafts are compact and non-navigating; removing one never removes the typed caption. */
export function PropertyDraftAttachment({ property, onRemove }: { property: SharedProperty; onRemove: () => void }) {
  return <div className="wh-attachment-surface wh-property-draft" aria-label="Property ready to send"><SharedPropertyCard property={property} compact /><button type="button" className="wh-attachment-remove" aria-label="Remove property from message" onClick={onRemove}><X size={18} aria-hidden="true" /></button></div>;
}
