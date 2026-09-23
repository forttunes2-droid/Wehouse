import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import BackButton from '@/components/BackButton';
import {useDialogInteraction} from '@/hooks/useDialogInteraction';
import {useRecordScreenBack} from '@/hooks/useRecordScreenBack';
import {getSharedHousingGroup,initializeSharedHousingPayment,respondToSharedHousingInvite,startSharedHousingContractSplit,type SharedHousingGroup} from '@/lib/supabase/shared-housing';
import {sharedHousingLane} from '@/lib/sharedHousingPresentation';
import {withTimeout} from '@/lib/withTimeout';
import {displayDate,displayDateTime} from '@/lib/displayDate';
const money=(n:unknown)=>`₦${Number(n).toLocaleString('en-NG',{maximumFractionDigits:2})}`;
export default function SharedHousingDetails({groupId,userId,onBack,onChanged,onOpenListing,onOpenBooking}:{groupId:string;userId:string;onBack:()=>void;onChanged?:()=>void;onOpenListing?:(id:string)=>void;onOpenBooking?:(id:string)=>void}) {
  const [group, setGroup] = useState<SharedHousingGroup | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const generation = useRef(0), requestSequence = useRef(0), inFlight = useRef(false), reading = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const dismiss = useRecordScreenBack(onBack), ref = useDialogInteraction(dismiss);

  useEffect(() => {
    const actorGeneration = ++generation.current;
    setGroup(null); setError(''); setLoading(true); setBusy(false);
    inFlight.current = false; reading.current = false;
    async function refresh() {
      if (actorGeneration !== generation.current || inFlight.current || reading.current) return;
      const request = ++requestSequence.current;
      reading.current = true;
      try {
        const result = await withTimeout(getSharedHousingGroup(groupId), 15000, 'Shared payment took too long.');
        if (actorGeneration !== generation.current || request !== requestSequence.current) return;
        if (result.error || !result.group || !Array.isArray(result.group.members)
          || !result.group.members.some(member => member.user_id === userId)) {
          // Do not keep a previously authorised record visible after a real denial.
          setGroup(null);
          throw result.error || new Error('Shared payment is unavailable.');
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

  async function action(kind: 'accept' | 'decline' | 'pay' | 'rent') {
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
      const result = await withTimeout(kind === 'rent' ? startSharedHousingContractSplit(group.id)
        : respondToSharedHousingInvite(group.id, kind === 'accept'), 15000, 'The decision could not be confirmed. Refresh before retrying.');
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
  const ended=Boolean(group&&sharedHousingLane(group,userId)==='history');
  const allAccepted=Boolean(group?.members.length&&group.members.every(m=>m.invitation_status==='accepted'));
  const canPay=group&&!ended&&allAccepted&&mine?.invitation_status==='accepted'&&mine.payment_status!=='paid'&&['ready','payment_pending'].includes(group.status);
  return createPortal(<div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Shared payment" className="fixed inset-0 z-[100030] overflow-y-auto bg-[#090B10] text-white">
    <div className="mx-auto max-w-2xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
      <header className="sticky top-0 flex items-center gap-3 border-b border-white/10 bg-[#090B10] py-4"><BackButton onClick={dismiss} ariaLabel="Back from shared payment"/><h2 className="flex-1 text-lg font-semibold">Shared payment</h2><button type="button" disabled={busy || loading} onClick={() => refreshRef.current()} className="min-h-11 px-2 text-sm font-semibold text-violet-300">Refresh</button></header>
      {error&&<div role="alert" className="my-5 text-sm leading-6 text-amber-200"><p>{error}</p><button type="button" disabled={busy} onClick={()=>refreshRef.current()} className="min-h-11 font-semibold underline">Refresh shared payment</button></div>}
      {loading?<p role="status" className="py-8 text-sm">Loading shared payment…</p>:group&&<main className="space-y-5 py-5">
        <section><p className="text-sm font-medium text-violet-300">{short?'Short Let':'Long Let'} · Equal split</p><h3 className="mt-2 break-words text-xl font-semibold">{group.listing.title||'Shared home'}</h3>
          {short&&<p className="mt-2 text-sm leading-6 text-[#AAA3B3]">{displayDate(group.stay_check_in)} – {displayDate(group.stay_check_out)} · {group.guest_count} guests</p>}
          <p className="mt-3 text-sm leading-6 text-[#AAA3B3]">{ended?'This shared payment is no longer taking new payments. Any payment or refund review remains in its recorded history.':['refunding','refund_pending'].includes(group.status)?'The shared stay has ended. Recorded payments are awaiting refund review; no new payment is available.':group.status==='paid'?'All payment shares are confirmed. Arrival and handover still follow the reservation.':allAccepted?'Everyone has accepted. Each person pays their own share.':'Waiting for everyone to accept before payment opens. No one can accept or pay on another person’s behalf.'}</p>
          {!ended&&group.status!=='paid'&&<p className="mt-3 text-sm leading-6 text-amber-200">Checkout deadline: {displayDateTime(group.expires_at,'Africa/Lagos')} WAT. An invitation is not a confirmed stay.</p>}
        </section>
        <section className="divide-y divide-white/10 border-y border-white/10"><h4 className="py-4 text-base font-semibold">People and shares</h4>{group.members.map(member=><div key={member.user_id} className="py-4 text-sm leading-6">
          <div className="flex items-start justify-between gap-3"><strong className="break-words">{member.user_id===userId?'You':member.name}</strong><strong className="shrink-0">{money(member.share_amount)}</strong></div>
          {short&&<p className="mt-1 text-[#AAA3B3]">Stay {money(member.eligible_partner_share||0)} · Refundable deposit {Number(member.refundable_share)>0?money(member.refundable_share):'not required'}</p>}
          <p className="mt-2 text-[#AAA3B3]">{member.invitation_status==='accepted'?'Accepted':member.invitation_status==='declined'?'Declined':'Invitation pending'} · {member.payment_status==='paid'?'Paid':member.payment_status==='refunded'?'Refunded':'Not paid'}</p>
        </div>)}</section>
        {mine?.invitation_status==='invited'&&!ended&&!error&&<div className="grid grid-cols-2 gap-3"><button disabled={busy} type="button" onClick={()=>void action('decline')} className="min-h-12 rounded-xl border border-white/10 px-3 text-sm font-semibold">Decline</button><button disabled={busy} type="button" onClick={()=>void action('accept')} className="min-h-12 rounded-xl bg-violet-600 px-3 text-sm font-semibold">Accept my share</button></div>}
        {canPay&&!error&&<button disabled={busy} type="button" onClick={()=>void action('pay')} className="min-h-12 w-full rounded-xl bg-violet-600 px-3 text-sm font-semibold">{busy?'Checking payment…':`Pay my share · ${money(mine?.share_amount)}`}</button>}
        {!short&&group.payment_phase==='reservation_fee'&&group.status==='paid'&&group.created_by===userId&&!error&&<button disabled={busy} type="button" onClick={()=>void action('rent')} className="min-h-12 w-full rounded-xl bg-violet-600 px-3 text-sm font-semibold">Split contract rent equally</button>}
        {group.reservation_id&&group.created_by===userId&&onOpenBooking&&<button type="button" onClick={()=>onOpenBooking(group.reservation_id!)} className="min-h-11 w-full text-sm font-semibold text-violet-300">Open reservation</button>}
        {onOpenListing&&<button type="button" onClick={()=>onOpenListing(group.listing_id)} className="min-h-11 w-full text-sm font-semibold text-violet-300">View property</button>}
      </main>}
    </div>
  </div>,document.body);
}
