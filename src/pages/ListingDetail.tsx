import { useState, useEffect } from 'react';
import { getListingById } from '@/lib/supabase';
import type { Listing } from '@/types';

interface ListingDetailProps {
  listingId: string;
  onNavigate: (page: string) => void;
  isSaved: boolean;
  onToggleSave: () => void;
}

export default function ListingDetail({ listingId, onNavigate, isSaved, onToggleSave }: ListingDetailProps) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentImage, setCurrentImage] = useState(0);

  useEffect(() => {
    async function load() {
      const { listing: data } = await getListingById(listingId);
      setListing(data);
      setLoading(false);
    }
    load();
  }, [listingId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#C8A45A] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-[#8B8680]">Listing not found</p>
        <button onClick={() => onNavigate('home')} className="text-xs text-[#C8A45A]">Go back</button>
      </div>
    );
  }

  const images = listing.images?.length > 0 ? listing.images : ['https://placehold.co/600x400/e5e2dd/8B8680?text=No+Image'];

  return (
    <div className="min-h-screen bg-[#FAF8F5] pb-20">
      {/* Image Gallery */}
      <div className="relative">
        <img
          src={images[currentImage]}
          alt={listing.title}
          className="w-full aspect-[4/3] object-cover"
        />

        {/* Back button */}
        <button
          onClick={() => onNavigate('home')}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/90 flex items-center justify-center shadow-sm"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F1724" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Save button */}
        <button
          onClick={onToggleSave}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 flex items-center justify-center shadow-sm"
        >
          <svg
            width="18" height="18"
            viewBox="0 0 24 24"
            fill={isSaved ? '#C8A45A' : 'none'}
            stroke={isSaved ? '#C8A45A' : '#0F1724'}
            strokeWidth="2"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {/* Image dots */}
        {images.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentImage(i)}
                className={`w-2 h-2 rounded-full ${i === currentImage ? 'bg-white' : 'bg-white/50'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-bold text-[#0F1724]">{listing.title}</h1>
          <span className="text-lg font-bold text-[#C8A45A] whitespace-nowrap">₦{listing.price.toLocaleString()}</span>
        </div>

        <p className="text-xs text-[#8B8680] mt-1">
          {listing.address}{listing.city ? `, ${listing.city}` : ''}{listing.state ? `, ${listing.state}` : ''}
        </p>

        {/* Status */}
        <span className={`inline-block mt-3 text-[10px] font-semibold px-3 py-1 rounded-full uppercase ${
          listing.availability_status === 'available'
            ? 'bg-green-100 text-green-700'
            : listing.availability_status === 'reserved'
            ? 'bg-amber-100 text-amber-700'
            : 'bg-gray-100 text-gray-600'
        }`}>
          {listing.availability_status}
        </span>

        {/* Details */}
        <div className="flex gap-6 mt-4 py-4 border-y border-[#f0eeea]">
          <div className="text-center">
            <div className="text-sm font-semibold text-[#0F1724]">{listing.bedrooms}</div>
            <div className="text-[10px] text-[#8B8680]">Bedrooms</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-[#0F1724]">{listing.bathrooms}</div>
            <div className="text-[10px] text-[#8B8680]">Bathrooms</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-[#0F1724]">{listing.currency}</div>
            <div className="text-[10px] text-[#8B8680]">Currency</div>
          </div>
        </div>

        {/* Description */}
        {listing.description && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-[#0F1724] mb-2">Description</h3>
            <p className="text-xs text-[#8B8680] leading-relaxed">{listing.description}</p>
          </div>
        )}

        {/* Contact Placeholder */}
        <div className="mt-6 p-4 rounded-2xl bg-[#0F1724] text-white">
          <h3 className="text-sm font-semibold mb-1">Interested?</h3>
          <p className="text-xs text-white/60 mb-3">Contact the property owner for viewing</p>
          <button className="w-full h-10 rounded-xl bg-[#C8A45A] text-[#0F1724] text-sm font-semibold hover:bg-[#b8944a] transition-colors">
            Contact Owner
          </button>
        </div>
      </div>
    </div>
  );
}
