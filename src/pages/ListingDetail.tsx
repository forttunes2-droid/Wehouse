import { useState, useEffect } from 'react';
import { getListingById } from '@/lib/supabase';
import type { Listing } from '@/types';

interface ListingDetailProps {
  listingId: string;
  onNavigate: () => void;
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
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-[#5C5E72]">Listing not found</p>
        <button onClick={onNavigate} className="text-xs text-[#3B82F6]">Go back</button>
      </div>
    );
  }

  const images = listing.images?.length > 0 ? listing.images : ['https://placehold.co/600x400/1A1A24/5C5E72?text=No+Image'];

  const statusColors: Record<string, string> = {
    available: 'bg-green-500/20 text-green-400 border-green-500/30',
    reserved: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    occupied: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      {/* Image Gallery */}
      <div className="relative">
        <img src={images[currentImage]} alt={listing.title} className="w-full aspect-[4/3] object-cover" />

        {/* Back button */}
        <button onClick={onNavigate} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>

        {/* Save button */}
        <button onClick={onToggleSave} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center hover:bg-black/70 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? '#3B82F6' : 'none'} stroke={isSaved ? '#3B82F6' : 'white'} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
        </button>

        {/* Image dots */}
        {images.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button key={i} onClick={() => setCurrentImage(i)} className={`w-2 h-2 rounded-full transition-all ${i === currentImage ? 'bg-white w-4' : 'bg-white/40'}`} />
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-5 py-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h1 className="text-lg font-bold text-white">{listing.title}</h1>
          <span className="text-lg font-bold text-[#3B82F6] whitespace-nowrap">₦{listing.price.toLocaleString()}</span>
        </div>

        <p className="text-xs text-[#5C5E72] mb-3">
          {listing.address}{listing.city ? `, ${listing.city}` : ''}{listing.state ? `, ${listing.state}` : ''}
        </p>

        <span className={`inline-block text-[10px] font-bold px-3 py-1 rounded-full border uppercase ${statusColors[listing.availability_status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
          {listing.availability_status}
        </span>

        {/* Details */}
        <div className="flex gap-6 mt-5 py-4 border-y border-[#1E1E2C]">
          {[
            { label: 'Bedrooms', value: listing.bedrooms },
            { label: 'Bathrooms', value: listing.bathrooms },
            { label: 'Currency', value: listing.currency },
          ].map(d => (
            <div key={d.label} className="text-center flex-1">
              <div className="text-sm font-bold text-white">{d.value}</div>
              <div className="text-[10px] text-[#5C5E72]">{d.label}</div>
            </div>
          ))}
        </div>

        {/* Description */}
        {listing.description && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-white mb-2">Description</h3>
            <p className="text-xs text-[#8B8DA0] leading-relaxed">{listing.description}</p>
          </div>
        )}

        {/* Contact */}
        <div className="mt-6 glass rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Interested?</h3>
          <p className="text-xs text-[#5C5E72] mb-4">Contact the property owner for viewing</p>
          <button className="w-full h-11 rounded-xl bg-[#3B82F6] text-white text-sm font-semibold hover:bg-[#2563EB] transition-colors glow-blue-sm">
            Contact Owner
          </button>
        </div>
      </div>
    </div>
  );
}
