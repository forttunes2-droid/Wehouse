import {useState} from 'react';
import {createPortal} from 'react-dom';
import BackButton from '@/components/BackButton';
import HotelCancellationPanel from '@/components/HotelCancellationPanel';
import ReceiptAccess from '@/components/PaymentReceipt';
import StayArrivalInstructions from '@/components/StayArrivalInstructions';
import HotelPresenceCode from '@/components/HotelPresenceCode';
import type {SharedHousingGroup} from '@/lib/supabase/shared-housing';
import {formatRecordedMoney} from '@/lib/regional';
import {displayDate,displayDateTimeAtProperty} from '@/lib/displayDate';
import {useDialogInteraction} from '@/hooks/useDialogInteraction';

export default function SharedHotelDetails({group,userId,busy,error,onBack,onRefresh,onAction,onOpenHotel,onOpenBooking}:{
 group:SharedHousingGroup;userId:string;busy:boolean;error:string;onBack:()=>void;onRefresh:()=>void;
 onAction:(action:'accept'|'decline'|'pay')=>Promise<void>;onOpenHotel?:(id:number)=>void;onOpenBooking?:(id:number)=>void;
}){
 const root=useDialogInteraction(onBack),[accepted,setAccepted]=useState(false);
 const mine=group.members.find(member=>member.user_id===userId),organiser=group.created_by===userId;
 const terms=group.cancellation_snapshot!,arrival=group.hotel_arrival,expired=Date.parse(group.expires_at)<=Date.now();
 const canAccept=mine?.invitation_status==='invited'&&group.status==='inviting'&&!expired;
 const canPay=mine?.invitation_status==='accepted'&&mine.payment_status!=='paid'&&group.status==='payment_pending'&&!expired;
 const money=(value:unknown)=>formatRecordedMoney(value,'NGN');
 function help(){window.dispatchEvent(new CustomEvent('openSupportChat',{detail:{subject:'Shared Hotel booking',category:'payment_issue',contextType:'contextual_help',contextId:group.canonical_group_id||group.id,
  contextSnapshot:{reason_code:'payment_issue',subject_type:'shared_payment',source_type:'shared_payment',source_id:group.canonical_group_id||group.id,linked_label:group.listing.title,requester_workspace:'personal'}}}));}
 return createPortal(<div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Shared Hotel booking" className="fixed inset-0 z-[100030] overflow-y-auto bg-[var(--wh-bg)] text-[var(--wh-text)]">
  <div className="mx-auto max-w-2xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
   <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--wh-border-subtle)] bg-[var(--wh-bg)]/95 py-4 backdrop-blur-xl"><BackButton onClick={onBack}/><h1 className="flex-1 text-lg font-semibold">Shared Hotel booking</h1><button type="button" disabled={busy} onClick={onRefresh} className="min-h-11 px-2 text-sm font-semibold text-[var(--wh-accent-text)]">Refresh</button></header>
   <main className="space-y-6 py-5">
    {error&&<p role="alert" className="rounded-xl border border-[var(--wh-border)] p-4 text-sm leading-6">{error}</p>}
    <section className="overflow-hidden rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]">
     {group.listing.image&&<img src={group.listing.image} alt="" className="aspect-[16/7] w-full object-cover"/>}
     <div className="space-y-3 p-4"><p className="text-xs font-medium text-[var(--wh-accent-text)]">Hotel · Shared costs</p><h2 className="text-xl font-semibold">{group.listing.title}</h2>
      <p className="text-sm text-[var(--wh-text-secondary)]">{displayDate(group.stay_check_in)} – {displayDate(group.stay_check_out)} · {group.guest_count} guests</p>
      <div className="flex items-center justify-between gap-3 border-t border-[var(--wh-border-subtle)] pt-3 text-sm"><span>Your assigned share</span><strong>{money(mine?.share_amount)}</strong></div>
      <p role="status" className="text-sm leading-6 text-[var(--wh-text-secondary)]">{group.status==='paid'?'All shares are verified. Your room booking is confirmed.':group.status==='refunding'?'This checkout has ended. Refunds to the original payers are processing.':group.status==='refunded'?'The provider has confirmed the received shares were refunded. Your bank may take additional time.':['cancelled','expired'].includes(group.status)?'This shared booking is no longer accepting payment.':expired?'The room hold has expired. Refresh to check any recorded payment or refund.':'Every paying guest must accept and pay before the original room hold expires.'}</p>
     </div>
    </section>
    <section className="space-y-3 text-sm leading-6"><h2 className="font-semibold">Saved booking terms</h2>
     <p>{terms.refundable?`Full refund for eligible cancellation by ${displayDateTimeAtProperty(terms.deadline!,terms.timezone)} (${terms.timezone}).`:'This rate is non-refundable for ordinary cancellation. Payment or stay problems can still be sent to WeHouse for review.'}</p>
     <p className="text-[var(--wh-text-secondary)]">You are joining this stay. The organiser manages the whole room booking and its cancellation. Each person pays only their assigned share and receives their own receipt. Any eligible refund returns to the original payer.</p>
     {!['paid','refunded','cancelled','expired'].includes(group.status)&&<p className="text-[var(--wh-text-secondary)]">Payment deadline: {displayDateTimeAtProperty(group.expires_at,terms.timezone)} ({terms.timezone}). Joining later does not extend the hold.</p>}
    </section>
    <section className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]"><h2 className="py-4 font-semibold">Paying guests</h2>{group.members.map(member=><div key={member.user_id} className="py-4 text-sm leading-6"><div className="flex items-start justify-between gap-3"><strong className="break-words">{member.user_id===userId?'You':member.name}</strong><span className="shrink-0">{money(member.share_amount)}</span></div><p className="mt-1 text-[var(--wh-text-secondary)]">{member.invitation_status==='accepted'?'Accepted':member.invitation_status==='declined'?'Declined':'Invitation pending'} · {member.payment_status==='paid'?'Paid':member.payment_status==='refunded'?'Refunded':'Awaiting payment'}</p></div>)}</section>
    {canAccept&&!error&&<div className="space-y-4"><label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={accepted} disabled={busy} onChange={event=>setAccepted(event.target.checked)} className="mt-1 h-5 w-5 shrink-0"/>I’m joining this stay and have reviewed my share, dates and saved cancellation terms.</label><div className="grid grid-cols-2 gap-3"><button type="button" disabled={busy} onClick={()=>void onAction('decline')} className="min-h-12 rounded-xl border border-[var(--wh-border)] px-3 text-sm font-semibold">Decline</button><button type="button" disabled={busy||!accepted} onClick={()=>void onAction('accept')} className="min-h-12 rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white disabled:opacity-40">Accept my share</button></div></div>}
    {canPay&&!error&&<button type="button" disabled={busy} onClick={()=>void onAction('pay')} className="min-h-12 w-full rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy?'Checking payment…':`Complete my payment · ${money(mine?.share_amount)}`}</button>}
    {mine?.refund_status&&<p role="status" className="text-sm leading-6">Your refund: {mine.refund_status==='completed'?'Provider processed':mine.refund_status==='pending'?'Requested':mine.refund_status==='provider_pending'||mine.refund_status==='processing'?'Processing':'Needs Finance review'}.</p>}
    {mine?.payment_reference&&['paid','refunded'].includes(mine.payment_status)&&<ReceiptAccess subjectType="hotel" subjectId={String(group.hotel_booking_id)}/>}
    {arrival&&<section className="space-y-3 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 text-sm leading-6"><h2 className="font-semibold">Your confirmed stay</h2><p>Booking reference <strong className="break-all">{arrival.booking_code}</strong></p>{arrival.address&&<p className="whitespace-pre-wrap">{arrival.address}</p>}<p className="text-[var(--wh-text-secondary)]">The organiser presents the separate arrival code at reception for this room booking.</p>{organiser&&['confirmed','checked_in'].includes(group.booking_status||'')&&<HotelPresenceCode bookingId={group.hotel_booking_id!} status={group.booking_status as 'confirmed'|'checked_in'}/>}<StayArrivalInstructions kind="hotel" bookingId={String(group.hotel_booking_id)}/></section>}
    {organiser&&group.status==='paid'&&<HotelCancellationPanel bookingId={group.hotel_booking_id!} onChanged={onRefresh} onReview={help}/>}
    {organiser&&['inviting','payment_pending'].includes(group.status)&&<HotelCancellationPanel bookingId={group.hotel_booking_id!} onChanged={onRefresh} onReview={help}/>}
    {organiser&&onOpenBooking&&<button type="button" onClick={()=>onOpenBooking(group.hotel_booking_id!)} className="min-h-11 w-full text-sm font-semibold text-[var(--wh-accent-text)]">Open room booking</button>}
    {onOpenHotel&&<button type="button" onClick={()=>onOpenHotel(group.hotel_id!)} className="min-h-11 w-full text-sm font-semibold text-[var(--wh-accent-text)]">View hotel</button>}
    <button type="button" onClick={help} className="min-h-11 w-full text-sm font-semibold text-[var(--wh-accent-text)]">Get help with this shared booking</button>
   </main>
  </div>
 </div>,document.body);
}
