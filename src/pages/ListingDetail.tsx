import { useState, useEffect, useRef } from 'react';
import { getListing, createEnquiry, getPublicAgentByUserId, getOrCreateConversation } from '@/lib/supabase';
import { LISTING_STATUS_LABELS, LISTING_STATUS_COLORS, WEHOUSE_FEES } from '@/types';
import type { Listing, Profile, ListingStatus, RentalDuration } from '@/types';
import RentalPlanSelector from '@/components/RentalPlanSelector';
import { Toaster, toast } from 'sonner';

interface ListingDetailProps {
  listingId: string;
  onNavigate: () => void;
  isSaved: boolean;
  onToggleSave: () => void;
  profile: Profile;
  onGoToChat: (convId: string) => void;
}

export default function ListingDetail({ listingId, onNavigate, isSaved: _isSaved, onToggleSave: _onToggleSave, profile, onGoToChat: _onGoToChat }: ListingDetailProps) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentImage, setCurrentImage] = useState(0);
  const [showReservePopup, setShowReservePopup] = useState(false);
  const [enquiryMessage, setEnquiryMessage] = useState('');
  const [sendingEnquiry, setSendingEnquiry] = useState(false);

  const [agentInfo, setAgentInfo] = useState<{ user_id: string; username: string | null; avatar_url: string | null; role: string; phone: string | null } | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<{ durationYears: RentalDuration; year1Upfront: number; monthlyInstallment: number } | null>(null);

  useEffect(() => {
    async function load() {
      const { listing: data } = await getListing(listingId);
      setListing(data);
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
    if (!enquiryMessage.trim() || !profile) return;
    setSendingEnquiry(true);
    const { error } = await createEnquiry(listingId, profile.user_id, enquiryMessage.trim());
    setSendingEnquiry(false);
    if (error) { toast.error('Failed to send enquiry'); return; }
    toast.success('Enquiry sent! Staff will reply soon.');
    setEnquiryMessage('');
  }

  async function handleChatWithAgent() {
    if (!agentInfo || !listing?.chat_agent_id || !profile) { 
      toast.error('No agent assigned or not logged in'); 
      return; 
    }
    if (agentInfo.user_id === profile.user_id) { 
      toast.error('Cannot chat with yourself'); 
      return; 
    }
    setChatLoading(true);
    const { conversation, error } = await getOrCreateConversation(profile.user_id, agentInfo.user_id, listing.listing_id);
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
    // Navigate to chat - you can add your own navigation logic here
    toast.success('Chat started!');
  }

  async function handleReserve() {
    if (!profile) { toast.error('Please login first'); return; }
    // NOTE: Online reservations require Paystack (Phase 8).
    // Until then, we just show the rental plan breakdown.
    // No database record is created until payment is confirmed.
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

        <button onClick={onNavigate} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>

        <div className="absolute bottom-4 left-4">
          <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full border uppercase backdrop-blur-sm ${statusColor}`}>
            {statusLabel}
          </span>
        </div>

        {images.length > 1 && (
          <div className="absolute bottom-4 right-4 flex gap-1.5">
            {images.map((_, i) => (
              <button key={i} onClick={() => setCurrentImage(i)} className={`w-2 h-2 rounded-full transition-all ${i === currentImage ? 'bg-white w-4' : 'bg-white/40'}`} />
            ))}
          </div>
        )}

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
          <DetailItem label="Type" value={listing.sub_type ? `${listing.sub_type === 'short_let' ? 'Short Let' : 'Long Stay'} Apartment` : (listing.property_type ? (listing.property_type.charAt(0).toUpperCase() + listing.property_type.slice(1)) : `${listing.bedrooms} Bedroom${listing.bedrooms !== 1 ? 's' : ''}`)} icon="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <DetailItem label={listing.property_type ? 'Toilet/Bath' : 'Bathrooms'} value={listing.bathrooms} icon="M4 12h16M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M6 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" />
          <DetailItem label="Status" value={listing.availability_status ? listing.availability_status.charAt(0).toUpperCase() + listing.availability_status.slice(1) : 'Available'} icon="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </div>

        {/* Description */}
        {listing.description && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-white mb-2">Description</h3>
            <p className="text-xs text-[#8B8DA0] leading-relaxed">{listing.description}</p>
          </div>
        )}

        {/* Reserve House */}
        {isAvailable && profile && (
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
                  Choose 1, 2, or 3 year plan. Pay N{WEHOUSE_FEES.RESERVATION_FEE.toLocaleString()} reservation fee, then Year 1 rent after WeHouse inspection.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between mb-4 py-3 px-4 rounded-xl bg-[#1A1A24]">
              <span className="text-xs text-[#5C5E72]">Reservation Fee (72hr hold)</span>
              <span className="text-sm font-bold text-[#3B82F6]">N{WEHOUSE_FEES.RESERVATION_FEE.toLocaleString()}</span>
            </div>
            <button onClick={handleReserve} className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>View Rental Plans
            </button>
          </div>
        )}

        {/* Reserved badge */}
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

        {/* Quick Enquiry */}
        {profile && (
          <div className="mt-6 glass rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-1">Quick Enquiry</h3>
            <p className="text-[11px] text-[#5C5E72] mb-4">Ask a quick question before reserving. Staff will reply shortly.</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {['Is it still available?', 'Can I inspect?', 'What area?'].map(q => (
                <button key={q} onClick={() => setEnquiryMessage(q)} className="h-7 px-3 rounded-lg bg-[#1A1A24] border border-[#2A2A3A] text-[10px] text-[#8A8B9C] hover:border-[#3B82F6]/30 transition-colors">{q}</button>
              ))}
            </div>
            <form onSubmit={handleEnquiry} className="flex gap-2">
              <input value={enquiryMessage} onChange={e => setEnquiryMessage(e.target.value)} placeholder="Type your question..." maxLength={200} className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none" />
              <button type="submit" disabled={sendingEnquiry || !enquiryMessage.trim()} className="h-10 px-4 rounded-xl bg-[#3B82F6] text-white text-xs font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-40">
                {sendingEnquiry ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Send'}
              </button>
            </form>
            <p className="text-[9px] text-[#5C5E72] mt-2">No contact sharing. No payment discussion. Quick questions only.</p>

            {/* Chat With Agent */}
            {listing?.chat_agent_id && agentInfo && agentInfo.user_id !== profile.user_id && (
              <div className="mt-4 pt-4 border-t border-[#1E1E2C]">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${agentInfo.role === 'staff' ? 'bg-gradient-to-br from-amber-500 to-amber-700' : 'bg-gradient-to-br from-[#3B82F6] to-[#2563EB]'}`}>
                    {(agentInfo.username || 'A').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white">@{agentInfo.username || 'Agent'}</p>
                    <p className="text-[9px] text-amber-400">Staff Agent · {listing?.city}, {listing?.state}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleChatWithAgent} disabled={chatLoading} className={`flex-1 h-10 rounded-xl text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 ${agentInfo.role === 'staff' ? 'bg-gradient-to-r from-amber-500 to-amber-700' : 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB]'}`}>
                    {chatLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>Chat</>}
                  </button>
                  {agentInfo.phone && (
                    <a href={`tel:${agentInfo.phone}`} className="h-10 px-4 rounded-xl bg-green-600 text-white text-xs font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>Call
                    </a>
                  )}
                </div>
                {agentInfo.phone && <p className="text-[9px] text-[#5C5E72] mt-1.5 text-center">{agentInfo.phone}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reservation Popup with Rental Plans */}
      {showReservePopup && listing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowReservePopup(false)} />
          <div className="relative w-full max-w-lg mx-auto p-5 animate-in slide-in-from-bottom-10 duration-300 max-h-[90vh] overflow-y-auto">
            <div className="glass rounded-2xl p-5 border border-[#3B82F6]/20 bg-[#12121A]/95">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Reserve This Property</h3>
                  <p className="text-[10px] text-[#5C5E72]">{listing.title} — {listing.city}, {listing.state}</p>
                </div>
              </div>

              {/* Rental Plan Selector */}
              <RentalPlanSelector
                annualRent={listing.price || 0}
                onSelectPlan={setSelectedPlan}
              />

              {/* Reservation Action — Online payments coming soon */}
              {selectedPlan && (
                <div className="mt-4 space-y-3">
                  {/* Coming Soon Banner */}
                  <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 flex items-start gap-2.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                    </svg>
                    <div>
                      <p className="text-[11px] font-medium text-amber-400">Online Booking Coming Soon</p>
                      <p className="text-[10px] text-[#5C5E72] mt-0.5">
                        Online reservations with Paystack are not yet live.
                        To reserve this property, contact us at support@wehouse.com.ng or use the chat below.
                      </p>
                    </div>
                  </div>

                  {/* Fee Breakdown (informational only) */}
                  <div className="rounded-xl bg-[#1A1A24] p-3 space-y-1.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#5C5E72]">Reservation Fee (when live)</span>
                      <span className="text-white">N{WEHOUSE_FEES.RESERVATION_FEE.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-[#5C5E72]">Year 1 Rent (after inspection)</span>
                      <span className="text-white">N{selectedPlan.year1Upfront.toLocaleString()}</span>
                    </div>
                    {selectedPlan.durationYears > 1 && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-[#5C5E72]">Monthly Installment (Yr 2+)</span>
                        <span className="text-white">N{selectedPlan.monthlyInstallment.toLocaleString()}/mo</span>
                      </div>
                    )}
                    <div className="border-t border-[#232330] pt-1.5 flex justify-between text-[10px]">
                      <span className="text-[#5C5E72]">Security Deposit ({WEHOUSE_FEES.SECURITY_DEPOSIT_DEFAULT_PERCENT}%)</span>
                      <span className="text-white">N{Math.max(Math.round(listing.price * WEHOUSE_FEES.SECURITY_DEPOSIT_DEFAULT_PERCENT / 100), WEHOUSE_FEES.SECURITY_DEPOSIT_MIN_NGN).toLocaleString()}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => { toast.info('Contact support@wehouse.com.ng to reserve this property'); }}
                    className="w-full h-12 rounded-xl bg-[#3B82F6]/30 text-[#3B82F6] font-semibold text-sm cursor-not-allowed opacity-60"
                    disabled
                  >
                    Online Reservations — Coming Soon
                  </button>
                </div>
              )}

              <button onClick={() => setShowReservePopup(false)} className="w-full mt-3 h-10 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs font-medium hover:bg-[#2A2A3A] transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoPlayer({ url, index }: { url: string; index: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  return (
    <div className="relative rounded-xl overflow-hidden bg-[#1A1A24]">
      <video ref={videoRef} src={url} className="w-full aspect-video object-cover" onClick={() => { if (videoRef.current) { if (videoRef.current.paused) { videoRef.current.play(); setIsPlaying(true); } else { videoRef.current.pause(); setIsPlaying(false); } } }} />
      {!isPlaying && <div className="absolute inset-0 flex items-center justify-center bg-black/30"><div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"><svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg></div></div>}
      <div className="absolute bottom-2 right-2"><span className="text-[9px] font-medium text-white/80 bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded-md">Video {index + 1}</span></div>
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
