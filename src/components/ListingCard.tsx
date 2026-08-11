import type { Listing, ListingStatus } from '@/types';
import { LISTING_STATUS_LABELS, LISTING_STATUS_COLORS } from '@/types';

interface ListingCardProps {
  listing: Listing;
  onClick: () => void;
  isSaved?: boolean;
  onToggleSave?: (e: React.MouseEvent) => void;
  distanceKm?: number | null;
}

export default function ListingCard({ listing, onClick, isSaved, onToggleSave, distanceKm }: ListingCardProps) {
  const imageUrl = listing.images?.[0] || 'https://placehold.co/600x400/1A1A24/5C5E72?text=No+Image';
  const listingStatus: ListingStatus = listing.status || 'available';
  const statusColor = LISTING_STATUS_COLORS[listingStatus] || LISTING_STATUS_COLORS.available;
  const statusLabel = LISTING_STATUS_LABELS[listingStatus] || 'Available';
  const price = listing.price || 0;
  const priceDisplay = price >= 1000000 ? `₦${(price / 1000000).toFixed(1)}M` : price >= 1000 ? `₦${(price / 1000).toFixed(0)}k` : `₦${price}`;
  const priceDetail = price >= 1000 ? `₦${price.toLocaleString()}` : null;
  const statusBg = statusColor.includes('green') ? 'bg-green-500/15' : statusColor.includes('amber') ? 'bg-amber-500/15' : statusColor.includes('blue') ? 'bg-blue-500/15' : statusColor.includes('red') ? 'bg-red-500/15' : 'bg-gray-500/15';
  const statusText = statusColor.includes('green') ? 'text-green-400' : statusColor.includes('amber') ? 'text-amber-400' : statusColor.includes('blue') ? 'text-blue-400' : statusColor.includes('red') ? 'text-red-400' : 'text-gray-400';
  const statusBorder = statusColor.includes('green') ? 'border-green-500/20' : statusColor.includes('amber') ? 'border-amber-500/20' : statusColor.includes('blue') ? 'border-blue-500/20' : statusColor.includes('red') ? 'border-red-500/20' : 'border-gray-500/20';

  return (
    <div onClick={onClick} className="group relative cursor-pointer overflow-hidden rounded-2xl border border-[#1E1E2C] bg-[#12121A] card-hover">
      <div className="relative aspect-[16/11] overflow-hidden">
        <img src={imageUrl} alt={listing.title} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />
        <div className="absolute left-2.5 top-2.5 z-10"><span className={`rounded-full border px-2.5 py-1 text-[8px] font-bold uppercase backdrop-blur-md ${statusBg} ${statusText} ${statusBorder}`}>{statusLabel}</span></div>
        {onToggleSave && <button onClick={onToggleSave} className="absolute right-2.5 top-2.5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur-md transition-all hover:bg-black/70 active:scale-90"><svg width="15" height="15" viewBox="0 0 24 24" fill={isSaved ? '#EF4444' : 'none'} stroke={isSaved ? '#EF4444' : 'white'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg></button>}
        {listing.videos && listing.videos.length > 0 && <div className={`absolute top-2.5 z-10 ${onToggleSave ? 'right-12' : 'right-2.5'}`}><span className="flex items-center gap-1 rounded-full bg-purple-500/80 px-2 py-1 text-[8px] font-bold text-white backdrop-blur-sm"><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>{listing.videos.length}</span></div>}
        <div className="absolute bottom-2.5 left-2.5 z-10"><div className="flex items-baseline gap-1.5"><span className="text-base font-bold text-white drop-shadow-lg">{priceDisplay}</span>{priceDetail && <span className="text-[9px] text-white/50">{priceDetail}/yr</span>}</div></div>
        <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-3">{listing.bedrooms > 0 && <span className="flex items-center gap-1 text-[10px] font-medium text-white/80"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20h20M5 20v-5a3 3 0 0 1 6 0v5M13 20v-5a3 3 0 0 1 6 0v5M8 12V7a3 3 0 0 1 6 0v5" /></svg>{listing.bedrooms}</span>}{listing.bathrooms > 0 && <span className="flex items-center gap-1 text-[10px] font-medium text-white/80"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M6 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" /></svg>{listing.bathrooms}</span>}</div>
      </div>
      <div className="p-3">
        <h3 className="line-clamp-1 text-[13px] font-bold leading-tight text-white transition-colors group-hover:text-[#3B82F6]">{listing.title}</h3>
        <div className="mt-1.5 flex items-center gap-1"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg><p className="line-clamp-1 text-[10px] text-[#5C5E72]">{listing.city}{listing.state ? `, ${listing.state}` : ''}</p></div>
        {distanceKm != null && Number.isFinite(distanceKm) && <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-blue-500/15 bg-blue-500/[0.07] px-2 py-1 text-[8px] font-semibold text-blue-300"><span>Near you</span><span>·</span><span>{distanceKm < 1 ? `${Math.max(1, Math.round(distanceKm * 1000))} m` : `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`} away</span></div>}
        <div className="mt-2 flex items-center gap-2"><span className="rounded-full bg-[#1A1A24] px-2 py-0.5 text-[8px] font-medium text-[#5C5E72]">{listing.availability_status === 'available' ? 'For Rent' : listing.availability_status}</span>{listing.status === 'available' && <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[8px] font-medium text-green-400">Verified public listing</span>}</div>
      </div>
    </div>
  );
}
