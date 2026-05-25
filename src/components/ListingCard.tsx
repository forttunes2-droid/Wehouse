import type { Listing } from '@/types';

interface ListingCardProps {
  listing: Listing;
  onClick: () => void;
  isSaved?: boolean;
  onToggleSave?: (e: React.MouseEvent) => void;
}

export default function ListingCard({ listing, onClick, isSaved, onToggleSave }: ListingCardProps) {
  const imageUrl = listing.images?.[0] || 'https://placehold.co/600x400/e5e2dd/8B8680?text=No+Image';

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl overflow-hidden shadow-sm border border-[#f0eeea] cursor-pointer hover:shadow-md transition-shadow"
    >
      {/* Image */}
      <div className="relative aspect-[4/3]">
        <img
          src={imageUrl}
          alt={listing.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {/* Status badge */}
        <div className="absolute top-3 left-3">
          <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full uppercase ${
            listing.availability_status === 'available'
              ? 'bg-green-500 text-white'
              : listing.availability_status === 'reserved'
              ? 'bg-amber-500 text-white'
              : 'bg-gray-500 text-white'
          }`}>
            {listing.availability_status}
          </span>
        </div>
        {/* Save button */}
        {onToggleSave && (
          <button
            onClick={onToggleSave}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-sm"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill={isSaved ? '#C8A45A' : 'none'}
              stroke={isSaved ? '#C8A45A' : '#0F1724'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-[#0F1724] line-clamp-1">{listing.title}</h3>
          <span className="text-sm font-bold text-[#C8A45A] whitespace-nowrap">
            ₦{listing.price.toLocaleString()}
          </span>
        </div>
        <p className="text-xs text-[#8B8680] mt-1">
          {listing.city}{listing.state ? `, ${listing.state}` : ''}
        </p>
        <div className="flex items-center gap-3 mt-2.5 text-[10px] text-[#8B8680]">
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20h20M5 20v-5a3 3 0 0 1 6 0v5M13 20v-5a3 3 0 0 1 6 0v5M8 12V7a3 3 0 0 1 6 0v5" /></svg>
            {listing.bedrooms} bed
          </span>
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M6 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" /></svg>
            {listing.bathrooms} bath
          </span>
        </div>
      </div>
    </div>
  );
}
