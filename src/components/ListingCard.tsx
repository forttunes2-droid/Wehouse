import type { Listing } from '@/types';

interface ListingCardProps {
  listing: Listing;
  onClick: () => void;
  isSaved?: boolean;
  onToggleSave?: (e: React.MouseEvent) => void;
}

export default function ListingCard({ listing, onClick, isSaved, onToggleSave }: ListingCardProps) {
  const imageUrl = listing.images?.[0] || 'https://placehold.co/600x400/1A1A24/5C5E72?text=No+Image';

  const statusColors: Record<string, string> = {
    available: 'bg-green-500/90 text-white',
    reserved: 'bg-amber-500/90 text-white',
    occupied: 'bg-gray-600/90 text-white',
    hidden: 'bg-red-500/90 text-white',
  };

  return (
    <div onClick={onClick} className="bg-[#12121A] rounded-2xl overflow-hidden border border-[#1E1E2C] cursor-pointer card-hover group">
      {/* Image */}
      <div className="relative aspect-[4/3]">
        <img src={imageUrl} alt={listing.title} className="w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        {/* Status badge */}
        <div className="absolute top-3 left-3">
          <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full uppercase backdrop-blur-sm ${statusColors[listing.availability_status] || 'bg-gray-600/90 text-white'}`}>
            {listing.availability_status}
          </span>
        </div>

        {/* Save button */}
        {onToggleSave && (
          <button onClick={onToggleSave} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center hover:bg-black/60 transition-colors">
            <svg width="15" height="15" viewBox="0 0 24 24" fill={isSaved ? '#3B82F6' : 'none'} stroke={isSaved ? '#3B82F6' : 'white'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-xs font-semibold text-white line-clamp-1 leading-tight">{listing.title}</h3>
          <span className="text-xs font-bold text-[#3B82F6] whitespace-nowrap">₦{(listing.price / 1000).toFixed(0)}k</span>
        </div>
        <p className="text-[10px] text-[#5C5E72] mt-1">
          {listing.city}{listing.state ? `, ${listing.state}` : ''}
        </p>
        <div className="flex items-center gap-3 mt-2 text-[9px] text-[#5C5E72]">
          <span className="flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20h20M5 20v-5a3 3 0 0 1 6 0v5M13 20v-5a3 3 0 0 1 6 0v5M8 12V7a3 3 0 0 1 6 0v5" /></svg>
            {listing.bedrooms}bd
          </span>
          <span className="flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M6 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" /></svg>
            {listing.bathrooms}ba
          </span>
        </div>
      </div>
    </div>
  );
}
