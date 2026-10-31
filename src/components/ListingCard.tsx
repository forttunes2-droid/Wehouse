import {Heart,ImageOff} from 'lucide-react';
import ShowcaseMediaThumbnail from '@/components/ShowcaseMediaThumbnail';
import {homeStyleLabel} from '@/lib/homeStyles';
import {locationLabel} from '@/lib/locationPresentation';
import {listingDisplayTitle} from '@/lib/listingPresentation';
import {formatMoney} from '@/lib/regional';
import {LISTING_STATUS_LABELS,type Listing,type ListingStatus} from '@/types';

type Props={listing:Listing;onClick:()=>void;isSaved?:boolean;onToggleSave?:(event:React.MouseEvent)=>void;distanceKm?:number|null};

/** The same readable photo card at every result count; no count-triggered layout swap. */
export default function ListingCard({listing,onClick,isSaved,onToggleSave,distanceKm}:Props){
 const title=listingDisplayTitle(listing),photos=(listing.images||[]).filter(Boolean),primary=photos[0];
 const status=LISTING_STATUS_LABELS[(listing.status||'available') as ListingStatus]||'Available';
 const short=listing.sub_type==='short_let';
 const distance=distanceKm!=null&&Number.isFinite(distanceKm)?distanceKm<1?Math.max(1,Math.round(distanceKm*1000))+' m away':distanceKm.toFixed(distanceKm<10?1:0)+' km away':'';
 const specifications=[homeStyleLabel(listing.home_style),listing.bedrooms==null?'':listing.bedrooms===0?(listing.space_scope==='private_room'?'':'Studio / self-contained'):listing.bedrooms+' bed'+(listing.bedrooms===1?'':'s'),listing.bathrooms==null?'':listing.bathrooms+' bath'+(listing.bathrooms===1?'':'s')].filter(Boolean).join(' · ');
 return <article data-home-card className="relative min-w-0 pb-2">
  <button type="button" onClick={onClick} aria-label={'View '+title} className="absolute inset-0 z-10 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--wh-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wh-bg)]"/>
  <div data-home-media className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--wh-elevated)]">
   {primary?<ShowcaseMediaThumbnail src={primary} mediaType="image" alt={title} className="h-full w-full object-cover"/>:<div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--wh-text-muted)]"><ImageOff size={24} aria-hidden="true"/><span className="text-xs">Photos not available</span></div>}
   {onToggleSave&&<button type="button" aria-label={isSaved?'Remove home from Saved':'Save home'} aria-pressed={Boolean(isSaved)} onClick={event=>{event.preventDefault();event.stopPropagation();onToggleSave(event);}} className={'absolute right-2 top-2 z-20 grid h-11 w-11 place-items-center rounded-full border shadow-sm '+(primary?'border-white/20 bg-black/55 text-white':'border-[var(--wh-border)] bg-[var(--wh-surface)] text-[var(--wh-text)]')}><Heart size={19} fill={isSaved?'currentColor':'none'}/></button>}
   {photos.length>1&&<span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-medium text-white">{photos.length} photos</span>}
  </div>
  <div className="px-1 pt-3">
   <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold text-[var(--wh-accent-text)]">{short?'Short Let':'Long Let'}</span><span className="text-[var(--wh-text-secondary)]">{status}</span></div>
   <h3 className="mt-2 line-clamp-2 text-base font-semibold leading-snug text-[var(--wh-text)]">{title}</h3>
   <p className="mt-1 truncate text-sm text-[var(--wh-text-secondary)]">{locationLabel(listing.address,listing.city,listing.state)||'Location unavailable'}</p>
   {listing.space_scope&&<p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{listing.space_scope==='private_room'?'Private room':'Entire home'}{listing.space_label?' · '+listing.space_label:''}</p>}
   {specifications&&<p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">{specifications}</p>}
   <p className="mt-3 text-base font-semibold text-[var(--wh-text)]">{formatMoney(listing.price||0,{currency:listing.currency||'NGN'})}<span className="ml-1.5 text-xs font-normal text-[var(--wh-text-secondary)]">{short?'per night':'per year'}</span></p>
   {(distance||listing.videos?.length>0)&&<p className="mt-1 text-xs text-[var(--wh-text-secondary)]">{[distance,listing.videos?.length>0?'Walkthrough available':''].filter(Boolean).join(' · ')}</p>}
  </div>
 </article>;
}
