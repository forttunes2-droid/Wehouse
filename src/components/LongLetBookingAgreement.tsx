import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatRecordedMoney } from '@/lib/regional';
import { acceptLongLetAgreement,getLongLetBookingOffer,previewLongLetAgreement,rentTermLabel,type LongLetAgreement,type LongLetBookingOffer,type RentPaymentChoice } from '@/lib/longLetRentTerms';

type Props={reservationId:string;customerId:string;onSaved:()=>void;onCanPayChange:(ready:boolean)=>void};
export default function LongLetBookingAgreement(props:Props){
 return <Agreement key={`${props.customerId}:${props.reservationId}`} {...props}/>;
}
function Agreement({reservationId,customerId,onSaved,onCanPayChange}:Props){
 const [offer,setOffer]=useState<LongLetBookingOffer|null>(null),[quote,setQuote]=useState<LongLetAgreement|null>(null);
 const [months,setMonths]=useState(12),[choice,setChoice]=useState<RentPaymentChoice>('full'),[reviewed,setReviewed]=useState(false);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[attempt,setAttempt]=useState(0);
 const lock=useRef(false),generation=useRef(0);
 useEffect(()=>{
  const request=++generation.current;setLoading(true);setError('');setQuote(null);setReviewed(false);
  void getLongLetBookingOffer(reservationId,customerId).then(row=>{
   if(request!==generation.current)return;setOffer(row);setMonths(row.agreement?.rent_schedule.term_months??(row.accepted_terms_months.includes(12)?12:row.accepted_terms_months[0]));setChoice(row.agreement?.rent_schedule.payment_choice??'full');
  }).catch(cause=>{if(request===generation.current){setOffer(null);setError(message(cause));}}).finally(()=>{if(request===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[reservationId,customerId,attempt]);
 useEffect(()=>{
  const accepted=offer?.agreement;
  onCanPayChange(Boolean(accepted&&!loading&&!busy&&!error&&!quote&&months===accepted.rent_schedule.term_months&&choice===accepted.rent_schedule.payment_choice));
  return()=>onCanPayChange(false);
 },[offer?.agreement,loading,busy,error,quote,months,choice,onCanPayChange]);
 async function preview(){
  if(lock.current||!offer?.editable)return;lock.current=true;setBusy(true);setError('');setNotice('');setQuote(null);setReviewed(false);const request=generation.current;
  try{const row=await previewLongLetAgreement(reservationId,months,choice);if(request===generation.current)setQuote(row);}
  catch(cause){if(request===generation.current)setError(message(cause));}
  finally{lock.current=false;if(request===generation.current)setBusy(false);}
 }
 async function accept(){
  if(lock.current||!quote||!reviewed)return;lock.current=true;setBusy(true);setError('');const request=generation.current;
  try{const row=await acceptLongLetAgreement(quote,customerId);if(request===generation.current){setOffer(old=>old?{...old,agreement:row}:null);setQuote(null);setReviewed(false);setNotice('Rental agreement accepted. Review the amount below before starting payment.');onSaved();}}
  catch(cause){if(request===generation.current)setError(message(cause));}
  finally{lock.current=false;if(request===generation.current)setBusy(false);}
 }
 const shown=quote??offer?.agreement,monthlyAvailable=months>12&&offer?.monthly_accepted&&offer.monthly_ready;
 const change=()=>{setQuote(null);setReviewed(false);setNotice('');};
 return <section aria-label="Rental agreement" className="mt-4 space-y-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4">
  <div><h3 className="font-semibold">Rental agreement</h3><p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">Review the length of stay, total rent and amount required before handover. Your reservation fee is separate from rent.</p></div>
  {loading&&<p role="status" className="text-sm">Loading your rental terms…</p>}
  {error&&<div role="alert" className="text-sm"><p>{error}</p><Button type="button" variant="outline" disabled={busy||loading} onClick={()=>setAttempt(n=>n+1)}>Refresh agreement</Button></div>}
  {offer&&!loading&&<>
   {offer.editable&&<fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
    <label className="space-y-1 text-sm"><span>Length of stay</span><select aria-label="Length of stay" className="min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3" value={months} onChange={event=>{const term=Number(event.target.value);setMonths(term);if(term<=12)setChoice('full');change();}}>{offer.agreement&&!offer.accepted_terms_months.includes(offer.agreement.rent_schedule.term_months)&&<option value={offer.agreement.rent_schedule.term_months}>{rentTermLabel(offer.agreement.rent_schedule.term_months)} · accepted agreement</option>}{offer.accepted_terms_months.map(term=><option key={term} value={term}>{rentTermLabel(term)}</option>)}</select></label>
    {months>12&&(offer.monthly_accepted||offer.agreement?.rent_schedule.payment_choice==='monthly')?<label className="space-y-1 text-sm"><span>How you pay</span><select aria-label="How you pay rent" className="min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3" value={choice} onChange={event=>{setChoice(event.target.value as RentPaymentChoice);change();}}><option value="full">Pay the full contract</option><option value="monthly" disabled={!monthlyAvailable}>Year 1 in full; later years monthly{!monthlyAvailable?' · unavailable':''}</option></select></label>:<div className="space-y-1 text-sm"><p>Payment</p><p className="rounded-xl bg-[var(--wh-elevated)] p-3 font-medium">Pay the full term before handover</p></div>}
    {months>12&&offer.monthly_accepted&&!offer.monthly_ready&&<p className="text-sm leading-6 text-[var(--wh-text-secondary)] sm:col-span-2">Monthly checkout is not available for this property yet. Full contract payment remains available.</p>}
    <Button type="button" variant="outline" disabled={busy||choice==='monthly'&&!monthlyAvailable} onClick={()=>void preview()}>{busy?'Confirming agreement…':'Review selected agreement'}</Button>
   </fieldset>}
   {shown&&<RentAgreementSummary agreement={shown}/>}
   {quote&&<div className="space-y-3"><label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event=>setReviewed(event.target.checked)} className="mt-1 h-4 w-4 accent-violet-600"/>I have reviewed this term, total rent and payment schedule.{quote.rent_schedule.payment_choice==='monthly'&&' I accept that later-year monthly rent has no new Payment Protection hold and settles to the Partner after the disclosed WeHouse fee.'}</label><Button type="button" disabled={!reviewed||busy||Boolean(error)} onClick={()=>void accept()}>{busy?'Confirming acceptance…':'Accept rental agreement'}</Button></div>}
   {!quote&&offer.agreement&&<p className="text-sm font-medium text-[var(--wh-accent-text)]">This is your accepted agreement.</p>}
  </>}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
 </section>;
}
export function RentAgreementSummary({agreement}:{agreement:LongLetAgreement}){
 const q=agreement.rent_schedule,money=(amount:number)=>formatRecordedMoney(amount,agreement.currency);
 return <div className="space-y-3 rounded-xl bg-[var(--wh-elevated)] p-3"><div className="flex flex-wrap justify-between gap-2 text-sm font-semibold"><span>{rentTermLabel(q.term_months)}</span><span>{q.payment_choice==='full'?'Full payment':'Year 1 in full; later years monthly'}</span></div>
  <dl className="space-y-2 text-sm"><div className="flex justify-between gap-3"><dt>Total rent</dt><dd className="font-semibold">{money(q.contract_total)}</dd></div><div className="flex justify-between gap-3"><dt>Due before handover</dt><dd className="font-semibold">{money(q.due_before_handover)}</dd></div><div className="flex justify-between gap-3"><dt>Later scheduled rent</dt><dd>{money(q.future_balance)}</dd></div></dl>
  {q.payment_choice==='monthly'&&<details><summary className="min-h-10 cursor-pointer text-sm font-medium">View payment schedule</summary><p className="mb-2 text-sm leading-6 text-[var(--wh-text-secondary)]">Year 1 is paid in full. Later payments are advance rent for the next contract year, starting four months into the preceding year. Actual dates are set from verified handover. Automatic debit requires separate consent. Later-year monthly payments have no new Payment Protection hold. Each verified payment settles to the Partner after the disclosed WeHouse fee; your rent credit uses the full rent paid. One of eight equal payments funds 1½ months of the target year. Contact your Partner about any remaining balance or early exit; stopping payments does not automatically end the tenancy or create a refund.</p><ol className="divide-y divide-[var(--wh-border-subtle)]">{q.payments.map(p=><li key={p.sequence} className="flex justify-between gap-3 py-2 text-sm"><span>{p.due_before_handover?'Year 1 before handover':`Towards Year ${p.target_year} · ${p.month_offset} months after handover`}</span><span className="shrink-0 font-medium">{money(p.amount)}</span></li>)}</ol></details>}
 </div>;
}
function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'The rental agreement could not be confirmed. Refresh before paying.';}
