import { useState, useEffect, useMemo } from 'react';
import { getHotels } from '@/lib/supabase';
import { HOTEL_AMENITIES } from '@/types';
import type { Hotel } from '@/types';
import { Toaster, toast } from 'sonner';

// Lightweight hotel room preview from getHotels
interface HotelRoomPreview {
  room_id: number;
  price_per_night: number;
  room_type: string;
}

interface HotelsHomeProps {
  onNavigate: (page: string, id?: string) => void;
}

export default function HotelsHome({ onNavigate }: HotelsHomeProps) {
  const [hotels, setHotels] = useState<(Hotel & { hotel_rooms: HotelRoomPreview[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000000]);

  // Nigerian states for filter
  const nigerianStates = [
    'Abia','Abuja','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
    'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Gombe','Imo','Jigawa','Kaduna',
    'Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun',
    'Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara',
  ];

  useEffect(() => {
    loadHotels();
  }, []);

  async function loadHotels() {
    setLoading(true);
    const { hotels: data, error } = await getHotels({
      state: selectedState || undefined,
      city: selectedCity || undefined,
      search: searchQuery || undefined,
    });
    if (error) {
      toast.error('Failed to load hotels');
    } else {
      setHotels(data || []);
    }
    setLoading(false);
  }

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => loadHotels(), 400);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedState, selectedCity]);

  // Filter by amenities and price locally
  const filteredHotels = useMemo(() => {
    return hotels.filter(h => {
      // Amenity filter
      if (selectedAmenities.length > 0) {
        const hasAll = selectedAmenities.every(a => h.amenities?.includes(a));
        if (!hasAll) return false;
      }
      // Price filter — check if any room is within range
      const rooms = h.hotel_rooms || [];
      const hasRoomInRange = rooms.some(r => r.price_per_night >= priceRange[0] && r.price_per_night <= priceRange[1]);
      if (rooms.length > 0 && !hasRoomInRange) return false;
      return true;
    });
  }, [hotels, selectedAmenities, priceRange]);

  // Get min price for a hotel
  const getMinPrice = (hotel: Hotel & { hotel_rooms: HotelRoomPreview[] }) => {
    const prices = hotel.hotel_rooms?.map(r => r.price_per_night) || [];
    return prices.length > 0 ? Math.min(...prices) : 0;
  };

  const toggleAmenity = (amenity: string) => {
    setSelectedAmenities(prev =>
      prev.includes(amenity) ? prev.filter(a => a !== amenity) : [...prev, amenity]
    );
  };

  return (
    <div className="min-h-screen bg-transparent pb-24">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-white">Find Hotels</h1>
            <p className="text-xs text-[#5C5E72]">Book the best hotels in Nigeria</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className="absolute left-3.5 top-1/2 -translate-y-1/2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search hotel name or city..."
            className="w-full h-11 pl-10 pr-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C5E72] hover:text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="mt-2 flex items-center gap-1.5 text-xs text-[#3B82F6] font-medium"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {showFilters ? 'Hide Filters' : 'Filters'}
          {(selectedState || selectedAmenities.length > 0) && (
            <span className="w-4 h-4 rounded-full bg-[#3B82F6] text-white text-[8px] flex items-center justify-center">
              {(selectedState ? 1 : 0) + selectedAmenities.length}
            </span>
          )}
        </button>

        {/* Filters panel */}
        {showFilters && (
          <div className="mt-3 glass rounded-2xl p-4 space-y-4 border border-[#2A2A3A]">
            {/* State */}
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">State</label>
              <select
                value={selectedState}
                onChange={(e) => { setSelectedState(e.target.value); setSelectedCity(''); }}
                className="w-full h-9 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]"
              >
                <option value="">All States</option>
                {nigerianStates.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* City */}
            {selectedState && (
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">City / LGA</label>
                <input
                  type="text"
                  value={selectedCity}
                  onChange={(e) => setSelectedCity(e.target.value)}
                  placeholder="Enter city"
                  className="w-full h-9 rounded-lg bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]"
                />
              </div>
            )}

            {/* Max Price */}
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Max Price/Night: ₦{priceRange[1].toLocaleString()}</label>
              <input
                type="range"
                min={5000}
                max={1000000}
                step={5000}
                value={priceRange[1]}
                onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
                className="w-full accent-[#3B82F6]"
              />
            </div>

            {/* Amenities */}
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-2 block font-medium">Amenities</label>
              <div className="flex flex-wrap gap-1.5">
                {HOTEL_AMENITIES.map(amenity => (
                  <button
                    key={amenity}
                    onClick={() => toggleAmenity(amenity)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-all ${
                      selectedAmenities.includes(amenity)
                        ? 'bg-[#3B82F6]/10 border-[#3B82F6]/40 text-[#3B82F6]'
                        : 'bg-[#1A1A24] border-[#2A2A3A] text-[#5C5E72] hover:border-[#3B82F6]/30'
                    }`}
                  >
                    {amenity}
                  </button>
                ))}
              </div>
            </div>

            {/* Clear filters */}
            <button
              onClick={() => { setSelectedState(''); setSelectedCity(''); setSelectedAmenities([]); setPriceRange([0, 1000000]); }}
              className="text-[10px] text-[#3B82F6] font-medium"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Results count */}
      <div className="px-5 mb-3">
        <p className="text-[10px] text-[#5C5E72]">
          {filteredHotels.length} hotel{filteredHotels.length !== 1 ? 's' : ''} found
        </p>
      </div>

      {/* Hotel Cards */}
      {loading ? (
        <div className="px-5 space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 rounded-2xl shimmer" />
          ))}
        </div>
      ) : filteredHotels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-5">
          <div className="w-16 h-16 rounded-2xl bg-[#1A1A24] flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <p className="text-sm text-[#5C5E72] text-center">No hotels found</p>
          <p className="text-xs text-[#5C5E72] text-center mt-1">Try different filters or search terms</p>
        </div>
      ) : (
        <div className="px-5 space-y-4">
          {filteredHotels.map(hotel => {
            const minPrice = getMinPrice(hotel);
            const imageUrl = hotel.images?.[0] || 'https://placehold.co/600x400/1A1A24/5C5E72?text=No+Image';
            return (
              <button
                key={hotel.hotel_id}
                onClick={() => onNavigate('hotel_detail', String(hotel.hotel_id))}
                className="w-full text-left bg-[#12121A] rounded-2xl overflow-hidden border border-[#1E1E2C] hover:border-[#3B82F6]/30 transition-all group"
              >
                {/* Image */}
                <div className="relative aspect-[16/9] overflow-hidden">
                  <img
                    src={imageUrl}
                    alt={hotel.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

                  {/* Featured badge */}
                  {hotel.featured && (
                    <div className="absolute top-3 left-3">
                      <span className="text-[8px] font-bold px-2.5 py-1 rounded-full bg-amber-500/90 text-white backdrop-blur-sm">
                        FEATURED
                      </span>
                    </div>
                  )}

                  {/* Rating */}
                  {hotel.rating > 0 && (
                    <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-full px-2 py-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#F59E0B" stroke="none">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      <span className="text-[10px] font-bold text-white">{hotel.rating}</span>
                      <span className="text-[8px] text-white/50">({hotel.review_count})</span>
                    </div>
                  )}

                  {/* Price badge */}
                  <div className="absolute bottom-3 left-3">
                    {minPrice > 0 && (
                      <span className="text-sm font-bold text-white drop-shadow-lg">
                        from ₦{minPrice >= 1000 ? `${(minPrice / 1000).toFixed(0)}k` : minPrice}/night
                      </span>
                    )}
                  </div>
                </div>

                {/* Info */}
                <div className="p-3.5">
                  <h3 className="text-sm font-bold text-white group-hover:text-[#3B82F6] transition-colors">
                    {hotel.name}
                  </h3>
                  <div className="flex items-center gap-1 mt-1">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                    </svg>
                    <p className="text-[10px] text-[#5C5E72]">{hotel.city}, {hotel.state}</p>
                  </div>

                  {/* Amenities preview */}
                  {hotel.amenities && hotel.amenities.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {hotel.amenities.slice(0, 4).map(a => (
                        <span key={a} className="text-[8px] font-medium text-[#5C5E72] bg-[#1A1A24] px-2 py-0.5 rounded-full">
                          {a}
                        </span>
                      ))}
                      {hotel.amenities.length > 4 && (
                        <span className="text-[8px] text-[#5C5E72]">+{hotel.amenities.length - 4}</span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
