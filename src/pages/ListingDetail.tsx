import { useState, useEffect, useRef } from 'react';
import {
  getListing, createEnquiry, getPublicAgentByUserId, getOrCreateConversation,
  getReservationForListing, createReservation, updateReservationPlan,
  createInspectionRequest, getInspectionRequestForReservation, supabase,
} from '@/lib/supabase';
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

type PopupView = 'plans' | 'confirmed' | 'inspection_requested' | 'edit_plan';

export default function ListingDetail({ listingId, onNavigate, isSaved: _isSaved, onToggleSave: _onToggleSave, profile, onGoToChat: _onGoToChat }: ListingDetailProps) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentImage, setCurrentImage] = useState(0);
  const [showReservePopup, setShowReservePopup] = useState(false);
  const [popupView, setPopupView] = useState<PopupView>('plans');
  const [enquiryMessage, setEnquiryMessage] = useState('');
  const [sendingEnquiry, setSendingEnquiry] = useState(false);

  const [agentInfo, setAgentInfo] = useState<{ user_id: string; username: string | null; avatar_url: string | null; role: string; phone: string | null } | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<{ durationYears: RentalDuration; year1Upfront: number; monthlyInstallment: number } | null>(null);

  // Reservation state
  const [reservation, setReservation] = useState<any>(null);
  const [inspection, setInspection] = useState<any>(null);
  const [reserving, setReserving] = useState(false);
  const [requestingInspection, setRequestingInspection] = useState(false);

  useEffect(() => {
    async function load() {
      const { listing: data } = await getListing(listingId);
      setListing(data);
      if (data?.chat_agent_id) {
        const { agent } = await getPublicAgentByUserId(data.chat_agent_id);
        setAgentInfo(agent);
      }
      // Check if user already has a reservation for this listing
      if (profile) {
        const { reservation: existingRes } = await getReservationForListing(listingId, profile.user_id);
        if (existingRes) {
          setReservation(existingRes);
          // Load their selected plan
          if (existingRes.rental_plan_years) {
            setSelectedPlan({
              durationYears: existingRes.rental_plan_years as RentalDuration,
              year1Upfront: 0,
              monthlyInstallment: 0,
            });
          }
          // Check if they already requested inspection
          const { inspection: existingInsp } = await getInspectionRequestForReservation(existingRes.id);
          if (existingInsp) {
            setInspection(existingInsp);
          }
        }
      }
      setLoading(false);
    }
    load();
  }, [listingId, profile.user_id]);

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
    setShowReservePopup(true);
    // If already reserved, show confirmed view; otherwise show plans
    if (reservation) {
      setPopupView(inspection ? 'inspection_requested' : 'confirmed');
    } else {
      setPopupView('plans');
    }
  }

  // Step 1: User selects plan and clicks "Reserve Now"
  async function handleReserveWithPlan() {
    if (!profile || !listing || !selectedPlan) return;
    setReserving(true);

    const { reservation: res, error, alreadyExists } = await createReservation(
      listingId,
      profile.user_id,
      { title: listing.title, price: listing.price, location: `${listing.city}, ${listing.state}` }
    );

    if (error) {
      toast.error('Failed to reserve: ' + error.message);
      setReserving(false);
      return;
    }

    // Save the rental plan
    if (res) {
      await updateReservationPlan(res.id, selectedPlan.durationYears);
      res.rental_plan_years = selectedPlan.durationYears;
      setReservation(res);
    }

    setReserving(false);
    if (alreadyExists) {
      toast.success('You already have a reservation for this property');
    } else {
      toast.success('Property reserved! Valid for 72 hours.');
    }
    setPopupView('confirmed');
  }

  // Step 2a: Edit rental plan
  async function handleSaveEditedPlan(newPlanYears: RentalDuration) {
    if (!reservation) return;
    setReserving(true);
    await updateReservationPlan(reservation.id, newPlanYears);
    setReservation((prev: any) => ({ ...prev, rental_plan_years: newPlanYears }));
    setSelectedPlan((prev: any) => ({ ...prev, durationYears: newPlanYears }));
    toast.success('Rental plan updated');
    setReserving(false);
    setPopupView('confirmed');
  }

  // Step 2b: Request inspection
  async function handleRequestInspection() {
    if (!profile || !listing || !reservation) return;
    setRequestingInspection(true);
    const { inspection: insp, error, alreadyExists } = await createInspectionRequest(
      reservation.id,
      listingId,
      profile.user_id,
      `User requests inspection for ${listing.title} in ${listing.city}`
    );
    setRequestingInspection(false);
    if (error) {
      toast.error('Failed to request inspection: ' + error.message);
      return;
    }
    if (alreadyExists) {
      toast.success('Inspection already requested');
    } else {
      toast.success('Inspection requested! WeHouse will contact you shortly.');
    }
    if (insp) setInspection(insp);
    setPopupView('inspection_requested');
  }

  // Step 2c: Proceed with rent (Paystack coming soon)
  async function handleProceedWithRent() {
    toast.info('Paystack payment coming soon. Contact support@wehouse.com.ng to complete your rent payment.');
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

        {/* Reserve House / View Reservation */}
        {isAvailable && profile && (
          <div className="mt-6 glass rounded-2xl p-5 border border-[#3B82F6]/10">
            {reservation ? (
              /* User already has a reservation */
              <>
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">You Have Reserved This Property</h3>
                    <p className="text-[11px] text-[#5C5E72] mt-0.5">
                      {inspection
                        ? 'Inspection requested. WeHouse will contact you shortly.'
                        : `Choose to pay rent now, or request inspection first. Valid for 72 hours.`}
                    </p>
                  </div>
                </div>
                {inspection && (
                  <div className="mb-4 py-2 px-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
                    <p className="text-[10px] text-blue-400">Inspection Status: <span className="font-bold capitalize">{inspection.status}</span></p>
                  </div>
                )}
                <button onClick={handleReserve} className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  {inspection ? 'View Inspection Status' : 'View Reservation Options'}
                </button>
              </>
            ) : (
              /* No reservation yet */
              <>
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
              </>
            )}
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

      {/* Reservation Popup — Multi-step flow */}
      {showReservePopup && listing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowReservePopup(false)} />
          <div className="relative w-full max-w-lg mx-auto p-5 animate-in slide-in-from-bottom-10 duration-300 max-h-[90vh] overflow-y-auto">
            <div className="glass rounded-2xl p-5 border border-[#3B82F6]/20 bg-[#12121A]/95">

              {/* VIEW 1: Select Rental Plan */}
              {(popupView === 'plans' || popupView === 'edit_plan') && (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">
                        {popupView === 'edit_plan' ? 'Change Rental Plan' : 'Reserve This Property'}
                      </h3>
                      <p className="text-[10px] text-[#5C5E72]">{listing.title} — {listing.city}, {listing.state}</p>
                    </div>
                  </div>

                  <RentalPlanSelector
                    annualRent={listing.price || 0}
                    subType={listing.sub_type || 'long_stay'}
                    securityDepositAmount={listing.security_deposit_amount}
                    onSelectPlan={setSelectedPlan}
                  />

                  {selectedPlan && (
                    <div className="mt-4 space-y-3">
                      {/* Paystack coming soon notice */}
                      <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
                        <p className="text-[10px] text-amber-400">
                          <strong>Paystack coming soon.</strong> For now, reservation is recorded. You&apos;ll pay the reservation fee when Paystack is connected.
                        </p>
                      </div>

                      <button
                        onClick={popupView === 'edit_plan' ? () => handleSaveEditedPlan(selectedPlan.durationYears) : handleReserveWithPlan}
                        disabled={reserving}
                        className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                      >
                        {reserving ? (
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : popupView === 'edit_plan' ? (
                          <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7" /></svg>
                            Save Plan
                          </>
                        ) : (
                          <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                            Reserve Now
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {popupView === 'edit_plan' && (
                    <button onClick={() => setPopupView('confirmed')} className="w-full mt-2 h-10 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs font-medium hover:bg-[#2A2A3A] transition-colors">
                      Cancel
                    </button>
                  )}
                  {popupView === 'plans' && (
                    <button onClick={() => setShowReservePopup(false)} className="w-full mt-2 h-10 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs font-medium hover:bg-[#2A2A3A] transition-colors">
                      Close
                    </button>
                  )}
                </>
              )}

              {/* VIEW 2: Reservation Confirmed — Choose next step */}
              {popupView === 'confirmed' && reservation && (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">Reservation Confirmed!</h3>
                      <p className="text-[10px] text-[#5C5E72]">Valid for 72 hours · {reservation.rental_plan_years || selectedPlan?.durationYears || 1} year plan</p>
                    </div>
                  </div>

                  {/* Plan summary */}
                  <div className="rounded-xl bg-[#1A1A24] p-4 space-y-2 mb-4">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#5C5E72]">Property</span>
                      <span className="text-white font-medium truncate max-w-[200px]">{listing.title}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[#5C5E72]">Plan</span>
                      <span className="text-white">{reservation.rental_plan_years || selectedPlan?.durationYears || 1} Year{((reservation.rental_plan_years || selectedPlan?.durationYears || 1) > 1) ? 's' : ''}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[#5C5E72]">Reservation Fee</span>
                      <span className="text-[#3B82F6] font-bold">N{WEHOUSE_FEES.RESERVATION_FEE.toLocaleString()}</span>
                    </div>
                    {selectedPlan && (
                      <div className="flex justify-between text-xs border-t border-[#232330] pt-2">
                        <span className="text-[#5C5E72]">Year 1 Rent</span>
                        <span className="text-white font-bold">N{selectedPlan.year1Upfront.toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  {/* Three action buttons */}
                  <div className="space-y-2.5">
                    {/* Edit Plan */}
                    <button
                      onClick={() => setPopupView('edit_plan')}
                      className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm font-medium hover:border-[#3B82F6]/30 transition-colors flex items-center justify-center gap-2"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      Edit Rental Plan
                    </button>

                    {/* Proceed with Rent */}
                    <button
                      onClick={handleProceedWithRent}
                      className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                      Proceed with Rent
                    </button>

                    {/* Request Inspection */}
                    <button
                      onClick={handleRequestInspection}
                      disabled={requestingInspection}
                      className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {requestingInspection ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                          Request Inspection
                        </>
                      )}
                    </button>
                  </div>

                  <p className="text-[9px] text-[#5C5E72] mt-3 text-center">
                    Need help? Chat with WeHouse or call {listing.contact_phone || 'support@wehouse.com.ng'}
                  </p>
                </>
              )}

              {/* VIEW 3: Inspection Requested */}
              {popupView === 'inspection_requested' && (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">Inspection Requested</h3>
                      <p className="text-[10px] text-[#5C5E72]">Status: {inspection?.status === 'pending' ? 'Waiting for WeHouse to assign officer' : inspection?.status}</p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-blue-500/5 border border-blue-500/10 p-4 space-y-2 mb-4">
                    <p className="text-xs text-white font-medium">What happens next:</p>
                    <ol className="text-[11px] text-[#8A8B9C] space-y-1.5 list-decimal list-inside">
                      <li>WeHouse assigns a field officer to inspect the property</li>
                      <li>The officer contacts you to schedule a date/time</li>
                      <li>You visit the property together with the officer</li>
                      <li>Officer writes a report on property condition</li>
                      <li>You decide: proceed with rent or cancel reservation</li>
                    </ol>
                  </div>

                  {/* Chat with WeHouse about inspection */}
                  <button
                    onClick={async () => {
                      // Find staff to chat with
                      let staffMember = null;
                      for (const role of ['staff', 'admin', 'creator', 'creator_admin']) {
                        const { data } = await supabase
                          .from('profiles').select('user_id, username').eq('role', role).limit(1).maybeSingle();
                        if (data) { staffMember = data; break; }
                      }
                      if (!staffMember) { toast.error('No staff available'); return; }
                      const { conversation } = await getOrCreateConversation(
                        profile.user_id, staffMember.user_id, null, 'enquiry', `Inspection for ${listing?.title}`
                      );
                      if (conversation && _onGoToChat) {
                        setShowReservePopup(false);
                        _onGoToChat(conversation.id);
                      }
                    }}
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 mb-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                    Chat with WeHouse
                  </button>

                  <button onClick={() => setShowReservePopup(false)} className="w-full h-10 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs font-medium hover:bg-[#2A2A3A] transition-colors">
                    Close
                  </button>
                </>
              )}
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
