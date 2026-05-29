import { useState, useEffect, useRef } from 'react';
import { getListingById, createEnquiry, createReservation, getPublicAgentByUserId, getOrCreateConversation } from '@/lib/supabase';
import { LISTING_STATUS_LABELS, LISTING_STATUS_COLORS } from '@/types';
import type { Listing, Profile, ListingStatus } from '@/types';
import { Toaster, toast } from 'sonner';

interface ListingDetailProps {
  listingId: string;
  onNavigate: () => void;
  isSaved: boolean;
  onToggleSave: () => void;
  profile: Profile;
  onGoToChat?: (convId?: string) => void;
}

export default function ListingDetail({ listingId, onNavigate, isSaved, onToggleSave, profile, onGoToChat }: ListingDetailProps) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentImage, setCurrentImage] = useState(0);
  const [showReservePopup, setShowReservePopup] = useState(false);
  const [enquiryMessage, setEnquiryMessage] = useState('');
  const [sendingEnquiry, setSendingEnquiry] = useState(false);
  const [reserving, setReserving] = useState(false);
  // Public agent info — username, avatar, role, phone. NO email.
  const [agentInfo, setAgentInfo] = useState<{ user_id: string; username: string | null; avatar_url: string | null; role: string; phone: string | null } | null>(null);
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    async function load() {
      const { listing: data } = await getListingById(listingId);
      setListing(data);
      // Load assigned chat agent's PUBLIC info — lookup by chat_agent_id (user_id)
      // This is who users will chat with, NOT the listing owner
      if (data?.chat_agent_id) {
        const { agent } = await getPublicAgentByUserId(data.chat_agent_id);
        setAgentInfo(agent);
      }
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

  async function handleChatWithAgent() {
    // Chat only available if a chat_agent_id is assigned (staff or admin)
    if (!agentInfo || !listing?.chat_agent_id) { toast.error('No agent assigned for this listing'); return; }
    if (agentInfo.user_id === profile.user_id) { toast.error('Cannot chat with yourself'); return; }
    setChatLoading(true);
    // Pass listing_id so conversation is linked to this listing
    const { conversation, error } = await getOrCreateConversation(profile.user_id, agentInfo.user_id, listing.listing_id);
    // Auto-send listing context as first message if conversation is new
    if (conversation && !error) {
      const { messages } = await import('@/lib/supabase').then(m => m.getMessages(conversation.id));
      if (!messages || messages.length === 0) {
        await import('@/lib/supabase').then(m => m.sendMessage(
          conversation.id,
          profile.user_id,
          `Hi, I'm interested in your listing: "${listing.title}" in ${listing.city}, ₦${listing.price?.toLocaleString()}/year`
        ));
      }
    }
    setChatLoading(false);
    if (error || !conversation) { toast.error('Failed to start chat'); return; }
    onGoToChat?.(conversation.id);
  }

  async function handleReserve() {
    setReserving(true);
    const { error, alreadyExists } = await createReservation(
      listingId,
      profile.user_id,
      {
        title: listing?.title || '',
        price: listing?.price || 0,
        location: `${listing?.city || ''}, ${listing?.state || ''}`,
      }
    );
    setReserving(false);
    if (error) { toast.error('Reservation failed: ' + error.message); return; }
    if (alreadyExists) {
      toast.info('You already have a pending reservation for this property');
    } else {
      toast.success('Reservation created! Contact support to complete.');
    }
    setShowReservePopup(true);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-transparent flex flex-col items-center justify-center gap-3">
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
    <div className="min-h-screen bg-transparent pb-6">
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

        {/* Video badge */}
        {listing.videos && listing.videos.length > 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2">
            <span className="text-[9px] font-bold px-2.5 py-1 rounded-full bg-purple-500/80 text-white backdrop-blur-sm flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              {listing.videos.length} Video{listing.videos.length > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Video Section */}
      {listing.videos && listing.videos.length > 0 && (
        <div className="px-5 -mt-2 mb-4">
          <h3 className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" /></svg>
            Property Videos
          </h3>
          <div className="space-y-2">
            {listing.videos.map((url, i) => (
              <VideoPlayer key={i} url={url} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="px-5 py-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h1 className="text-lg font-bold text-white">{listing.title}</h1>
          <span className="text-lg font-bold text-[#3B82F6] whitespace-nowrap">₦{listing.price.toLocaleString()}<span className="text-xs font-normal text-[#5C5E72] ml-1">/year</span></span>
        </div>

        <p className="text-xs text-[#5C5E72] mb-4">
          {listing.address}{listing.city ? `, ${listing.city}` : ''}{listing.state ? `, ${listing.state}` : ''}
        </p>

        {/* Details */}
        <div className="flex gap-6 py-4 border-y border-[#1E1E2C]">
          <DetailItem
            label="Type"
            value={listing.property_type === 'studio_apartment' ? 'Studio Apt' : listing.property_type === 'self_contain' ? 'Self Contain' : `${listing.bedrooms} Bedroom${listing.bedrooms !== 1 ? 's' : ''}`}
            icon="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
          />
          <DetailItem
            label={listing.property_type ? 'Toilet/Bath' : 'Bathrooms'}
            value={listing.bathrooms}
            icon="M4 12h16M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M6 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4"
          />
          <DetailItem
            label="Status"
            value={listing.availability_status ? listing.availability_status.charAt(0).toUpperCase() + listing.availability_status.slice(1) : 'Available'}
            icon="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
          />
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
                  Create a reservation. Pay manually via our support team on WhatsApp. No online payment yet.
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

        {/* Reserved badge — show friendly message to users */}
        {listing.availability_status === 'reserved' && (
          <div className="mt-6 glass rounded-2xl p-5 border border-amber-500/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Someone is interested already</h3>
                <p className="text-[11px] text-[#5C5E72]">Check back later — this property may become available again.</p>
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

          {/* ─── CHAT WITH AGENT ───────────────────────── */}
          {/* Shows if a chat_agent_id is assigned (staff or admin). Creator who posted stays anonymous. */}
          {listing?.chat_agent_id && agentInfo && agentInfo.user_id !== profile.user_id && (
            <div className="mt-4 pt-4 border-t border-[#1E1E2C]">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                  agentInfo.role === 'staff'
                    ? 'bg-gradient-to-br from-amber-500 to-amber-700'
                    : 'bg-gradient-to-br from-[#3B82F6] to-[#2563EB]'
                }`}>
                  {(agentInfo.username || 'A').charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-medium text-white">@{agentInfo.username || 'Agent'}</p>
                  <p className="text-[9px] text-amber-400">Staff Agent · {listing?.city}, {listing?.state}</p>
                </div>
              </div>
              <div className="flex gap-2">
                {/* Chat button */}
                <button
                  onClick={handleChatWithAgent}
                  disabled={chatLoading}
                  className={`flex-1 h-10 rounded-xl text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 ${
                    agentInfo.role === 'staff'
                      ? 'bg-gradient-to-r from-amber-500 to-amber-700'
                      : 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB]'
                  }`}
                >
                  {chatLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                      Chat
                    </>
                  )}
                </button>

                {/* Call button — only if agent has phone */}
                {agentInfo.phone && (
                  <a
                    href={`tel:${agentInfo.phone}`}
                    className="h-10 px-4 rounded-xl bg-green-600 text-white text-xs font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 flex-shrink-0"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                    Call
                  </a>
                )}
              </div>

              {agentInfo.phone && (
                <p className="text-[9px] text-[#5C5E72] mt-1.5 text-center">
                  {agentInfo.phone}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── MANUAL RESERVATION POPUP ────────────────── */}
      {showReservePopup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowReservePopup(false)} />
          <div className="relative w-full max-w-lg mx-auto p-5 animate-in slide-in-from-bottom-10 duration-300">
            <div className="glass rounded-2xl p-5 border border-green-500/10">
              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Reservation Created</h3>
                  <p className="text-xs text-green-400">Complete payment via support</p>
                </div>
              </div>

              {/* Property summary */}
              <div className="p-4 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#5C5E72]">Property</span>
                  <span className="text-xs text-white font-medium line-clamp-1 max-w-[200px] text-right">{listing.title}</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#5C5E72]">Reservation Fee</span>
                  <span className="text-sm font-bold text-green-400">₦10,000</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#5C5E72]">Status</span>
                  <span className="text-xs text-amber-400">Pending Payment</span>
                </div>
              </div>

              {/* Instructions */}
              <div className="space-y-3 mb-5">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-[#1A1A24]">
                  <span className="text-sm font-bold text-[#3B82F6] flex-shrink-0">1</span>
                  <p className="text-xs text-[#8A8B9C]">Contact our support team on WhatsApp with your reservation details</p>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-[#1A1A24]">
                  <span className="text-sm font-bold text-[#3B82F6] flex-shrink-0">2</span>
                  <p className="text-xs text-[#8A8B9C]">Pay ₦10,000 reservation fee manually (bank transfer or cash)</p>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-[#1A1A24]">
                  <span className="text-sm font-bold text-[#3B82F6] flex-shrink-0">3</span>
                  <p className="text-xs text-[#8A8B9C]">Support will confirm your payment and schedule an inspection</p>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-[#1A1A24]">
                  <span className="text-sm font-bold text-[#3B82F6] flex-shrink-0">4</span>
                  <p className="text-xs text-[#8A8B9C]">After inspection, our staff will guide you through secure payment</p>
                </div>
              </div>

              {/* WhatsApp CTA */}
              <a
                href="https://wa.me/2348000000000?text=Hi%20WeHouse%20Support,%20I%20just%20reserved%20a%20property%20and%20want%20to%20complete%20payment."
                target="_blank"
                rel="noopener noreferrer"
                className="w-full h-12 rounded-xl bg-gradient-to-r from-[#22C55E] to-[#16A34A] text-white text-sm font-semibold shadow-lg shadow-green-500/20 hover:opacity-90 transition-opacity flex items-center justify-center gap-2 mb-2.5"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Contact Support on WhatsApp
              </a>

              <button
                onClick={() => setShowReservePopup(false)}
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm hover:bg-[#232330] transition-colors"
              >
                Close
              </button>

              <p className="text-[9px] text-[#5C5E72] text-center mt-3">
                Support: +234 800 000 0000 · Available Mon-Sat 8AM-6PM
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline video player component
function VideoPlayer({ url, index }: { url: string; index: number }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setPlaying(true);
    } else {
      videoRef.current.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="relative rounded-xl overflow-hidden bg-[#12121A] border border-[#1E1E2C]">
      <video
        ref={videoRef}
        src={url}
        className="w-full aspect-video object-cover"
        preload="metadata"
        playsInline
        onClick={togglePlay}
        onEnded={() => setPlaying(false)}
      />
      {/* Play overlay when paused */}
      {!playing && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer"
          onClick={togglePlay}
        >
          <div className="w-14 h-14 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20 hover:bg-white/25 transition-all active:scale-90">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      )}
      {/* Video label */}
      <div className="absolute bottom-2 left-2.5 z-10">
        <span className="text-[9px] font-medium text-white/80 bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded-md">
          Video {index + 1}
        </span>
      </div>
    </div>
  );
}

function DetailItem({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="text-center flex-1">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5" className="mx-auto mb-1"><path d={icon} /></svg>
      <div className="text-sm font-bold text-white">{value}</div>
      <div className="text-[10px] text-[#5C5E72]">{label}</div>
    </div>
  );
}
