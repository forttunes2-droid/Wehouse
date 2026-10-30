import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {RentAgreementSummary} from '@/components/LongLetBookingAgreement';
import {rentTermLabel,type RentPaymentChoice} from '@/lib/longLetRentTerms';
import {getSharedRentOffer,previewSharedRent,startSharedRent,type SharedRentOffer,type SharedRentQuote} from '@/lib/sharedLongLetRent';
import {formatRecordedMoney} from '@/lib/regional';

type Props={groupId:string;userId:string;names:Record<string,string>;onStarted:()=>void};
export default function SharedLongLetRentAgreement(props:Props){return <Agreement key={props.userId+':'+props.groupId} {...props}/>;}
function Agreement({groupId,userId,names,onStarted}:Props){
 const [offer,setOffer]=useState<SharedRentOffer|null>(null),[quote,setQuote]=useState<SharedRentQuote|null>(null);
 const [months,setMonths]=useState(12),[choice,setChoice]=useState<RentPaymentChoice>('full'),[accepted,setAccepted]=useState(false);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const generation=useRef(0),lock=useRef(false);
 useEffect(()=>{const current=++generation.current;setLoading(true);setError('');setQuote(null);setAccepted(false);
  void getSharedRentOffer(groupId,userId).then(r=>{if(current===generation.current){setOffer(r);setMonths(r.accepted_terms_months.includes(12)?12:r.accepted_terms_months[0]);}})
   .catch(c=>{if(current===generation.current){setOffer(null);setError(message(c));}}).finally(()=>{if(current===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[groupId,userId,attempt]);
 async function action(task:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await task();}catch(c){setError(message(c));}finally{lock.current=false;setBusy(false);}}
 const change=()=>{setQuote(null);setAccepted(false);};
 const monthly=months>12&&offer?.monthly_accepted&&offer.monthly_ready;
 return <section aria-label="Shared rental agreement" className="space-y-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
  <header><h3 className="font-semibold">Agree on the shared rent</h3><p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">Choose an offered term, then review the total and each person's share. Everyone accepts their own agreement before rent payment opens. The reservation fee is separate.</p></header>
  {loading&&<p role="status" className="text-sm">Loading the offered rental terms…</p>}
  {error&&<div role="alert" className="text-sm leading-6"><p>{error}</p><Button type="button" variant="outline" disabled={busy||loading} onClick={()=>setAttempt(n=>n+1)}>Refresh shared rental terms</Button></div>}
  {offer?.editable&&!loading&&<><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
   <label className="space-y-1 text-sm"><span>Length of stay</span><select aria-label="Shared rental term" className="min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3" value={months} onChange={e=>{const term=Number(e.target.value);setMonths(term);if(term<=12)setChoice('full');change();}}>{offer.accepted_terms_months.map(term=><option key={term} value={term}>{rentTermLabel(term)}</option>)}</select></label>
   {months>12?<label className="space-y-1 text-sm"><span>How you pay</span><select aria-label="How you share rent payments" className="min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3" value={choice} onChange={e=>{setChoice(e.target.value as RentPaymentChoice);change();}}><option value="full">Pay the full term</option>{offer.monthly_accepted&&<option value="monthly" disabled={!monthly}>Year 1 in full; later years monthly{!monthly?' · unavailable':''}</option>}</select></label>:<p className="self-end rounded-xl bg-[var(--wh-elevated)] p-3 text-sm">The selected term is paid in full before handover.</p>}
   <Button type="button" variant="outline" disabled={busy||choice==='monthly'&&!monthly} onClick={()=>void action(async()=>{const current=generation.current;const q=await previewSharedRent(offer,months,choice);if(current===generation.current){setQuote(q);setAccepted(false);}})}>Review rent and participant shares</Button>
  </fieldset>
  {quote&&<><RentAgreementSummary agreement={quote.agreement}/><section aria-label="Participant rent shares" className="divide-y divide-[var(--wh-border-subtle)]"><h4 className="py-3 font-semibold">Each person's rent</h4>{quote.payer_agreements.map(p=><div key={p.payer_user_id} className="space-y-1 py-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{p.payer_user_id===userId?'You':names[p.payer_user_id]||'Participant'}</strong><span>{formatRecordedMoney(p.rent_schedule.due_before_handover,p.currency)} before handover</span></div><p className="text-[var(--wh-text-secondary)]">Total accepted share: {formatRecordedMoney(p.rent_schedule.contract_total,p.currency)}{p.rent_schedule.future_balance>0?` · Later-year scheduled rent: ${formatRecordedMoney(p.rent_schedule.future_balance,p.currency)}`:''}</p></div>)}</section>
   {choice==='monthly'&&<p className="text-sm leading-6 text-[var(--wh-text-secondary)]">Each person pays their own later-year share and chooses manual payment or separate automatic-debit consent. A missed contribution is recorded against that payer; it does not silently charge the others or cancel the current paid year.</p>}
   <label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)} className="mt-1 h-5 w-5 shrink-0"/>I accept this rental term and my recorded share.{choice==='monthly'&&' Later-year contributions fund the next contract year and settle to the Partner after the disclosed fee, without a new protection hold.'}</label>
   <Button type="button" disabled={!accepted||busy||Boolean(error)} onClick={()=>void action(async()=>{const current=generation.current;await startSharedRent(quote,userId);if(current===generation.current)onStarted();})}>{busy?'Confirming agreement…':'Accept my share and invite the others'}</Button>
  </>}
  </>}
  {offer&&!offer.editable&&!loading&&!error&&<p className="text-sm leading-6 text-[var(--wh-text-secondary)]">The shared booking already has a recorded agreement or is not ready for rent selection. Refresh the booking to see its current state.</p>}
 </section>;
}
function message(c:unknown){return c instanceof Error?c.message:(c as {message?:string})?.message||'Shared rental terms could not be confirmed. Refresh before retrying.';}
