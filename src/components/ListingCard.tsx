import type { Listing, ListingStatus } from '@/types';
import { LISTING_STATUS_LABELS, LISTING_STATUS_COLORS } from '@/types';

interface ListingCardProps {
  listing: Listing;
  onClick: () => void;
  isSaved?: boolean;
  onToggleSave?: (e: React.MouseEvent) => void;
}

export default function ListingCard({ listing, onClick, isSaved, onToggleSave }: ListingCardProps) {
  const imageUrl = listing.images?.[0] || 'https://placehold.co/600x400/1A1A24/5C5E72?text=No+Image';

  const listingStatus: ListingStatus = listing.status || 'available';
  const statusColor = LISTING_STATUS_COLORS[listingStatus] || LISTING_STATUS_COLORS.available;
  const statusLabel = LISTING_STATUS_LABELS[listingStatus] || 'Available';

  // Format price
  const price = listing.price || 0;
  const priceDisplay = price >= 1000000
    ? `₦${(price / 1000000).toFixed(1)}M`
    : price >= 1000
    ? `₦${(price / 1000).toFixed(0)}k`
    : `₦${price}`;
  const priceDetail = price >= 1000
    ? `₦${price.toLocaleString()}`
    : null;

  // Parse status color classes
  const statusBg = statusColor.includes('green') ? 'bg-green-500/15' :
    statusColor.includes('amber') ? 'bg-amber-500/15' :
    statusColor.includes('blue') ? 'bg-blue-500/15' :
    statusColor.includes('red') ? 'bg-red-500/15' :
    'bg-gray-500/15';
  const statusText = statusColor.includes('green') ? 'text-green-400' :
    statusColor.includes('amber') ? 'text-amber-400' :
    statusColor.includes('blue') ? 'text-blue-400' :
    statusColor.includes('red') ? 'text-red-400' :
    'text-gray-400';
  const statusBorder = statusColor.includes('green') ? 'border-green-500/20' :
    statusColor.includes('amber') ? 'border-amber-500/20' :
    statusColor.includes('blue') ? 'border-blue-500/20' :
    statusColor.includes('red') ? 'border-red-500/20' :
    'border-gray-500/20';

  return (
    <div onClick={onClick} className="bg-[#12121A] rounded-2xl overflow-hidden border border-[#1E1E2C] cursor-pointer card-hover group relative">
      {/* ═══ IMAGE SECTION — Bigger, more prominent ═══ */}
      <div className="relative aspect-[16/11] overflow-hidden">
        <img
          src={imageUrl}
          alt={listing.title}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          loading="lazy"
        />
        {/* Bottom gradient for price readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />

        {/* Status badge — top left */}
        <div className="absolute top-2.5 left-2.5 z-10">
          <span className={`text-[8px] font-bold px-2.5 py-1 rounded-full uppercase backdrop-blur-md border ${statusBg} ${statusText} ${statusBorder}`}>
            {statusLabel}
          </span>
        </div>

        {/* Save button — top right */}
        {onToggleSave && (
          <button
            onClick={onToggleSave}
            className="absolute top-2.5 right-2.5 w-9 h-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center hover:bg-black/70 active:scale-90 transition-all z-10"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill={isSaved ? '#EF4444' : 'none'} stroke={isSaved ? '#EF4444' : 'white'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        )}

        {/* Video indicator */}
        {listing.videos && listing.videos.length > 0 && (
          <div className={`absolute top-2.5 z-10 ${onToggleSave ? 'right-12' : 'right-2.5'}`}>
            <span className="flex items-center gap-1 text-[8px] font-bold px-2 py-1 rounded-full bg-purple-500/80 text-white backdrop-blur-sm">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              {listing.videos.length}
            </span>
          </div>
        )}

        {/* Price badge — bottom left on image */}
        <div className="absolute bottom-2.5 left-2.5 z-10">
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold text-white drop-shadow-lg">{priceDisplay}</span>
            {priceDetail && (
              <span className="text-[9px] text-white/50">{priceDetail}/yr</span>
            )}
          </div>
        </div>

        {/* Beds/baths — bottom right on image */}
        <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-3">
          {listing.bedrooms > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-white/80 font-medium">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20h20M5 20v-5a3 3 0 0 1 6 0v5M13 20v-5a3 3 0 0 1 6 0v5M8 12V7a3 3 0 0 1 6 0v5" /></svg>
              {listing.bedrooms}
            </span>
          )}
          {listing.bathrooms > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-white/80 font-medium">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M6 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" /></svg>
              {listing.bathrooms}
            </span>
          )}
        </div>
      </div>

      {/* ═══ INFO SECTION ═══ */}
      <div className="p-3">
        {/* Title */}
        <h3 className="text-[13px] font-bold text-white line-clamp-1 leading-tight group-hover:text-[#3B82F6] transition-colors">
          {listing.title}
        </h3>

        {/* Location */}
        <div className="flex items-center gap-1 mt-1.5">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
          <p className="text-[10px] text-[#5C5E72] line-clamp-1">
            {listing.city}{listing.state ? `, ${listing.state}` : ''}
          </p>
        </div>

        {/* Property meta */}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[8px] font-medium text-[#5C5E72] bg-[#1A1A24] px-2 py-0.5 rounded-full">
            {listing.availability_status === 'available' ? 'For Rent' : listing.availability_status}
          </span>
          {listing.status === 'available' && (
            <span className="text-[8px] font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
              Ready
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
