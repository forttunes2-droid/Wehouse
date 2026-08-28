import { useEffect, useState } from 'react';
import {
  createInspectionRequest,
  createReservation,
  getInspectionRequestForReservation,
  getListing,
  getReservationForListing,
  initializeReservationPayment,
  supabase,
  updateReservationPlan,
} from '@/lib/supabase';
import { initializeApartmentRentPayment } from '@/lib/supabase/housing-payments';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import type { Listing, Profile, RentalDuration } from '@/types';
import RentalPlanSelector from '@/components/RentalPlanSelector';
import ConfirmDialog from '@/components/ConfirmDialog';
import PropertyMediaCarousel from '@/components/PropertyMediaCarousel';
import { Toaster, toast } from 'sonner';

type Props = {
  listingId: string;
  onNavigate: () => void;
  isSaved: boolean;
  onToggleSave: () => void;
  profile: Profile;
  onGoToChat: (convId: string) => void;
};

type Plan = { durationYears: RentalDuration; year1Upfront: number; monthlyInstallment: number };
type ListingState = 'pending_approval' | 'available' | 'reserved' | 'occupied' | 'maintenance' | 'closed' | 'rejected';
const LISTING_STATES: Record<ListingState, { label: string; cls: string }> = {
  pending_approval: { label: 'Pending approval', cls: 'border-violet-500/20 bg-violet-500/10 text-violet-300' },
  available: { label: 'Available', cls: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
  reserved: { label: 'Reserved', cls: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  occupied: { label: 'Occupied', cls: 'border-violet-500/20 bg-violet-500/10 text-violet-300' },
  maintenance: { label: 'Maintenance', cls: 'border-orange-500/20 bg-orange-500/10 text-orange-300' },
  closed: { label: 'Closed', cls: 'border-white/10 bg-white/[.04] text-[#8A8E9D]' },
  rejected: { label: 'Rejected', cls: 'border-red-500/20 bg-red-500/10 text-red-300' },
};
const ACTIVE_RESERVATION_STATES = new Set(['payment_pending', 'reserved', 'inspection_pending', 'ready_for_move_in', 'occupied']);

export default function ListingDetail({ listingId, onNavigate, profile, isSaved, onToggleSave }: Props) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [reservation, setReservation] = useState<any>(null);
  const [inspection, setInspection] = useState<any>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [moveInConfirm, setMoveInConfirm] = useState(false);
  const { getNumber } = usePlatformSettings();
  const reservationFee = getNumber('reservation_fee', 5000);

  async function load() {
    setLoading(true);
    const { listing: property } = await getListing(listingId);
    setListing(property);
    if (property) {
      const { reservation: current } = await getReservationForListing(listingId, profile.user_id);
      setReservation(current);
      if (current?.rental_plan_years) {
        setPlan({ durationYears: current.rental_plan_years as RentalDuration, year1Upfront: Number(current.upfront_rent_required || 0), monthlyInstallment: current.installment_count ? Number(current.installment_balance || 0) / Number(current.installment_count) : 0 });
      }
      if (current?.id) {
        const { inspection: request } = await getInspectionRequestForReservation(current.id);
        setInspection(request || null);
      } else {
        setInspection(null);
      }
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [listingId, profile.user_id]);

  function support(kind: 'property' | 'reservation' | 'inspection' | 'payment' = 'property') {
    if (!listing) return;
    const contextId = kind === 'inspection'
      ? inspection?.id || reservation?.id || listing.listing_id
      : kind === 'reservation' || kind === 'payment'
        ? reservation?.id || listing.listing_id
        : listing.listing_id;
    const contextType = kind === 'inspection'
      ? 'property_inspection'
      : kind === 'reservation'
        ? 'apartment_reservation'
        : kind === 'payment'
          ? 'apartment_payment'
          : 'property_listing';
    window.dispatchEvent(new CustomEvent('openSupportChat', {
      detail: {
        category: kind === 'inspection' ? 'property_inspection' : kind === 'payment' ? 'payment' : 'apartment_booking',
        subject: `${kind === 'property' ? 'Question about' : kind === 'payment' ? 'Payment help' : kind === 'inspection' ? 'Inspection help' : 'Reservation help'} · ${listing.title}`,
        contextType,
        contextId,
        contextSnapshot: {
          listing_id: listing.listing_id,
          listing_title: listing.title,
          location: [listing.city, listing.state].filter(Boolean).join(', '),
          price: listing.price,
          reservation_id: reservation?.id || null,
          reservation_status: reservation?.status || null,
          rent_payment_status: reservation?.rent_payment_status || null,
          inspection_id: inspection?.id || null,
          inspection_status: inspection?.status || null,
        },
      },
    }));
  }

  async function openCheckout() {
    if (!listing || !plan) return toast.error('Choose a rental plan first');
    setBusy(true);
    try {
      const { reservation: created, error: reserveError } = await createReservation(listingId, profile.user_id);
      if (reserveError || !created) throw new Error(reserveError?.message || 'Could not start this reservation');
      const { reservation: planned, error: planError } = await updateReservationPlan(created.id, plan.durationYears);
      if (planError) throw new Error(planError.message);
      const next = planned || created;
      setReservation(next);
      if (next.status !== 'payment_pending') {
        toast.success('Your reservation is already active');
        setShowPlan(false);
        await load();
        return;
      }
      const reference = String(next.payment_reference || '');
      if (!reference) throw new Error('Reservation payment reference is missing');
      const { result, error } = await initializeReservationPayment(reference);
      if (error) throw error;
      if (result?.already_paid) {
        toast.success('Reservation payment is already confirmed');
        setShowPlan(false);
        await load();
        return;
      }
      if (!result?.success || !result.authorization_url) throw new Error(result?.error || 'Paystack checkout could not be opened');
      window.location.assign(result.authorization_url);
    } catch (error: any) {
      toast.error(error?.message || 'Could not start payment');
      setBusy(false);
    }
  }

  async function resumeCheckout() {
    if (!reservation?.payment_reference) return toast.error('Payment reference is missing');
    setBusy(true);
    try {
      const { result, error } = await initializeReservationPayment(String(reservation.payment_reference));
      if (error) throw error;
      if (result?.already_paid) {
        toast.success('Payment is already confirmed');
        await load();
        setBusy(false);
        return;
      }
      if (!result?.success || !result.authorization_url) throw new Error(result?.error || 'Could not reopen Paystack');
      window.location.assign(result.authorization_url);
    } catch (error: any) {
      toast.error(error?.message || 'Could not continue payment');
      setBusy(false);
    }
  }

  async function payContractRent() {
    if (!reservation?.id) return;
    setBusy(true);
    try {
      const { result, error } = await initializeApartmentRentPayment(reservation.id);
      if (error) throw error;
      if (result?.already_paid) {
        toast.success('Required contract rent is already confirmed');
        await load();
        setBusy(false);
        return;
      }
      if (!result?.success || !result.authorization_url) throw new Error(result?.error || 'Could not open contract-rent checkout');
      window.location.assign(result.authorization_url);
    } catch (error: any) {
      toast.error(error?.message || 'Could not start contract-rent payment');
      setBusy(false);
    }
  }

  async function requestInspection() {
    if (!reservation) return;
    setBusy(true);
    const { inspection: request, error } = await createInspectionRequest(reservation.id, listingId, profile.user_id, `Inspection requested for ${listing?.title || 'property'}`);
    setBusy(false);
    if (error) return toast.error(error.message);
    setInspection(request || null);
    await load();
    toast.success('Inspection requested');
  }

  async function confirmMoveIn() {
    if (!reservation?.id || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('confirm_my_move_in', { p_reservation_id: reservation.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(data?.already_confirmed ? 'Move-in was already confirmed' : 'Move-in confirmed. Your tenancy is now active.');
    await load();
  }

  if (loading) return <div className="grid min-h-[70dvh] place-items-center bg-[#090A0F]"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>;
  if (!listing) return <div className="grid min-h-[70dvh] place-items-center bg-[#090A0F] px-4 text-center text-white"><div><p className="text-sm font-semibold">Property unavailable</p><button onClick={onNavigate} className="mt-4 text-xs text-violet-400">← Go back</button></div></div>;

  const status = String(listing.status || 'available') as ListingState;
  const state = LISTING_STATES[status] || LISTING_STATES.closed;
  const images = listing.images?.length ? listing.images : ['https://placehold.co/900x650/171922/666A7A?text=No+Image'];
  const hasOwnActiveReservation = Boolean(reservation && ACTIVE_RESERVATION_STATES.has(String(reservation.status)));
  const canStartReservation = status === 'available' && !hasOwnActiveReservation;

  return <div className="min-h-[100dvh] overflow-x-hidden bg-[#090A0F] pb-12 text-white">
    <Toaster position="top-center" richColors />
    <div className="mx-auto max-w-6xl">
      <PropertyMediaCarousel images={images} title={listing.title}>
        <button onClick={onNavigate} className="absolute left-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black/50 backdrop-blur">←</button>
        <button onClick={onToggleSave} aria-label={isSaved?'Remove from saved properties':'Save property'} aria-pressed={isSaved} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black/50 backdrop-blur"><Heart filled={isSaved}/></button>
        <span className={`absolute bottom-4 left-4 rounded-full border px-3 py-1.5 text-[9px] font-bold uppercase ${state.cls}`}>{state.label}</span>
      </PropertyMediaCarousel>

      <main className="px-4 py-5 sm:px-6 lg:px-8"><div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <section><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h1 className="break-words text-2xl font-bold">{listing.title}</h1><p className="mt-1 text-xs text-[#777B8B]">{[listing.address, listing.city, listing.state].filter(Boolean).join(', ')}</p></div><p className="shrink-0 text-xl font-bold text-violet-400">₦{Number(listing.price || 0).toLocaleString()}<span className="ml-1 text-[10px] font-normal text-[#686C7D]">/year</span></p></div></section>
          <section className="grid grid-cols-3 gap-2"><Fact label="Type" value={listing.sub_type ? listing.sub_type.replace(/_/g, ' ') : listing.property_type || 'Apartment'} /><Fact label="Bedrooms" value={listing.bedrooms || '—'} /><Fact label="Bathrooms" value={listing.bathrooms || '—'} /></section>
          {listing.description && <section className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4 sm:p-5"><h2 className="text-sm font-semibold">About this property</h2><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[#9599A8]">{listing.description}</p></section>}
          {listing.videos?.length > 0 && <section><h2 className="mb-3 text-sm font-semibold">Property videos</h2><div className="grid gap-3 sm:grid-cols-2">{listing.videos.map((url, index) => <video key={url} src={url} controls playsInline preload="metadata" className="aspect-video w-full rounded-2xl bg-black object-contain" aria-label={`Property video ${index + 1}`} />)}</div></section>}
          <section className="rounded-2xl border border-violet-500/12 bg-violet-500/[.035] p-4 sm:p-5"><h2 className="text-sm font-semibold">WeHouse property support</h2><p className="mt-1 text-[11px] leading-relaxed text-[#7C8191]">Questions, reservation help and inspection context stay linked to this property.</p><button onClick={() => support('property')} className="mt-4 h-11 w-full rounded-xl border border-violet-500/20 bg-violet-500/10 text-xs font-semibold text-violet-300">Message WeHouse Support</button></section>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          {hasOwnActiveReservation ? <ReservationPanel reservation={reservation} inspection={inspection} busy={busy} fee={reservationFee} onResume={() => void resumeCheckout()} onInspect={() => void requestInspection()} onRentPay={() => void payContractRent()} onMoveIn={() => setMoveInConfirm(true)} onSupport={() => support(reservation?.status === 'payment_pending' || reservation?.rent_payment_status === 'payment_pending' ? 'payment' : inspection ? 'inspection' : 'reservation')} /> : canStartReservation ? <section className="rounded-3xl border border-white/[.07] bg-[#11141C] p-5"><p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Available</p><h2 className="mt-2 text-lg font-bold">Reserve this property</h2><p className="mt-2 text-[11px] leading-relaxed text-[#777B8B]">Choose your tenure, then pay the reservation fee through Paystack. The database protects the checkout hold so another customer cannot reserve the same property at the same time.</p><div className="mt-3 flex items-center justify-between rounded-xl bg-white/[.035] p-3 text-xs"><span className="text-[#747889]">Reservation fee</span><span className="font-semibold">₦{reservationFee.toLocaleString()}</span></div><button onClick={() => setShowPlan(true)} className="mt-4 h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold">Choose tenure & reserve</button></section> : <section className="rounded-3xl border border-amber-500/15 bg-amber-500/[.04] p-5"><h2 className="text-sm font-semibold">{state.label}</h2><p className="mt-2 text-[11px] text-[#8A8E9D]">This property is not open for a new reservation right now.</p></section>}
        </aside>
      </div></main>
    </div>

    {showPlan && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 sm:items-center sm:p-4" onClick={() => !busy && setShowPlan(false)}><section className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/[.08] bg-[#11141C] p-5 text-white sm:rounded-3xl" onClick={event => event.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-violet-300">Housing reservation</p><h2 className="mt-1 text-lg font-bold">Choose your rental tenure</h2></div><button disabled={busy} onClick={() => setShowPlan(false)} className="text-[#777B8B]">×</button></div><div className="mt-5"><RentalPlanSelector annualRent={listing.price || 0} subType={listing.sub_type || 'long_stay'} securityDepositAmount={listing.security_deposit_amount} onSelectPlan={setPlan} /></div><button onClick={() => void openCheckout()} disabled={!plan || busy} className="mt-5 h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-40">{busy ? 'Opening secure checkout…' : `Continue to Paystack · ₦${reservationFee.toLocaleString()}`}</button><p className="mt-3 text-center text-[9px] leading-4 text-[#656A79]">The reservation fee holds the property. Contract rent is verified separately after inspection and before move-in.</p></section></div>}
    <ConfirmDialog isOpen={moveInConfirm} title="Confirm your move-in" description="Only confirm after you have received access and physically moved into the home. Your tenancy begins today." confirmLabel="Confirm move-in" variant="info" onCancel={()=>setMoveInConfirm(false)} onConfirm={()=>{setMoveInConfirm(false);void confirmMoveIn()}}/>
  </div>;
}
function Heart({filled}:{filled:boolean}){return <svg width="18" height="18" viewBox="0 0 24 24" fill={filled?'#A78BFA':'none'} stroke={filled?'#A78BFA':'white'} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>}

function ReservationPanel({ reservation, inspection, busy, fee, onResume, onInspect, onRentPay, onMoveIn, onSupport }: { reservation: any; inspection: any; busy: boolean; fee: number; onResume: () => void; onInspect: () => void; onRentPay: () => void; onMoveIn: () => void; onSupport: () => void }) {
  const status = String(reservation?.status || 'payment_pending');
  if (status === 'payment_pending') return <section className="rounded-3xl border border-amber-500/15 bg-[#11141C] p-5"><p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">Checkout pending</p><h2 className="mt-2 text-lg font-bold">Finish your reservation</h2><p className="mt-2 text-[11px] leading-relaxed text-[#777B8B]">This property is temporarily held while you complete the ₦{fee.toLocaleString()} reservation payment.</p>{reservation.payment_expires_at && <p className="mt-3 text-[10px] text-amber-300">Checkout hold ends · {new Date(reservation.payment_expires_at).toLocaleString()}</p>}<button disabled={busy} onClick={onResume} className="mt-4 h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold disabled:opacity-50">{busy ? 'Opening Paystack…' : 'Continue secure payment'}</button><button onClick={onSupport} className="mt-2 h-10 w-full text-xs text-violet-300">Payment help</button></section>;
  if (status === 'occupied') return <section className="rounded-3xl border border-violet-500/15 bg-[#11141C] p-5"><p className="text-[10px] font-semibold uppercase tracking-wide text-violet-300">Occupied</p><h2 className="mt-2 text-lg font-bold">Your tenancy is active</h2>{reservation.tenancy_start_date && <Row label="Started" value={new Date(reservation.tenancy_start_date).toLocaleDateString()} />}{reservation.tenancy_end_date && <Row label="Tenancy ends" value={new Date(reservation.tenancy_end_date).toLocaleDateString()} />}{reservation.move_out_grace_until && <Row label="Grace until" value={new Date(reservation.move_out_grace_until).toLocaleDateString()} />}{Number(reservation.installment_balance || 0) > 0 && <Row label="Installment balance" value={`₦${Number(reservation.installment_balance).toLocaleString()}`} />}<button onClick={onSupport} className="mt-4 h-11 w-full rounded-xl border border-white/[.08] text-xs font-semibold">Housing support</button></section>;
  if (status === 'ready_for_move_in') {
    const rentPaid = ['paid','upfront_paid'].includes(String(reservation.rent_payment_status || ''));
    if (!rentPaid) return <section className="rounded-3xl border border-emerald-500/15 bg-[#11141C] p-5"><p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Inspection passed</p><h2 className="mt-2 text-lg font-bold">Settle contract rent</h2><p className="mt-2 text-[11px] leading-relaxed text-[#777B8B]">Move-in cannot be activated until WeHouse verifies the required contract-rent payment.</p><div className="mt-3 rounded-xl bg-white/[.035] p-3"><Row label="Total contract" value={`₦${Number(reservation.contract_rent_total || 0).toLocaleString()}`} /><Row label="Required now" value={`₦${Number(reservation.upfront_rent_required || 0).toLocaleString()}`} />{Number(reservation.installment_balance || 0) > 0 && <Row label={`${reservation.installment_count || 4} installments later`} value={`₦${Number(reservation.installment_balance).toLocaleString()}`} />}</div><button disabled={busy} onClick={onRentPay} className="mt-4 h-12 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-[#03100B] disabled:opacity-50">{busy ? 'Opening Paystack…' : reservation.rent_payment_status === 'payment_pending' ? 'Continue contract-rent payment' : 'Pay required contract rent'}</button><button onClick={onSupport} className="mt-2 h-10 w-full text-xs text-violet-300">Payment support</button></section>;
    return <section className="rounded-3xl border border-emerald-500/15 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,.12),transparent_45%),#11141C] p-5"><p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Payment complete · home ready</p><h2 className="mt-2 text-xl font-bold">Welcome to your new home</h2><p className="mt-2 text-[11px] leading-relaxed text-[#8A918F]">Confirm only after you have received access and physically moved in. Your tenancy dates begin when you confirm.</p>{reservation.rent_paid_at && <Row label="Rent verified" value={new Date(reservation.rent_paid_at).toLocaleString()} />}<button disabled={busy} onClick={onMoveIn} className="mt-4 h-12 w-full rounded-2xl bg-emerald-500 text-sm font-semibold text-[#03100B] disabled:opacity-50">{busy?'Confirming…':'I have moved in'}</button><button onClick={onSupport} className="mt-2 h-11 w-full rounded-xl border border-white/[.08] text-xs font-semibold">Move-in support</button></section>;
  }
  return <section className="rounded-3xl border border-emerald-500/15 bg-[#11141C] p-5"><p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Reservation paid</p><h2 className="mt-2 text-lg font-bold">Property held for you</h2>{reservation.hold_expires_at && <p className="mt-2 text-[10px] text-amber-300">Current hold · until {new Date(reservation.hold_expires_at).toLocaleString()}</p>}<div className="mt-3 rounded-xl bg-white/[.035] p-3"><Row label="Tenure" value={`${reservation.rental_plan_years || 1} year${Number(reservation.rental_plan_years || 1) === 1 ? '' : 's'}`} /><Row label="Reservation fee" value={`₦${Number(reservation.amount || fee).toLocaleString()}`} /></div>{inspection ? <div className="mt-3 rounded-xl border border-violet-500/10 bg-violet-500/[.05] p-3 text-[10px] text-violet-300">Inspection · {String(inspection.status || 'pending').replace(/_/g, ' ')}</div> : <button disabled={busy} onClick={onInspect} className="mt-4 h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">{busy ? 'Requesting…' : 'Request property inspection'}</button>}<button onClick={onSupport} className="mt-2 h-10 w-full text-xs text-violet-300">Reservation support</button></section>;
}

function Fact({ label, value }: { label: string; value: string | number }) { return <div className="min-w-0 rounded-2xl border border-white/[.06] bg-[#11141C] p-3 text-center"><p className="truncate text-[9px] uppercase text-[#5E6272]">{label}</p><p className="mt-1 truncate text-xs font-semibold capitalize">{value}</p></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="mt-2 flex items-center justify-between gap-3 text-[10px]"><span className="text-[#707586]">{label}</span><span className="text-right font-semibold text-[#D5D8E0]">{value}</span></div>; }
