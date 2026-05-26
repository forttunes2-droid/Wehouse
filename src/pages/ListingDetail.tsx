import { useState, useEffect } from 'react';
import { getListingById, createEnquiry, createReservation } from '@/lib/supabase';
import { LISTING_STATUS_LABELS, LISTING_STATUS_COLORS } from '@/types';
import type { Listing, Profile, ListingStatus } from '@/types';
import { Toaster, toast } from 'sonner';

interface ListingDetailProps {
  listingId: string;
  onNavigate: () => void;
  isSaved: boolean;
  onToggleSave: () => void;
  profile: Profile;
}

export default function ListingDetail({ listingId, onNavigate, isSaved, onToggleSave, profile }: ListingDetailProps) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentImage, setCurrentImage] = useState(0);
  const [showReservePopup, setShowReservePopup] = useState(false);
  const [showFeatureIncoming, setShowFeatureIncoming] = useState(false);
  const [enquiryMessage, setEnquiryMessage] = useState('');
  const [sendingEnquiry, setSendingEnquiry] = useState(false);
  const [reserving, setReserving] = useState(false);

  useEffect(() => {
    async function load() {
      const { listing: data } = await getListingById(listingId);
      setListing(data);
      setLoading(false);
    }
    load();
  }, [listingId]);

  async function handleEnquiry(e: React.FormEvent) {
    e.preventDefault();
    if (!enquiryMessage.trim()) return;
    setSendingEnquiry(true);
    const { error } = await createEnquiry(listingId, profile.user_id, enquiryMessage.trim());
    setSendingEnquiry(false);
    if (error) { toast.error('Failed to send enquiry'); return; }
    toast.success('Enquiry sent! Staff will reply soon.');
    setEnquiryMessage('');
  }

  async function handleReserve() {
    setReserving(true);
    const { error, alreadyExists } = await createReservation(listingId, profile.user_id);
    setReserving(false);
    if (error) { toast.error('Reservation failed: ' + error.message); return; }
    if (alreadyExists) {
      toast.info('You already have a pending reservation for this property');
    } else {
      toast.success('Reservation initiated!');
    }
    setShowReservePopup(true);
  }

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
  const listingStatus: ListingStatus = listing.status || 'available';
  const statusColor = (LISTING_STATUS_COLORS as Record<string, string>)[listingStatus] || LISTING_STATUS_COLORS.available;
  const statusLabel = (LISTING_STATUS_LABELS as Record<string, string>)[listingStatus] || 'Available';
  const isAvailable = listingStatus === 'available';

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-6">
      <Toaster position="top-center" richColors />

      {/* Image Gallery */}
      <div className="relative">
        <img src={images[currentImage]} alt={listing.title} className="w-full aspect-[4/3] object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />

        {/* Back button */}
        <button onClick={onNavigate} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>

        {/* Save button */}
        <button onClick={onToggleSave} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center hover:bg-black/70 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? '#3B82F6' : 'none'} stroke={isSaved ? '#3B82F6' : 'white'} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
        </button>

        {/* Status badge */}
        <div className="absolute bottom-4 left-4">
          <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full border uppercase backdrop-blur-sm ${statusColor}`}>
            {statusLabel}
          </span>
        </div>

        {/* Image dots */}
        {images.length > 1 && (
          <div className="absolute bottom-4 right-4 flex gap-1.5">
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

        <p className="text-xs text-[#5C5E72] mb-4">
          {listing.address}{listing.city ? `, ${listing.city}` : ''}{listing.state ? `, ${listing.state}` : ''}
        </p>

        {/* Details */}
        <div className="flex gap-6 py-4 border-y border-[#1E1E2C]">
          {[
            { label: 'Bedrooms', value: listing.bedrooms, icon: 'M2 20h20M5 20v-5a3 3 0 0 1 6 0v5M13 20v-5a3 3 0 0 1 6 0v5M8 12V7a3 3 0 0 1 6 0v5' },
            { label: 'Bathrooms', value: listing.bathrooms, icon: 'M4 12h16M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M6 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4' },
            { label: 'Type', value: 'Rental', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
          ].map(d => (
            <div key={d.label} className="text-center flex-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5" className="mx-auto mb-1"><path d={d.icon} /></svg>
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

        {/* ─── RESERVE HOUSE ─────────────────────────── */}
        {isAvailable && (
          <div className="mt-6 glass rounded-2xl p-5 border border-[#3B82F6]/10">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Reserve This Property</h3>
                <p className="text-[11px] text-[#5C5E72] mt-0.5">
                  Secure this property with a reservation fee and unlock full communication with staff.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between mb-4 py-3 px-4 rounded-xl bg-[#1A1A24]">
              <span className="text-xs text-[#5C5E72]">Reservation Fee</span>
              <span className="text-sm font-bold text-[#3B82F6]">₦10,000</span>
            </div>
            <button
              onClick={handleReserve}
              disabled={reserving}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {reserving ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                  Reserve House
                </>
              )}
            </button>
          </div>
        )}

        {/* Reserved badge (if not available) */}
        {!isAvailable && (
          <div className="mt-6 glass rounded-2xl p-5 border border-amber-500/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Property {statusLabel}</h3>
                <p className="text-[11px] text-[#5C5E72]">This property is currently not available for reservation.</p>
              </div>
            </div>
          </div>
        )}

        {/* ─── ENQUIRY CHAT ──────────────────────────── */}
        <div className="mt-6 glass rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Quick Enquiry</h3>
          <p className="text-[11px] text-[#5C5E72] mb-4">
            Ask a quick question before reserving. Staff will reply shortly.
          </p>

          {/* Example prompts */}
          <div className="flex flex-wrap gap-2 mb-4">
            {['Is it still available?', 'Can I inspect?', 'What area?'].map(q => (
              <button
                key={q}
                onClick={() => setEnquiryMessage(q)}
                className="h-7 px-3 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-[10px] text-[#8A8B9C] hover:border-[#3B82F6]/30 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>

          <form onSubmit={handleEnquiry} className="flex gap-2">
            <input
              value={enquiryMessage}
              onChange={e => setEnquiryMessage(e.target.value)}
              placeholder="Type your question..."
              maxLength={200}
              className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
            />
            <button
              type="submit"
              disabled={sendingEnquiry || !enquiryMessage.trim()}
              className="h-10 px-4 rounded-xl bg-[#3B82F6] text-white text-xs font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-40"
            >
              {sendingEnquiry ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Send'}
            </button>
          </form>
          <p className="text-[9px] text-[#5C5E72] mt-2">
            No contact sharing. No payment discussion. Quick questions only.
          </p>
        </div>
      </div>

      {/* ─── RESERVE POPUP ───────────────────────────── */}
      {showReservePopup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowReservePopup(false)} />
          <div className="relative w-full max-w-lg mx-auto p-5 animate-in slide-in-from-bottom-10 duration-300">
            <div className="glass rounded-2xl p-5 border border-[#3B82F6]/10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-[#3B82F6]/10 flex items-center justify-center">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Reservation Fee</h3>
                  <p className="text-xs text-[#5C5E72]">₦10,000 to secure this property</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#5C5E72]">Property</span>
                  <span className="text-xs text-white font-medium line-clamp-1 max-w-[200px] text-right">{listing.title}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#5C5E72]">Amount</span>
                  <span className="text-sm font-bold text-[#3B82F6]">₦10,000</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#5C5E72]">Valid for</span>
                  <span className="text-xs text-white">7 days</span>
                </div>
              </div>

              <p className="text-[11px] text-[#5C5E72] mb-4 leading-relaxed">
                Reservation secures the property temporarily and unlocks full communication with staff for inspection and move-in arrangements.
              </p>

              <button
                onClick={() => { setShowReservePopup(false); setShowFeatureIncoming(true); }}
                className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity mb-2.5"
              >
                Pay ₦10,000
              </button>
              <button
                onClick={() => setShowReservePopup(false)}
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm hover:bg-[#232330] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── FEATURE INCOMING POPUP ──────────────────── */}
      {showFeatureIncoming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowFeatureIncoming(false)} />
          <div className="relative w-full max-w-sm mx-auto p-5 animate-in zoom-in-95 duration-200">
            <div className="glass rounded-2xl p-6 border border-amber-500/10 text-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Feature Incoming</h3>
              <p className="text-xs text-[#5C5E72] leading-relaxed mb-5">
                Online reservation payments are currently under development. This feature will be available in a future update.
              </p>
              <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 mb-5">
                <p className="text-[11px] text-amber-400">
                  Your reservation has been recorded. You'll be notified when payments go live.
                </p>
              </div>
              <button
                onClick={() => setShowFeatureIncoming(false)}
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm font-medium hover:bg-[#232330] transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
