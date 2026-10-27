import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {getProviderFees,type ProviderFeeDisclosure as Fee,type ProviderFeeProduct} from '@/lib/providerFees';
import {formatRecordedMoney} from '@/lib/regional';

export default function ProviderFeeDisclosure({product,mode,amount,acceptedDigest,onAccepted}:{product:ProviderFeeProduct;mode:'host'|'wehouse';amount?:number;acceptedDigest:string|null;onAccepted:(digest:string|null)=>void}){
 const [fee,setFee]=useState<Fee|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const callback=useRef(onAccepted);useEffect(()=>{callback.current=onAccepted;},[onAccepted]);
 const accepted=useRef(acceptedDigest);useEffect(()=>{accepted.current=acceptedDigest;},[acceptedDigest]);
 useEffect(()=>{let active=true;setLoading(true);setError('');setFee(null);
  void getProviderFees(product,mode).then(receipt=>{if(!active)return;setFee(receipt);if(receipt?.digest!==accepted.current)callback.current(null);})
   .catch(cause=>{if(active){setError(cause instanceof Error?cause.message:cause?.message||'Fees could not be loaded.');callback.current(null);}})
   .finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[product,mode,attempt]);
 return <ProviderFeeTerms fee={fee} loading={loading} error={error} refresh={()=>setAttempt(n=>n+1)} amount={amount} acceptedDigest={acceptedDigest} onAccepted={onAccepted}/>;
}
export function ProviderFeeTerms({fee,loading,error,refresh,amount,acceptedDigest,onAccepted,locked=false}:{fee:Fee|null;loading:boolean;error:string;refresh:()=>void;amount?:number;acceptedDigest:string|null;onAccepted:(digest:string|null)=>void;locked?:boolean}){
 const candidate=Math.round(Number(amount)*100);const gross=Number.isSafeInteger(candidate)&&candidate>0&&candidate<=999999999999?candidate:null;
 const deduction=gross!==null&&fee?Math.round(gross*fee.total_percent/100):null;
 return <section aria-label="Your WeHouse fees" className="space-y-3 rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 text-[var(--wh-text)]">
  <header><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Your WeHouse fees</h3><Button type="button" variant="outline" disabled={loading} onClick={refresh}>Refresh fees</Button></div><p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">Fees are deducted from your eligible earnings after Payment Protection release. Refundable deposits are excluded.</p></header>
  {loading?<p role="status" className="text-sm">Loading the actual rates...</p>:error?<div role="alert" className="space-y-2 text-sm"><p>{error}</p></div>:!fee?<p role="status" className="text-sm">These fees are not configured. Acceptance is unavailable until WeHouse publishes the actual rate.</p>:<>
   <dl className="space-y-2 text-sm"><div className="flex justify-between gap-3"><dt>Platform commission</dt><dd>{fee.base_percent}%</dd></div>{fee.management_mode==='wehouse'&&<div className="flex justify-between gap-3"><dt>Additional WeHouse management</dt><dd>{fee.management_percent}%</dd></div>}<div className="flex justify-between gap-3 border-t border-[var(--wh-border)] pt-2 font-semibold"><dt>Total deduction</dt><dd>{fee.total_percent}%</dd></div>
    {gross!==null&&deduction!==null&&<><div className="flex justify-between gap-3"><dt>Fee on {formatRecordedMoney(gross/100,'NGN')}</dt><dd>{formatRecordedMoney(deduction/100,'NGN')}</dd></div><div className="flex justify-between gap-3 font-semibold"><dt>Your expected net</dt><dd>{formatRecordedMoney((gross-deduction)/100,'NGN')}</dd></div></>}
   </dl><p className="text-xs leading-5 text-[var(--wh-text-secondary)]">The final booking uses its accepted eligible value, discounts and saved fee terms. Existing accepted bookings keep their saved rates.</p>
   <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl bg-[var(--wh-elevated)] p-3 text-sm leading-6"><input type="checkbox" disabled={locked} className="mt-1 h-4 w-4 shrink-0 accent-violet-600" checked={acceptedDigest===fee.digest} onChange={event=>onAccepted(event.target.checked?fee.digest:null)}/><span>I accept the displayed fees deducted from my earnings.</span></label>
  </>}
 </section>;
}
