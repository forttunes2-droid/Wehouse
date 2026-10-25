import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getLongLetRentTerms, LONG_LET_TERMS, rentTermLabel, saveLongLetRentTerms, type LongLetRentTerms } from '@/lib/longLetRentTerms';

export default function LongLetRentTermsPanel({listingId}:{listingId:string}) {
 return <RentTerms key={listingId} listingId={listingId}/>;
}
function RentTerms({listingId}:{listingId:string}) {
 const [saved,setSaved]=useState<LongLetRentTerms|null>(null),[terms,setTerms]=useState<number[]>([]),[monthly,setMonthly]=useState(false);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[attempt,setAttempt]=useState(0);
 const generation=useRef(0),lock=useRef(false);
 useEffect(()=>{
  const request=++generation.current;setLoading(true);setError('');setNotice('');
  void getLongLetRentTerms(listingId).then(row=>{
   if(request!==generation.current)return;setSaved(row);setTerms(row.accepted_terms_months);setMonthly(row.monthly_accepted);
  }).catch(cause=>{if(request===generation.current){setSaved(null);setError(message(cause));}})
   .finally(()=>{if(request===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[listingId,attempt]);
 const dirty=saved&&(saved.monthly_accepted!==monthly||JSON.stringify([...terms].sort((a,b)=>a-b))!==JSON.stringify(saved.accepted_terms_months));
 async function save(){
  if(lock.current||!saved||!terms.length)return;lock.current=true;setBusy(true);setError('');setNotice('');const request=generation.current;
  try{const row=await saveLongLetRentTerms(saved,terms,monthly);if(request===generation.current){setSaved(row);setTerms(row.accepted_terms_months);setMonthly(row.monthly_accepted);setNotice('Rental terms saved. Existing agreements are unchanged.');}}
  catch(cause){if(request===generation.current)setError(message(cause));}
  finally{lock.current=false;if(request===generation.current)setBusy(false);}
 }
 return <section aria-label="Long Let rental terms" className="space-y-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5">
  <div><h3 className="font-semibold">Rental terms</h3><p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">Choose the lengths of stay you accept and whether tenants may pay monthly.</p></div>
  {loading&&<p role="status" className="text-sm">Loading saved rental terms…</p>}
  {error&&<div role="alert" className="space-y-1 text-sm"><p>{error}</p><Button type="button" variant="outline" disabled={busy||loading} onClick={()=>setAttempt(n=>n+1)}>Refresh saved terms</Button></div>}
  {saved&&!loading&&<>
   <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 text-sm font-medium">Accepted lengths of stay</legend>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{LONG_LET_TERMS.map(term=><label key={term} className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-sm"><input type="checkbox" checked={terms.includes(term)} onChange={event=>setTerms(old=>event.target.checked?[...old,term]:old.filter(item=>item!==term))} className="h-4 w-4 accent-violet-600"/>{rentTermLabel(term)}</label>)}</div>
    <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-[var(--wh-elevated)] p-3 text-sm font-medium"><input type="checkbox" checked={monthly} onChange={event=>setMonthly(event.target.checked)} className="h-4 w-4 accent-violet-600"/>Accept monthly rent</label>
   </fieldset>
   <details className="rounded-xl border border-[var(--wh-border-subtle)] p-3 text-sm"><summary className="min-h-8 cursor-pointer font-medium">How the payment agreement works</summary><div className="mt-2 space-y-2 leading-6 text-[var(--wh-text-secondary)]"><p>Full payment covers the entire agreed term before handover.</p><p>For monthly terms up to one year, the first month is due before handover and the rest each month. For longer terms, Year 1 is paid before handover; each later year is paid in eight monthly amounts starting four months into the preceding year.</p><p>Monthly checkout requires a verified Partner settlement account. Each reservation keeps the price and terms the tenant accepted.</p></div></details>
   <Button type="button" disabled={busy||!dirty||!terms.length||Boolean(error)} onClick={()=>void save()}>{busy?'Saving rental terms…':'Save rental terms'}</Button>
   {!terms.length&&<p role="status" className="text-sm">Choose at least one length of stay.</p>}
  </>}
  {notice&&<p role="status" className="text-sm text-[var(--wh-text-secondary)]">{notice}</p>}
 </section>;
}
function message(cause:unknown):string{return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'Rental terms could not be confirmed. Refresh saved terms.';}
