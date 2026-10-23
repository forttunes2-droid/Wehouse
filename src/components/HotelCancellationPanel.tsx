import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {updateBookingStatus} from '@/lib/supabase/hotels';
import {withTimeout} from '@/lib/withTimeout';
import {hotelCancellationPreview,type HotelCancellationPreview} from '@/lib/hotelCancellation';

export default function HotelCancellationPanel({bookingId,onChanged,onReview}:{bookingId:number;onChanged:()=>void|Promise<void>;onReview:()=>void}){
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[submitting,setSubmitting]=useState(false),[error,setError]=useState('');
 const [preview,setPreview]=useState<HotelCancellationPreview|null>(null);
 const generation=useRef(0),actionActive=useRef(false);
 useEffect(()=>()=>{generation.current++;},[]);
 async function load(){
  const request=++generation.current;setLoading(true);setError('');setPreview(null);
  try{
   const result=await withTimeout(supabase.rpc('get_my_hotel_cancellation_preview',{p_booking_id:bookingId}),15000,'Cancellation details took too long. Try again.');
   if(result.error)throw result.error;
   const quote=hotelCancellationPreview(result.data,bookingId);
   if(request!==generation.current)return null;
   setPreview(quote);return quote;
  }catch(reason){if(request===generation.current)setError(reason instanceof Error?reason.message:'Cancellation details could not be loaded. Try again.');return null;}
  finally{if(request===generation.current)setLoading(false);}
 }
 async function confirm(){
  if(actionActive.current||!preview?.can_cancel)return;
  actionActive.current=true;setSubmitting(true);setError('');const request=generation.current;
  let accepted=false;
  try{
   const result=await withTimeout(updateBookingStatus(bookingId,'cancelled'),15000,'Cancellation could not be confirmed. Refresh its status before retrying.');
   if(result.error)throw result.error;
   accepted=true;
  }catch{if(request===generation.current)setError('Cancellation could not be confirmed. Checking the current booking before you retry.');}
  if(request===generation.current){
   const refreshRequest=generation.current+1;
   const current=await load();
   if(refreshRequest!==generation.current){actionActive.current=false;return;}
   let changed=false;
   if(current?.kind==='already_cancelled'){changed=true;}
   else if(accepted){setError('Cancellation was accepted, but its latest status could not be loaded. Refresh status.');changed=true;}
   else if(current){setError('Cancellation was not confirmed. The current details are shown below; review them before retrying.');}
   if(changed){try{await onChanged();}catch{if(refreshRequest===generation.current)setError('Cancellation is confirmed. The booking page could not be refreshed; refresh its current status.');}}
   if(refreshRequest===generation.current)setSubmitting(false);
  }
  actionActive.current=false;
 }
 const money=(value:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'NGN'}).format(value);
 if(!open)return <button type="button" onClick={()=>{setOpen(true);void load();}} className="mt-3 min-h-11 w-full rounded-xl border border-[var(--wh-border)] px-3 text-sm font-semibold">Review cancellation</button>;
 return <section aria-label="Hotel cancellation" aria-busy={loading||submitting} className="mt-4 space-y-3 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 text-sm text-[var(--wh-text)]">
  <h3 className="font-semibold">Review cancellation</h3>
  {loading&&<p role="status">Checking your saved terms and payment…</p>}
  {error&&<p role="alert" className="leading-6">{error}</p>}
  {preview&&<>
   <p className="leading-6">{preview.message}</p>
   {preview.kind==='full_refund'&&<>
    <dl className="space-y-2"><div className="flex flex-wrap justify-between gap-2"><dt>Refund to original payment method</dt><dd className="font-semibold">{money(preview.refund_amount_ngn!)}</dd></div><div className="flex justify-between gap-2"><dt>Cancellation deduction</dt><dd>{money(preview.fee_ngn!)}</dd></div></dl>
    <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">Cancel by {new Date(preview.deadline!).toLocaleString(undefined,{timeZone:preview.timezone})} ({preview.timezone}). Eligibility is checked again when you confirm.</p>
    <p className="text-xs leading-5 text-[var(--wh-text-secondary)]">The stay is cancelled immediately after confirmation. The refund is complete only when the payment provider confirms it; your bank may take additional time.</p>
   </>}
   {preview.kind==='already_cancelled'&&<p role="status" className="leading-6">{preview.refund_status==='completed'?'The payment provider has confirmed the refund. Your bank may take additional time.':preview.refund_status==='manual_review'||preview.refund_status==='failed'||preview.refund_status==='provider_attention'?'The refund needs Finance review. Contact WeHouse for the next step.':preview.refund_status?'The refund is requested; provider confirmation is pending.':'No confirmed refund status is available. Contact WeHouse if you paid for this stay.'}</p>}
   {preview.can_cancel&&<button type="button" disabled={submitting||loading} onClick={()=>void confirm()} className="min-h-11 w-full rounded-xl bg-violet-600 px-4 font-semibold text-white disabled:opacity-50">{submitting?'Confirming cancellation…':preview.kind==='full_refund'?'Cancel stay and request refund':'Cancel unpaid booking'}</button>}
   {!preview.can_cancel&&<button type="button" disabled={submitting||loading} onClick={onReview} className="min-h-11 w-full rounded-xl border border-[var(--wh-border)] px-4 font-semibold">Contact WeHouse</button>}
  </>}
  {error&&<button type="button" disabled={submitting||loading} onClick={()=>void load()} className="min-h-11 rounded-xl border border-[var(--wh-border)] px-4 font-semibold">Refresh cancellation status</button>}
 </section>;
}
