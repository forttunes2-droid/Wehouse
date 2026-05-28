import { useState, useEffect } from 'react';
import { getHotelById, getHotelReviews, addHotelReview } from '@/lib/supabase';
import type { Hotel, HotelRoom, HotelReview } from '@/types';
import { Toaster, toast } from 'sonner';

interface HotelDetailProps {
  hotelId: number;
  onBack: () => void;
  onBook: (hotelId: number, roomId: number) => void;
  profile: { user_id: string; username: string | null };
}

export default function HotelDetail({ hotelId, onBack, onBook, profile }: HotelDetailProps) {
  const [hotel, setHotel] = useState<(Hotel & { hotel_rooms: HotelRoom[] }) | null>(null);
  const [reviews, setReviews] = useState<(HotelReview & { profiles: { username: string | null; avatar_url: string | null } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentImage, setCurrentImage] = useState(0);
  const [showAllAmenities, setShowAllAmenities] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<HotelRoom | null>(null);

  useEffect(() => {
    loadHotel();
  }, [hotelId]);

  async function loadHotel() {
    setLoading(true);
    const { hotel: h, error } = await getHotelById(hotelId);
    if (error || !h) {
      toast.error('Failed to load hotel');
      setLoading(false);
      return;
    }
    setHotel(h);
    // Load reviews
    const { reviews: r } = await getHotelReviews(hotelId);
    setReviews(r || []);
    if (h.hotel_rooms?.[0]) setSelectedRoom(h.hotel_rooms[0]);
    setLoading(false);
  }

  async function handleSubmitReview() {
    if (!profile?.user_id) return;
    setSubmittingReview(true);
    const { error } = await addHotelReview(hotelId, profile.user_id, reviewRating, reviewComment || undefined);
    setSubmittingReview(false);
    if (error) {
      toast.error('Failed to submit review');
      return;
    }
    toast.success('Review submitted!');
    setShowReviewForm(false);
    setReviewComment('');
    setReviewRating(5);
    // Refresh reviews
    const { reviews: r } = await getHotelReviews(hotelId);
    setReviews(r || []);
    // Refresh hotel to get updated rating
    const { hotel: h } = await getHotelById(hotelId);
    if (h) setHotel(h);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="min-h-screen bg-transparent flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-[#5C5E72]">Hotel not found</p>
        <button onClick={onBack} className="text-xs text-[#3B82F6]">Go back</button>
      </div>
    );
  }

  const images = hotel.images?.length > 0 ? hotel.images : ['https://placehold.co/600x400/1A1A24/5C5E72?text=No+Image'];
  const allAmenities = hotel.amenities || [];
  const displayedAmenities = showAllAmenities ? allAmenities : allAmenities.slice(0, 8);

  return (
    <div className="min-h-screen bg-transparent pb-6">
      <Toaster position="top-center" richColors />

      {/* Image Gallery */}
      <div className="relative">
        <img src={images[currentImage]} alt={hotel.name} className="w-full aspect-[16/10] object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />

        {/* Back button */}
        <button onClick={onBack} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>

        {/* Image dots */}
        {images.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button key={i} onClick={() => setCurrentImage(i)} className={`w-2 h-2 rounded-full transition-all ${i === currentImage ? 'bg-white w-4' : 'bg-white/40'}`} />
            ))}
          </div>
        )}
      </div>

      {/* Hotel Info */}
      <div className="px-5 py-5">
        {/* Name & Rating */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h1 className="text-lg font-bold text-white">{hotel.name}</h1>
            <div className="flex items-center gap-1 mt-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
              <p className="text-xs text-[#5C5E72]">{hotel.city}, {hotel.state}{hotel.area ? ` · ${hotel.area}` : ''}</p>
            </div>
          </div>
          {hotel.rating > 0 && (
            <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 rounded-full px-2.5 py-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#F59E0B" stroke="none">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span className="text-xs font-bold text-amber-400">{hotel.rating}</span>
            </div>
          )}
        </div>

        {/* Description */}
        {hotel.description && (
          <p className="text-xs text-[#8B8DA0] leading-relaxed mb-4">{hotel.description}</p>
        )}

        {/* Amenities */}
        <div className="mb-5">
          <h3 className="text-xs font-semibold text-white mb-2">Amenities</h3>
          <div className="flex flex-wrap gap-1.5">
            {displayedAmenities.map(a => (
              <span key={a} className="text-[10px] font-medium text-[#8B8DA0] bg-[#1A1A24] border border-[#2A2A3A] px-2.5 py-1 rounded-full">
                {a}
              </span>
            ))}
          </div>
          {allAmenities.length > 8 && (
            <button onClick={() => setShowAllAmenities(!showAllAmenities)} className="text-[10px] text-[#3B82F6] mt-2 font-medium">
              {showAllAmenities ? 'Show less' : `+${allAmenities.length - 8} more`}
            </button>
          )}
        </div>

        {/* Address */}
        {hotel.address && (
          <div className="flex items-start gap-2 mb-5 p-3 rounded-xl bg-[#1A1A24] border border-[#2A2A3A]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className="mt-0.5 flex-shrink-0">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            <p className="text-xs text-[#8B8DA0]">{hotel.address}</p>
          </div>
        )}

        {/* ─── ROOMS ─────────────────────────────────── */}
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-white mb-3">Choose a Room</h3>
          {hotel.hotel_rooms?.length === 0 ? (
            <p className="text-xs text-[#5C5E72]">No rooms available</p>
          ) : (
            <div className="space-y-3">
              {hotel.hotel_rooms?.map(room => (
                <button
                  key={room.room_id}
                  onClick={() => setSelectedRoom(room)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${
                    selectedRoom?.room_id === room.room_id
                      ? 'border-[#3B82F6] bg-[#3B82F6]/5'
                      : 'border-[#2A2A3A] bg-[#12121A] hover:border-[#3B82F6]/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-bold text-white">{room.room_type}</h4>
                        {selectedRoom?.room_id === room.room_id && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#3B82F6]/20 text-[#3B82F6]">SELECTED</span>
                        )}
                      </div>
                      {room.description && (
                        <p className="text-[10px] text-[#5C5E72] mb-2">{room.description}</p>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-[10px] text-[#8B8DA0]">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                          {room.max_guests} guest{room.max_guests !== 1 ? 's' : ''}
                        </span>
                        {room.bed_type && (
                          <span className="flex items-center gap-1 text-[10px] text-[#8B8DA0]">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20h20M5 20v-5a3 3 0 0 1 6 0v5M13 20v-5a3 3 0 0 1 6 0v5M8 12V7a3 3 0 0 1 6 0v5" /></svg>
                            {room.bed_type}
                          </span>
                        )}
                      </div>
                      {/* Room amenities */}
                      {room.amenities && room.amenities.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {room.amenities.slice(0, 4).map(a => (
                            <span key={a} className="text-[8px] text-[#5C5E72] bg-[#1A1A24] px-1.5 py-0.5 rounded-full">{a}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-bold text-[#3B82F6]">₦{room.price_per_night.toLocaleString()}</p>
                      <p className="text-[9px] text-[#5C5E72]">per night</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Book Now Button */}
        {selectedRoom && (
          <button
            onClick={() => onBook(hotel.hotel_id, selectedRoom.room_id)}
            className="w-full h-13 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity py-3.5 flex items-center justify-center gap-2 mb-6"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            Book {selectedRoom.room_type} — ₦{selectedRoom.price_per_night.toLocaleString()}/night
          </button>
        )}

        {/* ─── REVIEWS ───────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Reviews ({reviews.length})</h3>
            <button
              onClick={() => setShowReviewForm(!showReviewForm)}
              className="text-[10px] text-[#3B82F6] font-medium"
            >
              {showReviewForm ? 'Cancel' : 'Write a Review'}
            </button>
          </div>

          {/* Review Form */}
          {showReviewForm && (
            <div className="glass rounded-2xl p-4 border border-[#2A2A3A] mb-4">
              <div className="flex items-center gap-1 mb-3">
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star} onClick={() => setReviewRating(star)} className="p-0.5">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill={star <= reviewRating ? '#F59E0B' : 'none'} stroke={star <= reviewRating ? '#F59E0B' : '#5C5E72'} strokeWidth="1.5">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                ))}
                <span className="text-xs text-[#5C5E72] ml-2">{reviewRating}/5</span>
              </div>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="Share your experience..."
                rows={3}
                className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 py-2 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none resize-none mb-3"
              />
              <button
                onClick={handleSubmitReview}
                disabled={submittingReview}
                className="w-full h-9 rounded-xl bg-[#3B82F6] text-white text-xs font-semibold hover:bg-[#2563EB] transition-colors disabled:opacity-40"
              >
                {submittingReview ? 'Submitting...' : 'Submit Review'}
              </button>
            </div>
          )}

          {/* Review List */}
          {reviews.length === 0 ? (
            <p className="text-xs text-[#5C5E72] text-center py-4">No reviews yet. Be the first to review!</p>
          ) : (
            <div className="space-y-3">
              {reviews.map(r => (
                <div key={r.review_id} className="p-3 rounded-xl bg-[#12121A] border border-[#1E1E2C]">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-[10px] font-bold">
                      {(r.profiles?.username || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white">@{r.profiles?.username || 'User'}</p>
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <svg key={i} width="8" height="8" viewBox="0 0 24 24" fill={i < r.rating ? '#F59E0B' : 'none'} stroke={i < r.rating ? '#F59E0B' : '#5C5E72'} strokeWidth="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        ))}
                      </div>
                    </div>
                  </div>
                  {r.comment && <p className="text-xs text-[#8B8DA0] leading-relaxed">{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
