import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import BackButton from '@/components/BackButton';
import {useDialogInteraction} from '@/hooks/useDialogInteraction';
import {useRecordScreenBack} from '@/hooks/useRecordScreenBack';
import {getSharedHousingGroup,initializeSharedHousingPayment,respondToSharedHousingInvite,type SharedHousingGroup} from '@/lib/supabase/shared-housing';
import SharedLongLetRentAgreement from '@/components/SharedLongLetRentAgreement';
import SharedHotelDetails from '@/components/SharedHotelDetails';
import {RentAgreementSummary} from '@/components/LongLetBookingAgreement';
import LaterRentHistory from '@/components/LaterRentHistory';
import StayArrivalInstructions from '@/components/StayArrivalInstructions';
import {sharedHousingLane} from '@/lib/sharedHousingPresentation';
import {withTimeout} from '@/lib/withTimeout';
import {displayDate,displayMoment} from '@/lib/displayDate';
import { formatMoney } from "@/lib/regional";
// Shared checkout currently supports NGN only. Changing presentation region
// must never relabel an existing NGN obligation as another currency.
const money=(n:unknown)=>formatMoney(Number(n),{currency:'NGN'});
export default function SharedHousingDetails({groupId,userId,onBack,onChanged,onOpenListing,onOpenBooking,onRentHelp,onOpenHotel,onOpenHotelBooking}:{groupId:string;userId:string;onBack:()=>void;onChanged?:()=>void;onOpenListing?:(id:string)=>void;onOpenBooking?:(id:string)=>void;onRentHelp?:(reservationId:string)=>void;onOpenHotel?:(id:number)=>void;onOpenHotelBooking?:(id:number)=>void}) {
  const [group, setGroup] = useState<SharedHousingGroup | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [reviewedRent,setReviewedRent]=useState(false);
  const generation = useRef(0), requestSequence = useRef(0), inFlight = useRef(false), reading = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const dismiss = useRecordScreenBack(onBack), ref = useDialogInteraction(dismiss,group?.product_type!=='hotel');

  useEffect(() => {
    const actorGeneration = ++generation.current;
    setGroup(null); setError(''); setLoading(true); setBusy(false);
    inFlight.current = false; reading.current = false;
    async function refresh() {
      if (actorGeneration !== generation.current || inFlight.current || reading.current) return;
      const request = ++requestSequence.current;
      reading.current = true;
      try {
        const result = await withTimeout(getSharedHousingGroup(groupId,userId), 15000, 'shared reservation took too long.');
        if (actorGeneration !== generation.current || request !== requestSequence.current) return;
        if (result.error || !result.group || result.group.id!==groupId || !Array.isArray(result.group.members)
          || !result.group.members.some(member => member.user_id === userId)) {
          // Do not keep a previously authorised record visible after a real denial.
          setGroup(null);
          throw result.error || new Error('shared reservation is unavailable.');
        }
        setGroup(result.group); setError('');
      } catch {
        if (actorGeneration === generation.current && request === requestSequence.current)
          setError('This shared payment could not be refreshed. Refresh before accepting or paying.');
      } finally {
        if (actorGeneration === generation.current && request === requestSequence.current) {
          reading.current = false; setLoading(false);
        }
      }
    }
    refreshRef.current = () => void refresh();
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const timer = window.setInterval(visibleRefresh, 15000);
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      generation.current += 1; requestSequence.current += 1;
      window.clearInterval(timer); window.removeEventListener('focus', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [groupId, userId]);

  useEffect(()=>setReviewedRent(false),[group?.rent_agreement?.quote_digest,group?.checkout_attempt]);
  async function action(kind: 'accept' | 'decline' | 'pay') {
    if (!group || inFlight.current || error) return;
    inFlight.current = true; setBusy(true); setError('');
    // A pre-action poll must never overwrite the acknowledged decision.
    requestSequence.current += 1; reading.current = false;
    const current = generation.current;
    let refreshAfter = false;
    try {
      if (kind === 'pay') {
        const outcome = await withTimeout(initializeSharedHousingPayment(group.id), 20000, 'Checkout could not be confirmed. Refresh before retrying.');
        if (outcome.error) throw outcome.error;
        if (current !== generation.current) return;
        if (outcome.result?.already_paid) { refreshAfter = true; onChanged?.(); return; }
        if (!outcome.result?.authorization_url) throw new Error(outcome.result?.error || 'Checkout could not open.');
        window.location.assign(outcome.result.authorization_url); return;
      }
      const sharedRent=group.product_type==='long_let'&&group.payment_phase==='contract_rent';
      if(sharedRent&&(!group.rent_agreement||!Number.isSafeInteger(group.checkout_attempt)||kind==='accept'&&!reviewedRent))throw Error('Review your current rental agreement before accepting.');
      const result = await withTimeout(respondToSharedHousingInvite(group.id,kind==='accept',sharedRent?{
        quote_digest:group.rent_agreement!.quote_digest,checkout_attempt:group.checkout_attempt!,
      }:undefined),15000,'The decision could not be confirmed. Refresh before retrying.');
      if (result.error) throw result.error;
      if (current === generation.current) { refreshAfter = true; onChanged?.(); }
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message
        : String((failure as { message?: string })?.message || 'Could not confirm the change. Refresh before retrying.'));
    } finally {
      if (current === generation.current) {
        inFlight.current = false; setBusy(false);
        if (refreshAfter) refreshRef.current();
      }
    }
  }
  const mine=group?.members.find(m=>m.user_id===userId),short=group?.product_type==='short_let';
  const rentPhase=group?.product_type==='long_let'&&group.payment_phase==='contract_rent';
  const feePaid=group?.product_type==='long_let'&&group.payment_phase==='reservation_fee'&&group.status==='paid';
  const hasLaterHistory=Boolean(!short&&group?.rent_agreement?.rent_schedule.payment_choice==='monthly'&&group.reservation_id&&['occupied','completed'].includes(group.booking_status||''));
  const ended=Boolean(group&&sharedHousingLane(group,userId)==='history');
  const allAccepted=Boolean(group?.members.length&&group.members.every(m=>m.invitation_status==='accepted'));
  const canPay=group&&!ended&&allAccepted&&mine?.invitation_status==='accepted'&&mine.payment_status!=='paid'&&['ready','payment_pending'].includes(group.status)&&(!rentPhase||group.rent_agreement?.accepted_by===userId);
  const statusMessage=ended?'This shared reservation is no longer accepting new participants. Any payment or refund review remains in its recorded history.'
    :['refunding','refund_pending'].includes(group?.status||'')?'This shared checkout has ended. Recorded payments are awaiting refund processing; no new payment is available.'
    :feePaid?'The reservation fee is paid. Rent is still separate and must be agreed and paid before handover.'
    :group?.status==='paid'?'All required upfront shares are confirmed. Arrival and handover still follow the reservation.'
    :allAccepted?'Everyone has accepted. Each person completes their own recorded payment.'
    :rentPhase?'Waiting for each person to review and accept their rental agreement and share.':'Waiting for everyone to accept before participant payments open.';
  function rentHelp(){
    if(!group)return;
    if(onRentHelp&&group.reservation_id){onRentHelp(group.reservation_id);return;}
    const id=group.canonical_group_id||group.id;
    window.dispatchEvent(new CustomEvent('openSupportChat',{detail:{subject:short?'Shared stay booking':'Shared rent payment or early exit',category:'payment_issue',contextType:'contextual_help',contextId:id,
      contextSnapshot:{reason_code:'payment_issue',subject_type:'shared_payment',source_type:'shared_payment',source_id:id,linked_label:group.listing.title,requester_workspace:'personal'}}}));
  }
  if(group?.product_type==='hotel')return <SharedHotelDetails key={`${userId}:${group.id}`} group={group} userId={userId} busy={busy} error={error} onBack={dismiss} onRefresh={()=>refreshRef.current()} onAction={action} onOpenHotel={onOpenHotel} onOpenBooking={onOpenHotelBooking}/>;
  return createPortal(<div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={short?"Shared stay":"Shared home"} className="fixed inset-0 z-[100030] overflow-y-auto bg-[var(--wh-bg)] text-[var(--wh-text)]">
    <div className="mx-auto max-w-2xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
      <header className="sticky top-0 flex items-center gap-3 border-b border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]/95 py-4 shadow-[var(--wh-shadow-sm)] backdrop-blur-xl"><BackButton onClick={dismiss} ariaLabel={short?"Back from shared stay":"Back from shared home"}/><h2 className="flex-1 text-lg font-semibold">{short?"Shared stay":"Shared home"}</h2><button type="button" disabled={busy || loading} onClick={() => refreshRef.current()} className="min-h-11 px-2 text-sm font-semibold text-[var(--wh-accent-text)]">Refresh</button></header>
      {error&&<div role="alert" className="my-5 text-sm leading-6 text-[var(--wh-text)]"><p>{error}</p><button type="button" disabled={busy} onClick={()=>refreshRef.current()} className="min-h-11 font-semibold underline">Refresh shared reservation</button></div>}
      {loading?<WeHouseLoadingState compact label="Loading shared reservation" />:group&&<main className="space-y-5 py-5">
        <section><p className="text-sm font-medium text-[var(--wh-accent-text)]">{short?'Short Let · Shared stay':'Long Let · Shared home'}</p><h3 className="mt-2 break-words text-xl font-semibold">{group.listing.title||'Shared home'}</h3>
          {short&&<p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">{displayDate(group.stay_check_in)} – {displayDate(group.stay_check_out)} · {group.guest_count} guests</p>}
          <p className="mt-3 text-sm leading-6 text-[var(--wh-text-secondary)]">{statusMessage}</p>
          {!ended&&group.status!=='paid'&&<p className="mt-3 text-sm leading-6 text-[var(--wh-text)]">Shared payment deadline: {displayMoment(group.expires_at)}. Everyone must accept and complete their assigned payment before this deadline. Accepting later does not extend it. An invitation is not a confirmed reservation.</p>}
          {!ended&&group.status!=='paid'&&<p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">If the group expires before every payment is verified, recorded payments go through refund processing to the original payment method. A pending refund is not yet a completed refund.</p>}
        </section>
        <section className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]"><h4 className="py-4 text-base font-semibold">Participants</h4>{group.members.map(member=><div key={member.user_id} className="py-4 text-sm leading-6">
          <div className="flex items-start justify-between gap-3"><strong className="break-words">{member.user_id===userId?'You':member.name}</strong><strong className="shrink-0">{money(member.share_amount)}</strong></div>
          {short&&<p className="mt-1 text-[var(--wh-text-secondary)]">Stay {money(member.eligible_partner_share||0)} · Caution fee {Number(member.refundable_share)>0?money(member.refundable_share):'not required'}</p>}
          <p className="mt-2 text-[var(--wh-text-secondary)]">{member.invitation_status==='accepted'?'Accepted':member.invitation_status==='declined'?'Declined':'Invitation pending'} · {member.payment_status==='paid'?'Paid':member.payment_status==='refunded'?'Refunded':'Not paid'}</p>
        </div>)}</section>
        {group.rent_agreement&&<section aria-label="Your shared rental terms" className="space-y-3"><h4 className="font-semibold">Your rent share</h4><RentAgreementSummary agreement={group.rent_agreement}/><p className="text-sm leading-6 text-[var(--wh-text-secondary)]">These amounts are your accepted share of one tenancy. Your payments do not silently cover another person's missed contribution.</p></section>}
        {rentPhase&&mine?.invitation_status==='invited'&&!ended&&<label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={reviewedRent} disabled={busy||!group.rent_agreement} onChange={e=>setReviewedRent(e.target.checked)} className="mt-1 h-5 w-5 shrink-0"/>I have reviewed this rental term and my share.{group.rent_agreement?.rent_schedule.payment_choice==='monthly'&&' Later-year contributions fund the next year, with no new protection hold. Manual payment and automatic-debit consent are individual.'}</label>}
        {mine?.invitation_status==='invited'&&!ended&&!error&&<div className="grid grid-cols-2 gap-3"><button disabled={busy} type="button" onClick={()=>void action('decline')} className="min-h-12 rounded-xl border border-[var(--wh-border-subtle)] px-3 text-sm font-semibold">Decline</button><button disabled={busy||Boolean(rentPhase&&!reviewedRent)} type="button" onClick={()=>void action('accept')} className="min-h-12 rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white disabled:opacity-50">Accept my share</button></div>}
        {canPay&&!error&&<button disabled={busy} type="button" onClick={()=>void action('pay')} className="min-h-12 w-full rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy?'Checking payment…':`Complete my payment · ${money(mine?.share_amount)}`}</button>}
        {feePaid&&group.created_by===userId&&!error&&<SharedLongLetRentAgreement groupId={group.id} userId={userId} names={Object.fromEntries(group.members.map(m=>[m.user_id,m.name]))} onStarted={()=>{refreshRef.current();onChanged?.();}}/>}
        {group.arrival&&!error&&<section aria-label="Shared booking arrival" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-sm leading-6">
          <h4 className="font-semibold">Your confirmed home</h4><p className="mt-2">Booking code <strong className="break-all">{group.arrival.booking_code}</strong></p>
          {group.arrival.address&&<p className="mt-2 whitespace-pre-wrap break-words">{group.arrival.address}</p>}
          {group.arrival.requested_move_in_at&&<p className="mt-2 text-[var(--wh-text-secondary)]">Requested arrival: {displayMoment(group.arrival.requested_move_in_at)}</p>}
          {group.arrival.tenancy_start_date?<p className="mt-2 text-[var(--wh-text-secondary)]">Tenancy: {displayDate(group.arrival.tenancy_start_date)} – {displayDate(group.arrival.tenancy_end_date)}</p>:!short&&<p className="mt-2 text-[var(--wh-text-secondary)]">The booking organiser requests your move-in time. The responsible host or WeHouse confirms handover before the tenancy starts.</p>}
          <StayArrivalInstructions kind="home" bookingId={group.reservation_id!}/>
        </section>}
        {hasLaterHistory&&<LaterRentHistory reservationId={group.reservation_id!} userId={userId} onDiscuss={rentHelp}/>}
        {group.reservation_id&&group.created_by===userId&&onOpenBooking&&<button type="button" onClick={()=>onOpenBooking(group.reservation_id!)} className="min-h-11 w-full text-sm font-semibold text-[var(--wh-accent-text)]">Open reservation</button>}
        {!hasLaterHistory&&<button type="button" onClick={rentHelp} className="min-h-11 w-full text-sm font-semibold text-[var(--wh-accent-text)]">Get help with this shared booking</button>}
        {onOpenListing&&group.listing_id&&<button type="button" onClick={()=>onOpenListing(group.listing_id!)} className="min-h-11 w-full text-sm font-semibold text-[var(--wh-accent-text)]">View property</button>}
      </main>}
    </div>
  </div>,document.body);
}

